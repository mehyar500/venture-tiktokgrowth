// POST /api/tiktok/drive — run ALL generation phases sequentially in one request.
// Body: { order_token }
// Runs hooks → bio → trends → plan → assemble, each as a bounded AI call.
// Called by the success page (buyer's browser, with live progress) or by
// fulfillment backfill. No waitUntil needed — the request itself survives
// because each phase is I/O-bound (AI API calls).
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

// ── Phase builders (mirrored from gen-step.js) ──
async function buildHooks(env, intake) {
  const spec = fullHooks(intake);
  const clean = (arr) => (arr || []).map((h) => ({
    hook: String(h.hook || "").slice(0, 140),
    why_it_works: String(h.why_it_works || "").slice(0, 300),
    delivery_tip: String(h.delivery_tip || "").slice(0, 300),
  })).filter((h) => h.hook.length >= 12);
  const all = [];
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
  return all.slice(0, 30);
}

async function buildBio(env, intake) {
  const spec = fullBioPack(intake);
  const r = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 2000, temperature: 0.7, retries: 1, label: "bio",
    validate: sectionValidator((d) => d && Array.isArray(d.bios) && d.bios.length >= 3, "bio pack"),
  });
  return r.parsed;
}

async function buildTrends(env, intake) {
  const spec = fullTrendPlaybook(intake);
  const r = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 3000, temperature: 0.7, retries: 1, label: "trends",
    validate: sectionValidator((d) => d && Array.isArray(d.steps) && d.steps.length >= 5, "trend playbook"),
  });
  return r.parsed;
}

async function buildPlanPhase(env, intake, hooks) {
  const spec = fullPlan(intake, hooks);
  const r = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 6000, temperature: 0.7, retries: 1, label: "plan",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.posting_plan) && d.posting_plan.length >= 30,
      "posting plan"
    ),
  });
  return r.parsed.posting_plan;
}

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const orderToken = String((body && body.order_token) || "");
    if (orderToken.length < 16) return json({ ok: false, error: "invalid_token" }, 403);

    const order = await env.LEADS_DB.prepare(
      "SELECT * FROM tiktokgrowth_orders WHERE access_token=?"
    ).bind(orderToken).first();
    if (!order) return json({ ok: false, error: "unknown_order" }, 404);
    if (order.status === "ready") return json({ ok: true, status: "ready" });

    let storedInputs = {};
    try {
      const parsed = JSON.parse(order.inputs_json || "{}");
      storedInputs = (parsed && parsed.inputs) || parsed || {};
    } catch {}
    const intake = cleanIntake(storedInputs);
    const missing = intakeErrors(intake);
    if (missing.length) return json({ ok: false, error: "missing_input", inputs: missing }, 400);

    // Load staging (resume from where we left off).
    let stage = {};
    try { stage = JSON.parse(order.output_json || "{}") || {}; } catch {}
    if (stage.version === 1 && stage.posting_plan) {
      return json({ ok: true, status: "ready" });
    }

    const saveStage = async (key, value) => {
      stage[key] = value;
      await env.LEADS_DB.prepare(
        `UPDATE tiktokgrowth_orders SET status='generating', output_json=? WHERE id=? AND status!='ready'`
      ).bind(JSON.stringify(stage), order.id).run();
    };

    // Run missing phases in order.
    if (!stage.hook_scripts) {
      await saveStage("hook_scripts", await buildHooks(env, intake));
    }
    if (!stage.bio_pack) {
      await saveStage("bio_pack", await buildBio(env, intake));
    }
    if (!stage.trend_playbook) {
      await saveStage("trend_playbook", await buildTrends(env, intake));
    }
    if (!stage.posting_plan) {
      await saveStage("posting_plan", await buildPlanPhase(env, intake, stage.hook_scripts));
    }

    // Assemble final manifest.
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

    // Trigger the delivery email via backfill (idempotent: no-op if already sent).
    // Fire-and-forget: the drive's job is done; the email must not depend on
    // the buyer keeping the success page open.
    try {
      await fetch("https://mehyar.us/api/pay/fulfill-backfill", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
        body: JSON.stringify({ token: order.access_token }),
      });
    } catch {}

    return json({ ok: true, status: "ready", sanitized: replaced });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    console.error("tiktok/drive failed", msg);
    return json({ ok: false, error: "drive_failed", detail: msg }, 500);
  }
}
