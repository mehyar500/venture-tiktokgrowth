# INTEGRATION.md — TikTok Growth System × mehyar-web

The PWA (this directory) is the product surface. The money path lives on
mehyar-web via the centralized checkout + unified webhook (see the
`digital_product_deploy` skill). This file documents the mehyar-web side so
the deploy owner can wire it exactly.

## 1. Fulfillment module

Create `functions/api/_shared/fulfillTiktokgrowth.js` in mehyar-web:

```js
export async function fulfillTiktokgrowth({ db, env, waitUntil, sendEmail }, payment)
```

Contract (modeled on the reference fulfill-designful.js):

1. Parse `payment.metadata_json` (the centralized `/api/pay/checkout` stores
   `body.params` FLAT). Accept the flat shape and a wrapped `{inputs:{...}}`
   shape. Intake fields: `niche`, `on_camera`, `hours_per_week`, `handle`.
2. Idempotent order create: `SELECT` from `tiktokgrowth_orders` by
   `payment_id`; if a row exists, return `{ok:true, replay:true}`.
3. Insert the order (`status='paid'`, `inputs_json={inputs:{...}}`,
   `access_token=<64 hex chars>`), then token unification:
   `UPDATE billing_payments SET access_token=<order token> WHERE id=?` so the
   one token in `success_url_template` gates `/api/pay/status` (mehyar.us)
   AND `/api/tiktok/deliverable` (product PWA).
4. Background (via `waitUntil`, Stripe gets an instant 200):
   `POST ${TIKTOKGROWTH_BASE_URL}/api/tiktok/generate`
   with `{ order_token, inputs }`.
   - On success: mark the order `ready` (generate.js already did; this is a
     no-op belt-and-braces), then email the buyer the token-gated
     deliverable link:
     `${TIKTOKGROWTH_BASE_URL}/deliverable.html?token=<token>`.
   - On failure: mark the order `failed`, email NOTHING. The buyer's
     success page shows live status + a retry button that re-POSTs
     `/api/tiktok/generate` with their token.
5. Never throw out of the hook. Wrap generation in try/catch; log failures.

## 2. Webhook hook registration

In `functions/api/pay/webhook.js`, add one entry to `fulfillHooks`:

```js
async tiktokgrowth({ db, env, waitUntil }, payment) {
  const { fulfillTiktokgrowth } = await import("../_shared/fulfillTiktokgrowth.js");
  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
  await fulfillTiktokgrowth({ db, env, waitUntil, sendEmail }, payment);
},
```

No signature/secret changes — the shared webhook and its existing Stripe
secrets are reused.

## 3. Env on mehyar-web

- `TIKTOKGROWTH_BASE_URL=https://tiktokgrowth.mehyar.us` (so the webhook's
  background POST reaches the product's generate endpoint).

## 4. Env/bindings on the product Pages project (`tiktokgrowth`)

- `AI` (Workers AI) — required for teaser + generate.
- `LEADS_DB` → the shared `mehyar-jobs` D1 (orders table).
- `TIKTOKGROWTH_KV` (optional) — per-IP teaser rate limit; fail-open without it.

## 5. Checkout contract

Buy button posts to `https://mehyar.us/api/pay/checkout`:

```json
{
  "product_id": "tiktokgrowth-system",
  "email": "buyer@example.com",
  "params": { "niche": "...", "on_camera": "comfortable|getting-there|prefer-off-camera",
              "hours_per_week": "5", "handle": "@..." },
  "success_url": "https://tiktokgrowth.mehyar.us/success.html",
  "cancel_url": "https://tiktokgrowth.mehyar.us/#pricing"
}
```

`params` is small (well under the 2048-byte cap).

## 6. Email

Until `tiktokgrowth.mehyar.us` is onboarded on BOTH ESPs (standing rule),
send all buyer email as `team@mehyar.us`.

## 7. Hardening TODOs (pre-launch, non-blocking)

- Turnstile on the teaser form at go-live (rate limit is currently KV-only).
- KV binding `TIKTOKGROWTH_KV` on the product project for the teaser cap.
- DNS pinning / egress allowlist: not applicable (this product fetches no
  buyer-supplied URLs — teaser takes niche text only).
