# TikTok Growth System — PWA

Product PWA for the TikTok Growth System ($27 one-time). Live at
https://tiktokgrowth.mehyar.us. Built on the proven Designful PWA pattern
(centralized Stripe checkout on mehyar.us, unified webhook, token-gated
delivery).

## Structure

```
pwa/
  index.html            Landing: hero, how-it-works, what's-inside, free teaser,
                        pricing, FAQ, buy modal. DEV ?dev=1 shows payload instead of charging.
  app.js                Teaser submit/render, buy modal, checkout POST → Stripe redirect.
  success.html          Post-Stripe: polls mehyar.us /api/pay/status, then
                        /api/tiktok/deliverable; retry button re-POSTs generate.
  deliverable.html      Renders the full playbook (30-day plan, 30 hooks, bio
                        pack, trend playbook); Download PDF = window.print()
                        with dedicated print CSS.
  styles.css            Dark theme, TikTok-family pink/cyan accent, print styles.
  manifest.json icon.svg sw.js robots.txt sitemap.xml llms.txt
  functions/api/tiktok/
    teaser.js           POST free teaser: 5 hook scripts. KV per-IP hourly cap, fail-open.
    generate.js         POST paid generate: 3 sequential Workers AI calls,
                        idempotent per order token, marks order ready/failed.
    deliverable.js      GET token-gated playbook manifest JSON.
    _lib/
      ai.js             Workers AI helpers (handles pre-parsed json_object responses).
      inputs.js         Intake sanitization + validation.
      claims.js         Compliance enforcement: banned-phrase list, validators,
                        repair nudges, last-resort manifest sanitizer.
      prompts.js        Prompt library with the compliance block + pre-flight
                        self-check on every prompt.
  schema.sql            tiktokgrowth_orders D1 table + billing_products SKU seed.
  INTEGRATION.md        mehyar-web wiring (fulfillment module, webhook hook, env).
  TEST_REPORT.md       Test results.
```

## API contract

- `POST /api/tiktok/teaser` `{ niche, on_camera, hours_per_week, handle? }`
  → `{ ok, teaser: { hooks: [{hook, why, format} x5] }, niche, note }`
- `POST /api/tiktok/generate` `{ order_token, inputs }` → `{ ok, manifest }`
  (idempotent; returns stored manifest on replay)
- `GET /api/tiktok/deliverable?token=` → `{ ok, status, product_id, playbook, ready_at }`

Manifest shape: `{ version:1, niche, on_camera, hours_per_week, generated_at,
posting_plan:[{day,format,topic,hook,caption_seed} x30],
hook_scripts:[{hook,why_it_works,delivery_tip} x30],
bio_pack:{bios:[3],ctas:[3]},
trend_playbook:{steps:[{title,detail} x5],dos:[5],donts:[5]},
compliance_note }`.

## Compliance

This lane carries platform risk. Three enforcement layers guarantee
original-content methods only (see `_lib/claims.js`):

1. Prompts carry the compliance block + banned-phrase list + pre-flight check.
2. Section validators scan parsed output and trigger a repair-nudge retry.
3. `sanitizeManifest()` replaces any surviving banned copy with neutral
   skill-based fallbacks. Banned copy never ships.

## Local review

Open `index.html` directly for the landing; append `?dev=1` for the dev
checkout payload preview. `deliverable.html?dev=1` renders the sample
playbook with zero backend. Functions need the Workers AI + D1 bindings,
so they only run on Cloudflare Pages.

## Deploy

Deploy is owned by the parent agent (Pages project `tiktokgrowth`,
custom domain via API, GitHub integration, mehyar-web webhook wiring,
D1 schema + SKU, test-mode E2E). Nothing here deploys itself.
