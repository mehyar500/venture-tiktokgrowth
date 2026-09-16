// functions/api/tiktok/deliverable.js
// GET /api/tiktok/deliverable?token=<access_token>
// Returns the buyer's playbook manifest. The access token is the capability —
// no other auth. The manifest is JSON text; the deliverable page renders it
// and offers Download-PDF via print CSS.

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (token.length < 16) {
    return Response.json({ ok: false, error: "invalid_token" }, { status: 403 });
  }
  const order = await env.LEADS_DB.prepare(
    "SELECT * FROM tiktokgrowth_orders WHERE access_token = ?"
  ).bind(token).first();
  if (!order) {
    return Response.json({ ok: false, error: "unknown_order" }, { status: 404 });
  }
  if (order.status !== "ready") {
    return Response.json(
      { ok: false, error: "not_ready", status: order.status },
      { status: 409 }
    );
  }
  let playbook = null;
  try {
    playbook = JSON.parse(order.output_json || "null");
  } catch {
    return Response.json({ ok: false, error: "manifest_corrupt" }, { status: 500 });
  }
  if (!playbook || playbook.version !== 1) {
    return Response.json({ ok: false, error: "manifest_corrupt" }, { status: 500 });
  }
  return Response.json(
    {
      ok: true,
      status: order.status,
      product_id: order.product_id,
      playbook,
      ready_at: order.ready_at,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
