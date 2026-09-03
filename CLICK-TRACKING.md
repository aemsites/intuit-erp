# Click tracking

Intuit's ECS tracker has two related data paths:

- page views use `window.appVars` and the enrichment bridge in [`APPVARS.md`](APPVARS.md);
- clicks use the DOM contract and runtime described here.

Tealium injects the sender; this repository does not send ECS click beacons itself. It prepares the
DOM so the injected tracker can read the correct fields when a user interacts.

## Injected tracker contract

The `ies-erp` Tealium profile injects Intuit's delegated DOM tracker from
`uxfabric.intuitcdn.net`. On click, it searches the target and at most five ancestors for
`data-object` or `data-wa-link`. If neither exists, it sends nothing. A `data-wa-link` augments the
normal payload; it does not replace `object` or `action`.

The event name is `<object>:<action>`. The tracker defaults to `content:engaged`,
`ui_object=link`, and `ui_action=clicked` when a value is absent.

| DOM attribute | ECS field |
| --- | --- |
| `data-object` | `object` |
| `data-object-detail` | `object_detail` |
| `data-action` | `action` |
| `data-ui-object` | `ui_object` |
| `data-ui-object-detail` | `ui_object_detail` |
| `data-ui-action` | `ui_action` |
| `data-ui-access-point` | opts into computed `ui_access_point` |
| `data-custom-properties` | `key\|value` pairs expanded into top-level fields |
| `data-wa-link` | `data-wa-link` and `icom_user_action` |
| `data-survey-*` | normalized survey fields |

`ui_access_point` comes from ancestor `data-tracking` segments, broad to specific, with hyphens
converted to underscores. The closest segment is a sacrificial anchor and is omitted. The trail is
computed only when `data-ui-access-point` is present; an empty value still opts in. If no trail
remains, the tracker uses `page` outside the header and an empty value inside it.

The tracker does not derive `link_name`. Production authors it through `data-custom-properties`;
our runtime derives the equivalent value unless a block or sheet override suppresses or replaces
it.

Personalization attributes (`data-pzn-*`, `data-experiment-*`, and `data-treatment-id`) are stamped
by [`scripts/experience.js`](scripts/experience.js). The click runtime does not replace them.

## Runtime model

[`scripts/tracking.js`](scripts/tracking.js) is initialized during lazy loading. It tracks anchors,
buttons, summaries, and `[role="button"]` elements in `main`, `header`, and `footer`. A declared
tracking block is also eligible when mounted elsewhere, such as the floating contact widget.
Third-party body-root chrome remains outside the default scope.

The runtime stamps payload attributes just in time on capture-phase `pointerdown` and keyboard
activation, before the injected tracker handles the ensuing click. At rest it keeps only structural
trail metadata, stable ids, block defaults, and opt-out markers.

The eager ECS shim also keeps non-navigation click work out of the interaction task. Calls to
`webAnalytics.track` made during a button, same-page hash, download, modified, or new-context click
are queued with `scheduler.postTask({ priority: 'background' })`, falling back to `setTimeout` where
the Scheduling API is unavailable. The queue releases one tracking call per task. Same-window link
and form navigation remains synchronous so the tracker can form its batch before unload; any queued
calls are drained on `visibilitychange` to hidden or `pagehide` as a final delivery guard.

Values merge in this order:

1. **Derived baseline** — accessible label, link/button/icon/video type, default action, and
   `link_name`.
2. **Region context** — when an experience renderer publishes `window.__pznTrackingContext`, the
   nearest personalization/experiment region contributes base custom properties.
3. **Block declaration** — trail segments, stable id strategy, payload defaults, and skipped
   controls declared through `trackAs()`.
4. **Tracking sheet** — sparse per-CTA residue from `/tracking.json`; authored values win.

The sheet is fetched once and failure is non-blocking. Without a matching row, derived and block
values still produce a valid payload.

### Track-by-default and opt-outs

- Undeclared CTAs in a tracked page region use the `page` namespace and derived defaults.
- Use `data-track-skip` for pure UI controls such as menu toggles and close buttons.
- `alsoTrack` can make a non-CTA child, such as a card image or content slot, its own beacon source.
  These parts are derived only and do not read a sheet row.

### Block declarations

Call `trackAs(name, block, options)` from a block's decorator. Authored `data-tracking` and
`data-track-id` values take precedence over generated values.

| Option | Purpose |
| --- | --- |
| `key` | `tracking-<key>` class and id namespace; defaults to `name` |
| `trackId(el)` | custom stable `data-track-id` derivation |
| `items` | selector-to-segment map for nested trails |
| `alsoTrack` | selector-to-`ui_object` map for non-CTA beacon sources |
| `payload(el)` | per-CTA, sheet-shaped runtime defaults |
| `object`, `action`, `uiObject` | block payload defaults |
| `linkName: false` | remove the derived `link_name` |
| `skip` | selector for pure UI controls |

By default, CTA ids are `<key>:<hrefSlug>` and fall back to `<key>:<labelSlug>` for href-less
controls. Duplicate default ids receive numeric suffixes within a block render. Blocks should
provide semantic ids when identity must survive reordering, hrefs collide, controls have no href,
or duplicated responsive markup represents one logical CTA. Positional ids are retired because
render order is not stable.

`items` adds trail segments to inner slots. `alsoTrack` is different: it marks the matched element
as an interaction target with `data-track-as`. Use both when a card subpart needs its own beacon and
its own trail leaf.

## Tracking sheet

`/tracking.json` stores only values that code cannot derive. Each row is addressed by:

- `path`: a normalized page path, or `*`/blank for site-wide chrome;
- `id`: the rendered CTA's stable `data-track-id`.

Page-scoped rows win over a global row with the same id. Blank residue cells defer to code.

Supported residue columns are `object`, `object-detail`, `action`, `ui-object`,
`ui-object-detail`, `ui-action`, `ui-access-point`, `wa-link`, `custom-properties`, and `survey`.
`custom-properties` and `survey` use newline- or semicolon-separated `key=value` pairs in the sheet.

Authoring constraints:

- `|` and `,` cannot appear in a custom-property key or value because they are tracker delimiters;
  invalid pairs are dropped.
- `data-ui-access-point` is presence-gated and managed by the runtime. An authored value does not
  replace the computed trail.
- Changes that intentionally correct inconsistent production values require a reviewed sheet and
  golden update; do not bury campaign residue in block code.

## Validation and status

Run the unit suite for derivation, ids, sheet resolution, JIT stamping, block wiring, and region
context:

```bash
npm test
```

The deterministic parity tools are in [`scripts/diff/`](scripts/diff/):

- `tracker-replica.mjs` reproduces the injected tracker's DOM read logic;
- `parity-gate.mjs` scores the local derivation and sheet against a production golden;
- `gen-sheet-from-golden.mjs` and `sheet-from-our-build.mjs` generate/rekey sparse residue;
- `coverage-matrix.mjs` reports component-by-field coverage;
- `live-replay-runner.mjs` performs bounded, customer-authorized stage qualification.

```bash
node scripts/diff/parity-gate.mjs
```

Customer golden files and replay evidence belong under the gitignored
`scripts/diff/fixtures/local/` directory. A run with no local golden has no production beacons to
score and is not evidence of parity. This reference intentionally omits point-in-time percentages;
generate the current totals from the reviewed local golden.
