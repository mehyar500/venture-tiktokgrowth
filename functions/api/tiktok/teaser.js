// functions/api/tiktok/teaser.js
// POST /api/tiktok/teaser — free teaser: 5 hook scripts for the creator's niche.
// Body: { niche, on_camera, hours_per_week, handle? }
//
// Free and unauthenticated, so abuse control is a KV-backed per-IP hourly cap
// (fail-open when no KV binding). Inputs are sanitized and length-capped.

import { runTextJson, MODELS } from "./_lib/ai.js";
import { cleanIntake, intakeErrors } from "./_lib/inputs.js";
import { teaserHooks } from "./_lib/prompts.js";
import { sectionValidator, findBannedClaims } from "./_lib/claims.js";

const RL_CAP = 20; // teasers per IP per hour
const RL_WINDOW_S = 3600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function checkRateLimit(env, request) {
  if (!env.TIKTOKGROWTH_KV) return { ok: true };
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  const key = "rl:teaser:" + ip;
  try {
    const cur = Number((await env.TIKTOKGROWTH_KV.get(key)) || 0);
    if (cur >= RL_CAP) return { ok: false };
    await env.TIKTOKGROWTH_KV.put(key, String(cur + 1), { expirationTtl: RL_WINDOW_S });
    return { ok: true };
  } catch {
    return { ok: true }; // fail open — never break the funnel on KV hiccups
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const rl = await checkRateLimit(env, request);
    if (!rl.ok) return json({ ok: false, error: "rate_limited" }, 429);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const intake = cleanIntake(body);
    const missing = intakeErrors(intake);
    if (missing.length) {
      return json({ ok: false, error: "missing_input", inputs: missing }, 400);
    }

    const spec = teaserHooks(intake);
    let parsed;
    try {
      const res = await runTextJson(env, MODELS[spec.model], [
        { role: "system", content: spec.system },
        { role: "user", content: spec.user },
      ], {
        max_tokens: 1500, temperature: 0.8, retries: 1, label: "teaser-hooks",
        validate: sectionValidator(
          (d) => d && Array.isArray(d.hooks) && d.hooks.length >= 5 &&
            d.hooks.every((h) => typeof h.hook === "string" && h.hook.length > 0),
          "teaser hooks"
        ),
      });
      parsed = res.parsed;
    } catch (e) {
      console.error("tiktok/teaser failed", e && e.message);
      return json({ ok: false, error: "teaser_failed" }, 502);
    }

    const hooks = parsed.hooks.slice(0, 5).map((h) => ({
      hook: String(h.hook || "").slice(0, 140),
      why: String(h.why || "").slice(0, 300),
      format: String(h.format || "").slice(0, 40),
    }));
    // Defense in depth: one last scan of the exact strings we ship.
    const hits = findBannedClaims(JSON.stringify(hooks));
    if (hits.length) {
      console.error("tiktok/teaser banned copy survived validation", hits.join(","));
      return json({ ok: false, error: "teaser_failed" }, 502);
    }

    return json({
      ok: true,
      teaser: { hooks },
      niche: intake.niche,
      note: "5 free hooks. The $27 playbook ships 30 hooks, a 30-day posting plan, your bio pack, and the trend-jacking playbook.",
    });
  } catch (e) {
    console.error("tiktok/teaser failed", e && e.message);
    return json({ ok: false, error: "teaser_failed" }, 500);
  }
}
