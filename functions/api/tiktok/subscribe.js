// functions/api/tiktok/subscribe.js
// POST /api/tiktok/subscribe — { email, niche? }
// TikTok Growth System lead capture. Stores in brand table + global table.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env || !env.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    const niche = String(body.niche || "").slice(0, 120) || null;

    const db = env.LEADS_DB;
    // Brand table
    await db.prepare(
      "INSERT OR IGNORE INTO tiktokgrowth_leads (email, niche) VALUES (?, ?)"
    ).bind(email, niche).run();

    // Global subscriber table (brand-tagged)
    await db.prepare(
      "INSERT OR IGNORE INTO subscribers_global (email, brand) VALUES (?, 'tiktokgrowth')"
    ).bind(email).run();
    await db.prepare(
      "UPDATE subscribers_global SET unsubscribed=0 WHERE email=? AND brand='tiktokgrowth'"
    ).bind(email).run();

    return json({ ok: true });
  } catch (e) {
    console.error("tiktok/subscribe failed", e && e.message);
    return json({ ok: false, error: "subscribe_failed" }, 500);
  }
}
