// POST /api/tiktok/gen-step — run ONE generation phase synchronously.
// Body: { order_token, phase } where phase ∈ hooks|bio|trends|plan|assemble
// Each phase does a single bounded AI call and persists its result into
// output_json staging. The orchestrator (fulfillment or client) calls the
// phases in sequence, one HTTP request per phase, so no single request
// needs to survive multiple long AI calls.
import { runTextJson, MODELS } from "./_lib/ai.js";
import { cleanIntake, intakeErrors } from "./_lib/inputs.js";
import { fullHooks, fullPlan, fullBioPack, fullTrendPlaybook } from "./_lib/prompts.js";
import { sectionValidator, sanitizeManifest } from "./_lib/claims.js";

const COMPLIANCE_NOTE =
  "Skill-based playbook. Results depend on your execution and consistency — no outcomes promised.";

function json(d, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
}
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

async function buildHooks(env, intake) {
  const spec = fullHooks(intake);
  const clean = (arr) => (arr || []).map((h) => ({
    hook: String(h.hook || "").slice(0, 140),
    why_it_works: String(h.why_it_works || "").slice(0, 300),
    delivery_tip: String(h.delivery_tip || "").slice(0, 300),
  })).filter((h) => h.hook.length >= 12);
  const all = [];
  // Pass 1: ask for 30.
  const r1 = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 4500, temperature: 0.8, retries: 1, label: "hooks",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.hook_scripts) && d.hook_scripts.length >= 20,
      "hook scripts"
    ),
  });
  all.push(...clean(r1.parsed.hook_scripts));
  // Pass 2 (top-up): if short of 30, ask for the remainder explicitly.
  if (all.length < 30) {
    const need = 30 - all.length;
    const schemaPart = spec.user.includes("Schema:") ? "Schema:" + spec.user.split("Schema:")[1] : spec.user;
    const r2 = await runTextJson(env, MODELS[spec.model], [
      { role: "system", content: spec.system },
      { role: "user", content: `Write ${need} MORE hook scripts in the same schema. Do not repeat angles from the first batch.\n` + schemaPart },
    ], {
      max_tokens: 2500, temperature: 0.8, retries: 1, label: "hooks-topup",
      validate: sectionValidator(
        (d) => d && Array.isArray(d.hook_scripts) && d.hook_scripts.length >= Math.min(need, 10),
        "hook scripts top-up"
      ),
    });
    all.push(...clean(r2.parsed.hook_scripts));
  }
  if (all.length < 30) {
    throw new Error(`hooks short: got ${all.length}/30 after top-up`);
  }
  return all.slice(0, 30);
}

async function buildBio(env, intake) {
  const spec = fullBioPack(intake);
  const { parsed } = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 1500, temperature: 0.7, retries: 2, label: "bio-pack",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.bios) && d.bios.length >= 3 &&
        Array.isArray(d.ctas) && d.ctas.length >= 3,
      "bio pack"
    ),
  });
  return {
    bios: parsed.bios.slice(0, 3).map((b) => String(b).slice(0, 150)),
    ctas: parsed.ctas.slice(0, 3).map((c) => String(c).slice(0, 100)),
  };
}

async function buildTrends(env, intake) {
  const spec = fullTrendPlaybook(intake);
  const { parsed } = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 2500, temperature: 0.7, retries: 2, label: "trend-playbook",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.steps) && d.steps.length >= 5 &&
        Array.isArray(d.dos) && d.dos.length >= 5 &&
        Array.isArray(d.donts) && d.donts.length >= 5,
      "trend playbook"
    ),
  });
  return {
    steps: parsed.steps.slice(0, 5).map((s) => ({
      title: String(s.title || "").slice(0, 120),
      detail: String(s.detail || "").slice(0, 1200),
    })),
    dos: parsed.dos.slice(0, 5).map((x) => String(x).slice(0, 300)),
    donts: parsed.donts.slice(0, 5).map((x) => String(x).slice(0, 300)),
  };
}

