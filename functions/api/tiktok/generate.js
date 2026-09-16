// functions/api/tiktok/generate.js
// POST /api/tiktok/generate — build the FULL paid playbook.
// Body: { order_token: "<tiktokgrowth_orders.access_token>",
//         inputs: { niche, on_camera, hours_per_week, handle? } }
// inputs merge over the intake inputs stored at checkout.
//
// Auth: the order's access_token is the capability. The product has a single
// SKU, so every order generates the same four-part playbook.
// Re-requesting an already-generated order returns the stored manifest
// instead of burning AI budget again (idempotent generate).
//
// Generation runs 3 sequential Workers AI calls (llama-3.3-70b):
//   1. 30 hook scripts   2. 30-day posting plan   3. bio pack + trend playbook
// Each section is schema-validated AND compliance-scanned (banned claims
// trigger a repair nudge and retry); sanitizeManifest() is the last-resort
// guarantee that no banned copy ever ships.
//
// On success the order row is updated: status='ready', output_json=manifest,
// ready_at=now. On failure: status='failed', 502 — the fulfillment hook
// emails nothing and the buyer retries from the success page.

import { runTextJson, MODELS } from "./_lib/ai.js";
import { cleanIntake, intakeErrors } from "./_lib/inputs.js";
import { fullHooks, fullPlan, fullBioPlaybook } from "./_lib/prompts.js";
import { sectionValidator, sanitizeManifest } from "./_lib/claims.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const COMPLIANCE_NOTE =
  "Skill-based playbook. Results depend on your execution and consistency — no outcomes promised.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function esc(s) {
  return String(s == null ? "" : s).slice(0, 4000);
}

async function buildHookScripts(env, intake) {
  const spec = fullHooks(intake);
  const { parsed } = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 4500, temperature: 0.8, retries: 1, label: "hooks",
    validate: sectionValidator(
      (d) => d && Array.isArray(d.hook_scripts) && d.hook_scripts.length >= 30 &&
        d.hook_scripts.every((h) => typeof h.hook === "string" && h.hook.length > 0),
      "hook scripts"
    ),
  });
  return parsed.hook_scripts.slice(0, 30).map((h) => ({
    hook: String(h.hook || "").slice(0, 140),
    why_it_works: String(h.why_it_works || "").slice(0, 300),
    delivery_tip: String(h.delivery_tip || "").slice(0, 300),
  }));
}

async function buildPlan(env, intake, hooks) {
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
  const days = parsed.posting_plan.slice(0, 30).map((p, i) => ({
    // Keep the model's ordering signal, then renumber 1..30 — the contract
    // requires exactly 30 entries with day 1–30 in order, no gaps/dupes.
    _modelDay: Number(p.day) || 0,
    format: String(p.format || "").slice(0, 40),
    topic: String(p.topic || "").slice(0, 200),
    hook: String(p.hook || "").slice(0, 140),
    caption_seed: String(p.caption_seed || "").slice(0, 500),
  }));
  days.sort((a, b) => (a._modelDay || 30) - (b._modelDay || 30));
  return days.map((d, i) => ({
    day: i + 1,
    format: d.format,
    topic: d.topic,
    hook: d.hook,
    caption_seed: d.caption_seed,
  }));
}

async function buildBioPlaybook(env, intake) {
  const spec = fullBioPlaybook(intake);
  const { parsed } = await runTextJson(env, MODELS[spec.model], [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ], {
    max_tokens: 3500, temperature: 0.7, retries: 1, label: "bio-playbook",
    validate: sectionValidator(
      (d) => d && d.bio_pack && Array.isArray(d.bio_pack.bios) && d.bio_pack.bios.length >= 3 &&
        Array.isArray(d.bio_pack.ctas) && d.bio_pack.ctas.length >= 3 &&
        d.trend_playbook && Array.isArray(d.trend_playbook.steps) && d.trend_playbook.steps.length >= 5 &&
        Array.isArray(d.trend_playbook.dos) && d.trend_playbook.dos.length >= 5 &&
        Array.isArray(d.trend_playbook.donts) && d.trend_playbook.donts.length >= 5,
      "bio pack + trend playbook"
    ),
  });
  return {
    bio_pack: {
      bios: parsed.bio_pack.bios.slice(0, 3).map((b) => String(b).slice(0, 150)),
      ctas: parsed.bio_pack.ctas.slice(0, 3).map((c) => String(c).slice(0, 100)),
    },
    trend_playbook: {
      steps: parsed.trend_playbook.steps.slice(0, 5).map((s) => ({
        title: String(s.title || "").slice(0, 120),
        detail: String(s.detail || "").slice(0, 1200),
      })),
      dos: parsed.trend_playbook.dos.slice(0, 5).map((x) => String(x).slice(0, 300)),
      donts: parsed.trend_playbook.donts.slice(0, 5).map((x) => String(x).slice(0, 300)),
    },
  };
}

