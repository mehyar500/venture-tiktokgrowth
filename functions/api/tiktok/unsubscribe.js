// functions/api/tiktok/unsubscribe.js
// POST /api/tiktok/unsubscribe — { email } or GET ?email=
// One-click unsubscribe. Honored in brand + global tables.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function doUnsubscribe(db, email) {
  await db.prepare(
    "UPDATE subscribers_global SET unsubscribed=1 WHERE email=? AND brand='tiktokgrowth'"
  ).bind(email).run().catch(() => {});
  // Also remove from brand leads to honor the unsubscribe
  await db.prepare("DELETE FROM tiktokgrowth_leads WHERE email=?").bind(email).run().catch(() => {});
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    await doUnsubscribe(env.LEADS_DB, email);
    return json({ ok: true, unsubscribed: true });
  } catch (e) {
    console.error("tiktok/unsubscribe failed", e && e.message);
    return json({ ok: false, error: "unsubscribe_failed" }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const url = new URL(request.url);
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    await doUnsubscribe(env.LEADS_DB, email);
    return json({ ok: true, unsubscribed: true });
  } catch (e) {
    return json({ ok: false, error: "unsubscribe_failed" }, 500);
  }
}