async function buildPlanPhase(env, intake, hooks) {
  const hooksSummary = hooks.slice(0, 10).map((h, i) => `${i + 1}. ${h.hook}`).join("\n");
  const spec = fullPlan(intake, hooksSummary);
  const { parsed } = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 6000, temperature: 0.7, retries: 1, label: "plan",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.posting_plan) && d.posting_plan.length >= 30 &&
        d.posting_plan.every((p) => typeof p.topic === "string" && p.topic.length > 0),
      "posting plan"
    ),
  });
  const days = parsed.posting_plan.slice(0, 30).map((p) => ({
    _modelDay: Number(p.day) || 0,
    format: String(p.format || "").slice(0, 40),
    topic: String(p.topic || "").slice(0, 200),
    hook: String(p.hook || "").slice(0, 140),
    caption_seed: String(p.caption_seed || "").slice(0, 500),
  }));
  days.sort((a, b) => (a._modelDay || 30) - (b._modelDay || 30));
  return days.map((d, i) => ({
    day: i + 1, format: d.format, topic: d.topic, hook: d.hook, caption_seed: d.caption_seed,
  }));
}

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const orderToken = String((body && body.order_token) || "");
    const phase = String((body && body.phase) || "");
    if (orderToken.length < 16) return json({ ok: false, error: "invalid_token" }, 403);
    if (!["hooks", "bio", "trends", "plan", "assemble"].includes(phase)) {
      return json({ ok: false, error: "bad_phase" }, 400);
    }

    const order = await env.LEADS_DB.prepare(
      "SELECT * FROM tiktokgrowth_orders WHERE access_token=?"
    ).bind(orderToken).first();
    if (!order) return json({ ok: false, error: "unknown_order" }, 404);
    if (order.status === "ready") return json({ ok: true, phase, status: "ready" });

    let storedInputs = {};
    try {
      const parsed = JSON.parse(order.inputs_json || "{}");
      storedInputs = (parsed && parsed.inputs) || parsed || {};
    } catch {}
    const intake = cleanIntake({ ...storedInputs, ...((body && body.inputs) || {}) });
    const missing = intakeErrors(intake);
    if (missing.length) return json({ ok: false, error: "missing_input", inputs: missing }, 400);

    // Load staging (partial results from earlier phases).
    let stage = {};
    try { stage = JSON.parse(order.output_json || "{}") || {}; } catch {}
    if (stage.version === 1 && stage.posting_plan) {
      // Already a final manifest — treat as ready.
      return json({ ok: true, phase, status: "ready" });
    }

    if (phase === "assemble") {
      if (!stage.hook_scripts || !stage.posting_plan || !stage.bio_pack || !stage.trend_playbook) {
        return json({ ok: false, error: "incomplete_stage", have: Object.keys(stage) }, 400);
      }
      const rawManifest = {
        version: 1,
        niche: intake.niche,
        on_camera: intake.on_camera,
        hours_per_week: intake.hours_per_week,
        generated_at: new Date().toISOString(),
        posting_plan: stage.posting_plan,
        hook_scripts: stage.hook_scripts,
        bio_pack: stage.bio_pack,
        trend_playbook: stage.trend_playbook,
        compliance_note: COMPLIANCE_NOTE,
      };
      const { manifest, replaced } = sanitizeManifest(rawManifest);
      await env.LEADS_DB.prepare(
        `UPDATE tiktokgrowth_orders SET status='ready', output_json=?, ready_at=${nowSql}, failure_reason=NULL WHERE id=? AND status!='ready'`
      ).bind(JSON.stringify(manifest), order.id).run();
      return json({ ok: true, phase, status: "ready", sanitized: replaced });
    }

    // Run the single AI phase.
    let result;
    if (phase === "hooks") result = await buildHooks(env, intake);
    else if (phase === "bio") result = await buildBio(env, intake);
    else if (phase === "trends") result = await buildTrends(env, intake);
    else if (phase === "plan") {
      if (!stage.hook_scripts) return json({ ok: false, error: "need_hooks_first" }, 400);
      result = await buildPlanPhase(env, intake, stage.hook_scripts);
    }

    // Persist into staging.
    const key = phase === "hooks" ? "hook_scripts" : phase === "bio" ? "bio_pack" : phase === "trends" ? "trend_playbook" : "posting_plan";
    stage[key] = result;
    await env.LEADS_DB.prepare(
      `UPDATE tiktokgrowth_orders SET status='generating', output_json=? WHERE id=? AND status!='ready'`
    ).bind(JSON.stringify(stage), order.id).run();

    return json({ ok: true, phase, status: "generating" });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    console.error("tiktok/gen-step failed", msg);
    return json({ ok: false, error: "phase_failed", detail: msg }, 500);
  }
}