export async function onRequestPost({ request, env, waitUntil }) {
  const t0 = Date.now();
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const orderToken = String((body && body.order_token) || "");
    if (orderToken.length < 16) {
      return json({ ok: false, error: "invalid_token" }, 403);
    }

    const order = await env.LEADS_DB.prepare(
      "SELECT * FROM tiktokgrowth_orders WHERE access_token = ?"
    ).bind(orderToken).first();
    if (!order) return json({ ok: false, error: "unknown_order" }, 404);

    // Idempotent generate: already-ready orders return the stored manifest,
    // no AI spend. Already-generating orders return 202 (poll).
    if (order.status === "ready") {
      let manifest = null;
      try { manifest = JSON.parse(order.output_json || "null"); } catch {}
      if (manifest) {
        return json({ ok: true, manifest, replay: true, ready_at: order.ready_at });
      }
      // Corrupt manifest: fall through and regenerate.
    }
    if (order.status === "generating") {
      return json({ ok: true, status: "generating", poll: true }, 202);
    }

    // Merge request inputs over the intake stored at checkout.
    let storedInputs = {};
    try {
      const parsed = JSON.parse(order.inputs_json || "{}");
      storedInputs = (parsed && parsed.inputs) || parsed || {};
    } catch {}
    const intake = cleanIntake({ ...storedInputs, ...((body && body.inputs) || {}) });
    const missing = intakeErrors(intake);
    if (missing.length) {
      return json({ ok: false, error: "missing_input", inputs: missing }, 400);
    }

    // ── the three generation passes (background via waitUntil) ──
    // Mark generating NOW, return 202 immediately, do AI work in background.
    // This avoids edge timeouts on the 3 sequential 70B calls.
    await env.LEADS_DB.prepare(
      "UPDATE tiktokgrowth_orders SET status='generating' WHERE id=? AND status!='ready'"
    ).bind(order.id).run();

    const bg = (async () => {
      const t0 = Date.now();
      try {
        // Phase 1: hooks + bio in parallel (independent).
        const [hookScripts, bioPlaybook] = await Promise.all([
          buildHookScripts(env, intake),
          buildBioPlaybook(env, intake),
        ]);
        // Phase 2: plan (uses hooks for context).
        const plan = await buildPlan(env, intake, hookScripts);

        const rawManifest = {
          version: 1,
          niche: intake.niche,
          on_camera: intake.on_camera,
          hours_per_week: intake.hours_per_week,
          generated_at: new Date().toISOString(),
          posting_plan: plan,
          hook_scripts: hookScripts,
          bio_pack: bioPlaybook.bio_pack,
          trend_playbook: bioPlaybook.trend_playbook,
          compliance_note: COMPLIANCE_NOTE,
        };

        // Last-resort compliance guarantee: sanitize anything that slipped past.
        const { manifest, replaced } = sanitizeManifest(rawManifest);
        if (replaced > 0) {
          console.error(`tiktok/generate sanitizer replaced ${replaced} banned strings (order ${order.id})`);
        }

        await env.LEADS_DB.prepare(
          `UPDATE tiktokgrowth_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`
        ).bind(JSON.stringify(manifest), order.id).run();

        console.error(`tiktok/generate done order=${order.id} ms=${Date.now() - t0} sanitized=${replaced}`);
      } catch (e) {
        console.error("tiktok/generate background build failed", e && e.message);
        try {
          await env.LEADS_DB.prepare(
            "UPDATE tiktokgrowth_orders SET status='failed' WHERE id=? AND status!='ready'"
          ).bind(order.id).run();
        } catch {}
      }
    })();

    // In Pages Functions, use waitUntil if available; otherwise await.
    if (typeof waitUntil === "function") {
      waitUntil(bg);
    } else {
      await bg;
    }

    return json({ ok: true, status: "generating", poll: true }, 202);
  } catch (e) {
    console.error("tiktok/generate failed", e && e.message);
    return json({ ok: false, error: "generate_failed" }, 500);
  }
}
