-- pwa/schema.sql — TikTok Growth System schema + billing catalog seed.
-- Apply to the shared mehyar-jobs D1. Safe to re-run (IF NOT EXISTS / upserts).
-- NOTE: nothing in ~/workspace/repos/mehyar-web is touched by this file.

-- ── orders: one row per paid TikTok Growth System purchase ──────────────────
CREATE TABLE IF NOT EXISTS tiktokgrowth_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id    INTEGER NOT NULL,          -- billing_payments.id (unique: idempotent fulfill)
  product_id    TEXT NOT NULL,             -- billing_products.id
  email         TEXT NOT NULL,
  inputs_json   TEXT NOT NULL DEFAULT '{}',-- {inputs:{niche,on_camera,hours_per_week,handle}}
  status        TEXT NOT NULL DEFAULT 'paid', -- paid|ready|failed
  output_json   TEXT,                      -- playbook manifest (version:1)
  access_token  TEXT NOT NULL,             -- unguessable buyer capability token
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_tiktokgrowth_orders_token ON tiktokgrowth_orders(access_token);
-- Idempotency key for the webhook fulfillment hook (one order per payment).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tiktokgrowth_orders_payment ON tiktokgrowth_orders(payment_id);

-- ── billing catalog: 1 SKU, fulfillment='tiktokgrowth' ──────────────────────
-- success_url_template: Stripe {access_token} is the tiktokgrowth_orders
-- token, written by fulfillTiktokgrowth at webhook time (see INTEGRATION.md).

INSERT INTO billing_products
  (id, name, brand, price_cents, currency, fulfillment, description, success_url_template, cancel_url, allowed_return_hosts, active, digital_file)
VALUES
  ('tiktokgrowth-system', 'TikTok Growth System — 30-Day Content Playbook', 'tiktokgrowth', 2700, 'usd', 'tiktokgrowth',
   'A 30-day organic TikTok content playbook built for your niche: posting plan, 30 hook scripts, bio + CTA pack, and trend-jacking playbook. Original-content methods only.',
   'https://tiktokgrowth.mehyar.us/success.html?token={access_token}',
   'https://tiktokgrowth.mehyar.us/#pricing', 'tiktokgrowth.mehyar.us', 1, NULL)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, price_cents=excluded.price_cents, fulfillment=excluded.fulfillment,
  description=excluded.description, success_url_template=excluded.success_url_template,
  cancel_url=excluded.cancel_url, allowed_return_hosts=excluded.allowed_return_hosts,
  active=excluded.active;
