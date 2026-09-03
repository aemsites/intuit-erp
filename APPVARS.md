# Page-view data (`window.appVars`)

`window.appVars` carries personalization and experiment context into Intuit's ECS page-view
tracker. It is the page-level counterpart to the DOM click contract documented in
[`CLICK-TRACKING.md`](CLICK-TRACKING.md). Tealium delivery and consent are documented in
[`MARTECH.md`](MARTECH.md).

## Contract

[`scripts/scripts.js`](scripts/scripts.js) creates the object during the eager phase, before
Tealium loads. [`scripts/experience.js`](scripts/experience.js) replaces the empty arrays after
personalization and experiment decisions resolve.

| Field | Type | Value |
| --- | --- | --- |
| `externalContentIdentifier` | string | `window.location.pathname` |
| `pznRecDetailsArr` | array | section/block personalization records |
| `pznPageRecDetailsArr` | array | whole-page personalization records |
| `ixpDetailsArr` | array | experiment exposure records |

The three `*Arr` fields are arrays, not JSON strings. Page-level personalization records take
precedence over section/block records when a page-view payload is built.

A personalization record contains the ECS fields produced by `pznRecord()`:
`personalization_placement`, `personalization_id`, `personalization_action`,
`personalization_workflow`, `content_id`, and `externalContentIdentifier`. Experiment records are
produced by `ixpRecord()` and include the experiment id, version, treatment, and original content
id; treatments may also include a replacement content id.

## Lifecycle

1. `loadEager()` seeds all four fields before Tealium loads.
2. The experience layer records decisions in deduplicated buffers as their corresponding page,
   section, or block application runs.
3. `prepareExperienceTracking()` flushes the buffers before `TealiumMartech.lazy()` loads
   `utag.js` and sends the initial view.
4. The experience layer also stamps `data-pzn-*` and `data-experiment-*` on affected DOM regions
   for click-time attribution. Those attributes are independent of `window.appVars`.

The eager visual budget is 1.5 seconds and the decision window is 5 seconds. Treatment context is
recorded only after replacement content lands; control context is recorded when its apply phase
runs. A late page or first-section assignment that misses the paint budget is not reported as an
exposure. The page view waits within the decision bound for successful below-the-fold applications,
then proceeds fail-open.

## ECS enrichment shim

The deployed `ies-erp` profile still builds its page-view personalization from values that legacy
production received through Next.js SSR. Edge Delivery has no equivalent server-rendered payload,
so the profile can leave `personalization_details` and `experiment_ids` empty even when
`window.appVars` is populated.

[`scripts/ecs-enrich.js`](scripts/ecs-enrich.js) is the temporary bridge. Installed before Tealium,
it wraps the profile's ECS `webAnalytics` object and the final Segment `analytics.page` boundary,
and only fills fields the profile left empty. The final boundary is required because the ECS sender
rebuilds page properties after `webAnalytics.trackPage` and otherwise filters runtime-only fields:

- `trackPage` / `analytics.page`: `personalization_details` and `experiment_ids` from
  `window.appVars`;
- `track`: `page_cas_id` from the pathname and global `experiment_ids`.

The shim is skipped with `?martech=off`, never overwrites a non-empty profile value, and does not
send an additional beacon. Remove it once the Tealium/ECS profile reads the runtime data layer and
pathname directly.

## Validation

Unit coverage lives in [`test/experience.test.js`](test/experience.test.js) and
[`test/ecs-enrich.test.js`](test/ecs-enrich.test.js).

[`scripts/diff/appvars-diff.mjs`](scripts/diff/appvars-diff.mjs) validates the browser integration:

- the four-field `window.appVars` contract and types;
- the `data-pzn-*` DOM channel;
- the outgoing `screen:viewed` PZN/IXP payload when production or measured `appVars` proves the
  fields should be present.

```bash
# Compare an authenticated local build with the committed production baseline
node scripts/diff/appvars-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/appvars-homepage.golden.json

# Use a page that contains personalization and fail on a measured gap
node scripts/diff/appvars-diff.mjs --env local --ours-path /drafts/home --assert

# Deliberately refresh the production baseline
node scripts/diff/appvars-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/appvars-homepage.golden.json
```

Production may not expose `window.appVars` because its legacy renderer supplies the equivalent
values server-side. The integration check therefore validates the fixed EDS object contract and
uses the outgoing beacon—not the presence of the object on production—as the parity truth.
