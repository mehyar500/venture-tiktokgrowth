# TEST_REPORT.md — TikTok Growth System PWA

Date: 2026-09-16. Runner: node v24 (sandbox). No network calls; Workers AI
responses and D1 were mocked or source-checked. Test harness:
`/tmp/tiktok-test/test.mjs` (ephemeral; re-creatable from the assertions below).

## Results: 58/58 assertions passed

### A. Syntax — all pass
- `node --check` on: `functions/api/tiktok/teaser.js`, `generate.js`,
  `deliverable.js`, `_lib/ai.js`, `_lib/inputs.js`, `_lib/claims.js`,
  `_lib/prompts.js`, `app.js` — all OK.
- Inline scripts: `index.html` has only 3 JSON-LD blocks (all valid JSON,
  no bare inline JS); `success.html` and `deliverable.html` each have 1
  inline script — both pass `node --check`.

### B. Contract assertions (mock suite)
- Prompt builders (`teaser`, `fullHooks`, `fullPlan`, `fullBioPlaybook`):
  well-formed `{system, user, json:true}` specs; each carries the COMPLIANCE
  block, the banned-substring list, and the PRE-FLIGHT self-check. Prompt
  instructional text (COMPLIANCE + PREFLIGHT stripped) contains zero banned
  claims — 4/4 builders.
- `findBannedClaims` / `isClean`: detects "bots", multi-hit strings, rejects
  "automate your posting"; passes clean copy.
- Negation-aware scanning (verified): "Do not use bots, automation, or
  engagement pods" and "Do not buy followers or views" are ALLOWED (required
  don'ts copy); "Use bots to grow fast" and "Buy followers cheap" are REJECTED.
- Sanitizer: 3/3 poisoned strings replaced in a poisoned manifest; sanitized
  output has zero banned claims; clean strings untouched; `donts` fallback
  correctly names the bot ban.
- Validators + repair nudge: pass good sections, reject short sections,
  return a named repair nudge on banned copy.
- Inputs: `cleanIntake` normalizes (trim, handle @-strip, hours clamp 40);
  `intakeErrors` flags exactly `niche,on_camera,hours_per_week` when missing.
- `parseJson`: strict JSON, fenced blocks, python-dict normalization
  (`{'a': 3, 'b': True,}`), null on garbage.
- generate.js source checks: exactly 3 `retries: 1` (one retry per section,
  no `retries: 2`); accepts wrapped AND flat stored intake
  `(parsed && parsed.inputs) || parsed || {}`; exact pinned compliance note.
- Day numbering: sanitizer renumbers scrambled/duplicate days to 1..N in
  order; generate.js renumbers after sorting by the model's day signal.
- Full 30-count mock manifest: matches the pinned shape exactly
  (`version:1`, 30 posting_plan, 30 hook_scripts, 3 bios, 3 ctas, 5 steps,
  5 dos, 5 donts, compliance_note); days are 1..30 in order; zero banned
  claims; sanitizer leaves it untouched (0 replaced).
- Sample manifest in `deliverable.html`: compliance-clean.
- `schema.sql`: has `tiktokgrowth_orders`, unique payment index
  (`idx_tiktokgrowth_orders_payment`), token index, $27 SKU seed
  (`tiktokgrowth-system`, fulfillment `tiktokgrowth`, 2700¢), correct
  `success_url_template` with `{access_token}`, cancel `/#pricing`,
  `allowed_return_hosts = tiktokgrowth.mehyar.us`.

### C. Frontend checks
- No em-dashes in `index.html`, `success.html`, or `app.js` (user-facing
  copy). The only em-dash left in the frontend is the contract-pinned
  compliance note string in `deliverable.html`'s dev sample — required
  verbatim by the product contract.
- Checkout payload: 310 bytes for a realistic intake — well under the
  2048-byte cap.
- No client-supplied price: `app.js` contains no price/2700/amount — price
  comes only from `billing_products` server-side.
- Teaser shape matches the pinned contract:
  `{ ok, teaser: { hooks: [{hook, why, format} x5] }, niche, note }` —
  verified against `teaser.js`.

### D. Fixes applied during this test run
1. Scanner made negation-aware (absolute vs contextual banned phrases).
   Rationale: "do not use bots" / "do not buy followers" is required don'ts
   copy; a naive substring scanner flagged the product's own compliance copy
   and the sanitizer's fallback.
2. `generate.js`: `retries: 2` → `retries: 1` on all three AI sections
   (pinned contract: one retry each).
3. `generate.js`: stored-intake now accepts wrapped AND flat forms.
4. `generate.js` + `sanitizeManifest`: posting_plan days guaranteed 1..30
   in order (sort by model day, then renumber; sanitizer renumbers too).
5. Removed em-dashes from all user-facing copy in `index.html`/`success.html`.
6. `prompts.js`: exported `PREFLIGHT` (used by tests).

### E. Not covered (needs staging/live)
- Real Workers AI calls (mocked here); KV rate-limit path (fail-open
  default tested by code review); D1 execution of `schema.sql`;
  Stripe checkout redirect; email delivery.
