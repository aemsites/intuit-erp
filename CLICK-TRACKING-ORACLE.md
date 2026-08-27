# Click-tracking parity oracle — goal spec & anti-gaming contract

The target: our EDS build reproduces the customer's **161 authoritative prod beacons** at
**≥95% across the board** — measured so the only way to move the number up is the honest
way (wire the block, improve the derive, author the residue). This file is the contract a
`/goal` loop runs against. Counts/field-names only — no campaign codes (safe to commit).

## The goal, stated precisely

**"95% across the board" = the MINIMUM across every axis ≥ 95%**, never a blended mean:
`overall` gated value-match · each of the 6 `event` types · each `component` · each gated
`field` · `coverage` (reproduced / total). PLUS **100% present-and-shape** on the frozen
inherited fields. The weakest axis is the score (`oracle-lib.mjs` `verdict()`).

## Two gates (single source of truth: `scripts/diff/fixtures/field-policy.json`)

| Gate | Command | Covers | Role |
|---|---|---|---|
| **Offline** (fast, deterministic) | `npm run oracle:customer` | event + derive-driven per-click fields | the loop's inner oracle — what the loop's code changes actually move |
| **Live** (VPN, authoritative) | `npm run stage:parity` | **all ~60 fields** incl. inherited | final gate — confirms the whole envelope end-to-end on stage |

Both import `oracle-lib.mjs`, so field taxonomy, normalization, the integrity lock, and the
across-the-board verdict are identical.

## Field policy — every field is accounted for (nothing silently dropped)

- **GATED (value-match ours vs prod)**: the ~15 per-click identity fields (the real work),
  the deterministic page/site/consent fields, and host-bearing fields **after a documented
  stage→prod host normalization**. Even Intuit-assigned `page_cas_id`/`project_asset_id`
  stay gated — if we don't emit them that's a real gap to **surface, not hide**.
- **PRESENCE-frozen (present + shape only, each with a reason)**: the ~29 fields that
  *cannot* value-match across two independent captures — per-visit/visitor IDs, the capture
  browser's fingerprint, and time-varying `experiment_ids`. **The loop reads this list
  read-only; it cannot move a field here to win.** (All 161 payloads came from one
  authenticated session, so per-visitor fields are session-locked to the customer's capture.)
- **Structural exceptions (frozen, enumerated)**: `chat:viewed` — passive widget-render
  impressions with no click; no EDS equivalent. Excluded from gated axes, still counted in
  coverage. The loop **cannot add here**; a new "unreproducible" claim triggers the exit path.

## Anti-gaming guarantees (enforced in `oracle-lib.mjs`)

| Shortcut | Structurally refused by |
|---|---|
| Strip/trim props from the golden | `assertIntegrity()` re-hashes payloads; a hand-edit throws |
| Quietly narrow the diff | every field must be GATED or PRESENCE in `field-policy.json`; unclassified → FAIL |
| Shrink the gated set | gated fields are read from the policy, not a per-script literal |
| Mark a block "structural" to dodge it | structural exceptions are frozen + enumerated; the loop can't add |
| Lie in the gate's `BLOCK` map | each ported block needs a real-render test (`decorate`+`initTracking`+delegated event) |
| Average away a weak component | verdict = MIN across every axis |

## `ui_access_point` is index-tolerant

Positional trail segments (`rw_card_N`, `accordion_item_N`) are normalized before compare,
so `…|rw_card_1` matches `…|rw_card_2` — the trail STRUCTURE must match, but the exact index
(which shifts with our markup/payload order) does not. Ratified 2026-08-26. This removed the
synthetic-gate false gaps where our reconstruction numbered cards by capture order, not true
DOM position.

## Two-gear drive (ratified 2026-08-26)

The last mile is inherently **live** (real DOM position + page-migration truth), so:

- **Offline gear** (`npm run oracle:customer`) — the derive/wiring loop: single-level trail
  ports, derive improvements (directive 4, raise the floor), sheet residue. Fast, deterministic.
- **Live gear** (`npm run stage:parity`, VPN) — authoritative for positional trails, the full
  ~60-field envelope (inherited fields present+shape), and which net-new pages are migrated.

## Current task list (emitted by the oracle — bounded)

- ✅ **`feature` ported** (SEEDED) — `blocks/feature-grid/feature-grid.js` `trackAs('feature')`
  + `BLOCK.feature` + `test/feature-grid-tracking.test.js`. Oracle `feature` 94.1% → 100%.
- ✅ **`cards` resolved** — index-tolerant `ui_access_point` (the misses were a synthetic
  positional artifact; the runtime is correct live).
- ⏳ **`product_banner`** (prod trail `rw_banner`, `/events` only) — the sole remaining ceiling
  gap (88.9%). LIVE-GATED: `/events` migration to EDS is unconfirmed and the banner block isn't
  identified. Resolve in the live gear; if `/events` isn't migrated it's a not-yet-migrated gap
  (report), not loop work.

**Directive 4 — improve auto-derive** (`scripts/tracking.js`): raise the derive-only floor
(`npm run oracle:customer:floor`, currently ~62%) and shrink the generated sheet. **Prefer
derive; use the sheet only for what is genuinely not derivable** (campaign codes
`data-wa-link`/`icom_user_action` and authored labels). Known derive candidate: feature-grid
CTA renders `ui_object=link` (`.feature-cta`) but prod emits `button` (sheet covers it at the
ceiling). The sheet regenerates from the golden each iteration (`npm run sheet:customer`) and
*cannot* encode `ui_access_point`/`event`, so those stay honest.

## Per-iteration loop procedure

1. Change code (block `trackAs` wiring / `tracking.js` derive) and/or add a real-render test.
2. `npm run oracle:customer` (regenerates the seed sheet, then scores the ceiling).
3. Read `stuck` in the JSON (`--json`) — failing components/fields/elements — and fix the next one.
4. Keep `npm test` green (add/adjust real-render tests for each ported block).
5. At milestones / before done: `npm run stage:parity` (VPN) to confirm all ~60 fields live.

## Exit path (no infinite loop)

Stop and hand back to a human when ANY of:

- **PASS** — offline `score ≥ 95` AND `presence == 100` AND `npm test` green (the real-render
  tests are the wiring-truth guard — `BLOCK` cannot lie), confirmed by a live `stage:parity` run.
- **Plateau** — `score` improves by < 0.5 over the last **3** iterations.
- **Cap** — **12** iterations, or the runner's cost ceiling.

On a non-PASS stop, emit the oracle's `stuck` payload as the **"needs human"** report:
the weakest axis, the failing components/fields, the specific unreproduced elements, and
whether the blocker looks like markup we can't change / a content-team dependency
(`page_cas_id`) / a prod inconsistency / a candidate frozen-exception for human ratification.
No silent grinding at 85%.

**Recommended runner:** `servo:agent-loop --driver goal` (wraps `/goal` with exactly these
plateau/iteration/cost guardrails and uses our oracle as the truth-source). Plain `/goal`
works too with a manual iteration cap; the exit criteria above still apply.
