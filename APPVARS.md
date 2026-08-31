# Data layer (`window.appVars`)

`window.appVars` is the page-level data layer that carries **personalization** and **experiment**
context for the Intuit clickstream / page-view tracker. On the legacy rendering service (Next.js
SSR) this context was built server-side and inlined into `<head>`; on Edge Delivery there is no
server in the render path, so the site code reproduces it client-side in the eager phase of
[`scripts.js`](scripts/scripts.js) and fills it as personalization/experiment decisions resolve
([`scripts/experience.js`](scripts/experience.js)).

> **Reality check (Aug 2026).** `appVars` is the *intended* contract — the shape both
> Intuit's `sbseg-tracker.txt` (the customer-shared reference) and their `getTrackStarScript`
> read. But the tracker **actually deployed** via the `ies-erp` Tealium profile does **not** read
> `appVars` for the page-view: on prod it gets `personalization_details` **server-interpolated**
> (baked from `__NEXT_DATA__`), and on EDS — where there is no SSR — its page-init emits
> `personalization_details: null`. Closing that is the [open gap](#page-view-personalization--the-open-gap)
> below. The click channel (`data-pzn-*`) is unaffected and works today.

Three things you'll want:

1. [The contract](#the-contract) — the exact shape the tracker depends on.
2. [Page-view personalization — the open gap](#page-view-personalization--the-open-gap) — why the
   page-view event drops it, and the enrich shim that fixes it.
3. [Parity validation](#parity-validation) — verify the rebuilt site emits it, and matches prod.

---

## The contract

The intended data layer is `window.appVars`, with these four fields:

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `externalContentIdentifier` | **string** | page pathname (`window.location.pathname`) | the content identifier; stable across localhost/preview/prod |
| `pznRecDetailsArr` | **array** | client pzn integration | section-level personalization records |
| `pznPageRecDetailsArr` | **array** | client pzn integration | page-level personalization records (page-level wins over section-level) |
| `ixpDetailsArr` | **array** | client experiment integration | `[{experiment_id, experiment_version, experiment_treatment}, …]` → joined into `window.ixp.xt` |

Each personalization record (`pznRecord` in [`scripts/experience.js`](scripts/experience.js)) has
`personalization_placement` / `personalization_id` / `personalization_action` (`'im'`) /
`personalization_workflow` (`'marketing'`) / `content_id` / `externalContentIdentifier` — the same
shape prod's `personalization_details` array carries.

> **The three `*Arr` fields are REAL ARRAYS, not JSON strings.** They are read directly (no
> `JSON.parse`) — this reverses the historical RaaS typing (JSON-stringified) to match the current
> tracker Intuit shared. The array typing is asserted in
> [`test/experience.test.js`](test/experience.test.js) (`npm test`).

### How it's built

- **Eager, before martech.** `loadEager()` in [`scripts.js`](scripts/scripts.js) seeds
  `window.appVars` **before** the martech/tracker loads — `externalContentIdentifier` from the URL
  pathname, the three record arrays empty — so all four keys always exist when a tracker reads it.
- **Decisions and visuals have separate deadlines.** The baseline is revealed after 1.5 seconds,
  while the decision request may continue for up to 5 seconds. Assigned decisions are recorded and
  flushed synchronously before Tealium starts; below-the-fold DOM swaps continue independently and
  cannot block the page-view beacon.

### Two channels

1. **Page-level — `window.appVars`.** *Intended* to feed page-view beacons
   (`personalization_details`, `experiment_ids`). See the open gap below — the deployed tracker does
   not yet consume it.
2. **Click-level — DOM PZN plus global IXP.** `data-pzn-*` attributes let the tracker rebuild a
   record **per click** by walking the DOM up from the clicked element, so personalized blocks must
   carry these. `stampPzn` ([`scripts/experience.js`](scripts/experience.js)) writes the full set
   Intuit's `helix-common/pzn-container-block` uses — `data-pzn-placement` / `-id` / `-action` /
   `-workflow` / `-model-name` / `-model-version` (+ `data-experiment-*` via `stampExperiment`).
   The ECS enrichment shim also fills global `experiment_ids` from `appVars` when the profile leaves
   the click payload empty.

---

## Page-view personalization — the open gap

**Symptom (customer report).** On a PZN page the `screen:viewed` event ships with
`personalization_details: null` (missing), while prod ships the populated array. It IS present on
click (`track`) events.

**Root cause (verified live, prod vs stage).** `personalization_details` / `experiment_ids` on the
page-view are built by Intuit's ECS page tracker from `pznPageRecDetailsArr || pznRecDetailsArr` and
`ixpDetailsArr` (see `getTrackStarScript` / `sbseg-tracker.txt` §4). On legacy prod those values are
**server-interpolated** (baked from `__NEXT_DATA__` at render). On EDS there is no SSR, and the
deployed profile page-init reads **no runtime data layer** for the page view — probed live, it reads
neither `window.appVars`, `window.utag_data`, `window.mktg_datalayer`, nor the DOM, and it fires
once at bootstrap (not re-triggered by `utag.view`). So it emits `null`. Clicks are unaffected
because the click handler walks `data-pzn-*` off the DOM at click time.

The page-view is fired **once** by the profile at bootstrap (not re-triggered by `utag.view`), the
ECS libs expose **no page-view opt-out flag**, and `utag.view` is load-bearing for every Tealium
vendor tag (GA4/ads/Marketo/…) — so we can't cleanly suppress just the ECS page-view client-side.

- **Shipped now — enrich ([`scripts/ecs-enrich.js`](scripts/ecs-enrich.js)).** A
  temporary client-side shim (**on by default**; skipped only with `?martech=off`): it **wraps** the
  profile's own `webAnalytics.trackPage` and fills `personalization_details` / `experiment_ids` from
  `window.appVars`, only where the profile left them empty. One enriched `screen:viewed`, vendor tags
  intact, no profile change. Installs in the eager phase via an accessor trap on
  `window.intuit.tracking.ecs.webAnalytics` (race-free, before utag loads). Validated on stage: a
  profile `trackPage({personalization_details: null})` came out with the `appVars` records +
  `experiment_ids`. **FIXME:** remove once option C lands.
- **End-state — option C (Intuit's change).** Point the profile / `helix-common` EDS page-init at
  `window.appVars.pznPageRecDetailsArr` (their `getTrackStarScript` logic, runtime instead of SSR).
  Single page-view, no client shim — then the enrich module above is redundant and should be deleted.

---

## Parity validation

[`scripts/diff/appvars-diff.mjs`](scripts/diff/appvars-diff.mjs) checks the data layer against live
`erp.intuit.com`. It reuses the hardened live capture
([`scripts/diff/live-session.mjs`](scripts/diff/live-session.mjs), which clears Akamai/Cloudflare
bot-management so prod is never silently measured as an "Access Denied" page).

### What it checks — three truth sources

- **`window.appVars` contract** — asserted against the fixed four-field contract above (types
  included; `array` ≠ `string`). On **prod erp this object is absent** (`app_vars_enabled` off; prod
  builds the data layer server-side), so there is nothing on prod to diff its *shape* against — the
  harness confirms **our** build emits the contract.
- **`data-pzn-*` block channel** — prod is the baseline; the harness diffs the set of `data-pzn-*`
  attribute **names** so click-time DOM traversal keeps working.
- **page-view beacon** *(new)* — captures the `screen:viewed` clickstream POST and, when prod fires
  `personalization_details` on a page (i.e. it is a pzn page), **asserts our build does too**. This
  closes the loop the shape-check alone can't: `appVars` ✓ does **not** prove the records reach the
  outgoing event — the exact gap that shipped. It passes on an env where the enrich shim (or option
  C) is live, and reports a GAP on any env still missing it.

The array typing + record/stamp shapes are also unit-gated in
[`test/experience.test.js`](test/experience.test.js) and
[`test/ecs-enrich.test.js`](test/ecs-enrich.test.js) (`npm test`).

### Running it

```bash
npm install                     # pulls playwright (a devDependency)
npx playwright install chromium # one-time browser download

# Diff local build vs the committed prod golden (authenticated `aem up` on :3000):
node scripts/diff/appvars-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/appvars-homepage.golden.json

# Point at a page WITH personalization (the homepage may have none locally):
node scripts/diff/appvars-diff.mjs --env local --ours-path /drafts/home

# (Re)capture the prod golden — deliberately, when prod's data layer changes:
node scripts/diff/appvars-diff.mjs --env prod --refresh scripts/diff/fixtures/appvars-homepage.golden.json

# CI mode — exit non-zero when a MEASURED env fails a check:
node scripts/diff/appvars-diff.mjs --env local --assert
```

| Flag | Purpose |
| --- | --- |
| `--env prod,stage,preview,local` | capture a subset of the env ladder (stage is VPN-gated; unreachable envs are SKIPPED, never failed) |
| `--ours-path /drafts/home` | point the our-build capture at a page **with personalization** |
| `--preview-base <url>` / `--local-base <url>` | override an env's base URL |
| `--assert` | exit 1 when a measured env fails a check (appVars contract and/or page-view beacon); else report-only, exit 0 |
| `--headed` | stealth real Chrome — escalate if prod bot-challenges the headless capture |
| `--refresh <file>` / `--baseline <file>` | (re)write / load the prod golden |

### Reading the output

```
baseline appVars absent (app_vars_enabled off — expected on erp)
         data-pzn blocks: 3 · attrs: [data-pzn-action, data-pzn-id, data-pzn-placement, data-pzn-workflow, …]
         page-view beacon: personalization_details 2 record(s) [content_id, personalization_id, personalization_placement, …] · experiment_ids ✓
         mktg_datalayer: 20 keys (informational — not reproduced)
local    CONTRACT ✓  appVars has the 4 fields, types ok
         data-pzn channel ✓ (3 blocks)
         page-view pzn GAP: prod fires 2 personalization_details record(s), our page-view has none — personalization_details ABSENT from the event
```

- **`CONTRACT ✓ / ✗`** — does our `window.appVars` match the four-field contract.
- **`data-pzn channel ✓ / GAP`** — does our build stamp the same `data-pzn-*` attributes as prod.
- **`page-view pzn ✓ / GAP`** — does our `screen:viewed` event actually carry
  `personalization_details` (the integration truth). Passes where the enrich shim (or option C) is
  live; GAP otherwise.

`martech-diff.mjs` complements this: it asserts `o11y-rum` fires on prod-env captures
(`mustFireProdMartech`, gated to `stage`) — see [MARTECH.md](MARTECH.md).

### Known open items

- **Page-view `personalization_details` / `experiment_ids`.** Enriched client-side by the
  `ecs-enrich.js` shim (on by default). Land option C (profile reads `appVars` directly),
  then delete the shim. Confirm the shim's eager-phase trap catches the profile's bootstrap
  `trackPage` on a deployed prod-env host. See
  [above](#page-view-personalization--the-open-gap).
- **Content identifier.** `externalContentIdentifier` is the page pathname
  (`window.location.pathname`) — no page metadata required. The intuit-orchestrator gets the same
  pathname as `context.casId`, plus the full URL as `context.permalink`. If the content/analytics
  team ever standardizes on a different id scheme, change it in `loadEager` (`scripts/scripts.js`)
  and `buildContext` (`scripts/experience.js`).
