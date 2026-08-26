# Data layer (`window.appVars`)

`window.appVars` is the page-level data layer the Intuit **clickstream / page-view tracker** reads
to enrich its beacons with personalization and experiment context. On the legacy rendering service
(Next.js SSR) it was built server-side and inlined into `<head>`; on Edge Delivery there is no such
server in the render path, so the site code reproduces it in the eager phase of
[`scripts.js`](scripts/scripts.js).

Two things you'll want:

1. [The contract](#the-contract) — the exact shape the tracker depends on.
2. [Parity validation](#parity-validation) — verify the rebuilt site emits it, and matches prod's
   click channel.

---

## The contract

The tracker reads **only** `window.appVars` (no other `window.*` object), and only these four fields:

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `externalContentIdentifier` | **string** | page pathname (`window.location.pathname`) | the content identifier; stable across localhost/preview/prod |
| `pznRecDetailsArr` | **array** | client pzn integration | section-level personalization records |
| `pznPageRecDetailsArr` | **array** | client pzn integration | page-level personalization records (empty until whole-page pzn exists on EDS) |
| `ixpDetailsArr` | **array** | client experiment integration | `[{experiment_id, experiment_version, experiment_treatment}, …]` |

> **The three `*Arr` fields are REAL ARRAYS, not JSON strings.** The tracker reads them directly (no
> `JSON.parse`). This deliberately **reverses** the historical RaaS typing (where they were
> JSON-stringified) — it matches the current tracker Intuit shared. `test/analytics.test.js` asserts
> the array typing explicitly.

### How it's built

- **Eager, before martech.** `loadEager()` in [`scripts.js`](scripts/scripts.js) seeds
  `window.appVars` **before** the martech/tracker loads — `externalContentIdentifier` from metadata,
  the three record arrays empty — so it always exists (all four keys) when a tracker reads it.
- **Arrays fill in place.** Personalization/experiments resolve asynchronously on EDS. As decisions
  land across the eager (LCP section) and lazy (rest-of-page) phases,
  [`scripts/experience.js`](scripts/experience.js) (`recordPzn` /
  `recordIxp`) updates the arrays **on the same object reference** — so a tracker that captured
  `window.appVars` eagerly still sees the records. Record de-dup + the global write are deferred to an
  idle callback, off the LCP path.

### Two channels

The data layer reaches the tracker through **two** channels — both are needed for full parity:

1. **Page-level — `window.appVars`** (this file). Feeds page-view beacons.
2. **Block-level — `data-pzn-*` DOM attributes** on personalized blocks
   (`data-pzn-placement` / `data-pzn-id` / `data-pzn-action` / `data-pzn-workflow` …). The tracker
   rebuilds a record **per click** by walking the DOM up from the clicked element, so personalized
   blocks must carry these attributes for click tracking to work. Prod erp injects them client-side on
   personalized blocks; the parity harness flags whether our build does too (see below).

---

## Parity validation

[`scripts/diff/appvars-diff.mjs`](scripts/diff/appvars-diff.mjs) checks the data layer against live
`erp.intuit.com`. It's a sibling of [`martech-diff.mjs`](scripts/diff/martech-diff.mjs) and reuses the
same hardened live capture ([`scripts/diff/live-session.mjs`](scripts/diff/live-session.mjs), which
clears Akamai/Cloudflare bot-management so prod is never silently measured as an "Access Denied" page).

### What it checks

The data layer is delivered **differently** on prod vs EDS, so the harness has two truth sources:

- **`window.appVars` contract** — asserted against the fixed four-field contract above (types
  included; `array` ≠ `string`). On **prod erp this object is absent** (`app_vars_enabled` is off — erp
  used `window.mktg_datalayer` instead), so there's nothing on prod to diff its *shape* against; the
  harness confirms **our** build emits it correctly.
- **`data-pzn-*` block channel** — prod is the baseline. The harness diffs the set of `data-pzn-*`
  attribute **names** so click-time DOM traversal keeps working.
- **`mktg_datalayer` keys** — captured informationally. We do **not** reproduce that object (the
  tracker was moved onto `appVars`); it's shown so the divergence stays visible.

The array typing is also asserted in [`test/analytics.test.js`](test/analytics.test.js) (`npm test`).
The live harness is the integration-level check that the *deployed* build actually emits the contract.

### Setup

```bash
npm install                     # pulls playwright (a devDependency)
npx playwright install chromium # one-time browser download
```

### Running it

```bash
# Diff your local build against the committed prod golden (authenticated `aem up` on :3000):
node scripts/diff/appvars-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/appvars-homepage.golden.json

# (Re)capture the prod golden — do this deliberately when prod's data layer changes:
node scripts/diff/appvars-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/appvars-homepage.golden.json

# CI mode — exit non-zero if a MEASURED env fails the appVars contract:
node scripts/diff/appvars-diff.mjs --env local --assert
```

| Flag | Purpose |
| --- | --- |
| `--env prod,stage,preview,local` | capture a subset of the env ladder (stage is VPN-gated; unreachable envs are SKIPPED, never failed) |
| `--ours-path /drafts/home` | point the our-build capture at a page **with personalization** (the homepage may have none) |
| `--preview-base <url>` / `--local-base <url>` | override an env's base URL |
| `--assert` | exit 1 when a measured env fails the appVars contract (else report-only, exit 0) |
| `--headed` | stealth real Chrome — escalate if prod bot-challenges the headless capture |
| `--refresh <file>` / `--baseline <file>` | (re)write / load the prod golden |

### Reading the output

```
baseline appVars absent (app_vars_enabled off — expected on erp)
         data-pzn blocks: 3 · attrs: [data-pzn-action, data-pzn-id, data-pzn-placement, data-pzn-workflow, …]
         mktg_datalayer: 20 keys (informational — not reproduced)
local    CONTRACT ✓  appVars has the 4 fields, types ok
         data-pzn channel GAP: prod stamps [data-pzn-action, data-pzn-id, data-pzn-placement, …] — our build stamps none/fewer
```

- **`CONTRACT ✓ / ✗`** — does our `window.appVars` match the four-field contract (types included).
- **`data-pzn channel ✓ / GAP`** — does our build stamp the same `data-pzn-*` attributes prod does.

### Known open items

- **Block-level `data-pzn-*` stamping (companion channel).** Page-level `appVars` (this change) feeds
  page-view beacons; click tracking additionally needs personalized blocks to carry `data-pzn-*`
  attributes. Our personalization applies content but does not yet stamp those attributes, so the
  harness will report a `data-pzn channel GAP` on personalized pages until that's wired. Tracked
  separately.
- **Content identifier.** `externalContentIdentifier` is the page pathname
  (`window.location.pathname`) — no page metadata required. The intuit-orchestrator gets the same
  pathname as `context.casId`, plus the full URL as `context.permalink`. If the content/analytics
  team ever standardizes on a different id scheme, change it in `loadEager` (`scripts/scripts.js`)
  and `buildContext` (`scripts/experience.js`).
