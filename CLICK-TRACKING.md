# Click tracking — authored `data-*` attributes

Intuit's SBSEG tracker has **two independent channels**:

- **Page view** — reads `window.appVars` (see `APPVARS.md`). Code-generated.
- **Click** (this doc) — on every click, reads `data-*` attributes off the clicked element and its
  DOM ancestors. **Authored per element**, not code-generated.

On the current WordPress `erp.intuit.com`, these attributes are set per-CTA in a **"Tracking tab"**.
Edge Delivery has no such tab, so **how authors attach these attributes to CTAs is an open decision**
— see [The EDS authoring model](#the-eds-authoring-model-the-open-decision). This document is the
reference for *what* the tracker reads, so whoever builds that mechanism knows the contract.

> Scope: the attributes below are **authored content** except the personalization/experiment ones,
> which are **code-stamped** by the pzn/experimentation layer (`scripts/pzn.js`, `scripts/exp.js`) and
> wired separately. Nothing here is emitted by the current EDS build yet.

---

## The gate — no `data-object` or `data-wa-link`, no event

On click the tracker walks up **at most 5 ancestors** from the clicked element looking for either
`data-object` or `data-wa-link`. If neither is found (or the walk reaches `<body>` first), the handler
returns and **nothing is sent — silently, with no console error.** Which attribute is present decides
the payload shape:

| Present | Path | Result |
| --- | --- | --- |
| `data-wa-link` only | wa-link | Minimal "link clicked" signal. `object`/`ui_object` are hardcoded to `walink`, `action`/`ui_action` to `INTERACTED`. **Any `object`/`action` attributes on the element are discarded.** |
| `data-object` | full | All fields below are read off the element and forwarded. |

The 5-ancestor walk matters: a click usually lands on an inner `<span>`, and the tracked attributes
live on the `<button>`/`<a>` one or more levels up.

## Core payload fields (full path only)

| Attribute | Payload field |
| --- | --- |
| `data-object` | `object` |
| `data-object-detail` | `object_detail` |
| `data-action` | `action` |
| `data-ui-object` | `ui_object` |
| `data-ui-object-detail` | `ui_object_detail` |
| `data-ui-action` | `ui_action` |
| `data-ui-access-point` | `ui_access_point` — own value wins, else the computed trail (below) |
| `data-custom-properties` | parsed `key\|value,key\|value` → `custom_properties` |
| `data-wa-link` | folded into `custom_properties["data-wa-link"]` |

## The access-point trail

Two attributes cooperate to produce `ui_access_point`, and the opt-in is easy to miss:

- **`data-tracking`** — collected up the *entire* ancestor chain and joined with `|` (hyphens become
  underscores). Starts from the **parent** of the first match, so the clicked element's own
  `data-tracking` is skipped. Falls back to `page` when no ancestor carries it.
- **`data-ui-access-point`** — the opt-in switch. The trail is computed **only** if this key exists on
  the element or an ancestor. **Presence, not value:** an empty `data-ui-access-point=""` still turns
  the trail on; to disable it the attribute must be **absent**.

This is why a button typically reports the `data-tracking` of its surrounding **block** (e.g.
`cta_block`), not anything on the button itself.

## Personalization / experiment — code-stamped, not authored

Triggered by `data-pzn-placement` on any ancestor (the walk runs all the way to `<body>`):

| Attribute | Payload field |
| --- | --- |
| `data-pzn-placement` | `personalization_placement` |
| `data-pzn-id` | `personalization_id` |
| `data-experiment-id` | `experiment_id` |
| `data-experiment-version` | `experiment_version` |
| `data-treatment-id` | `experiment_treatment` |

`personalization_action` / `personalization_workflow` are **tracker constants** (`im` / `marketing`),
not attributes. A non-empty **`window.appVars.pznPageRecDetailsArr` overrides all of this on click** —
the DOM-collected details are dropped in favour of the page-level array.

These come from the personalization/experimentation engine, so they are **stamped by code**
(`scripts/pzn.js` / `scripts/exp.js`), not by authors — tracked as a separate change.

## Survey / questionnaire

Any `data-survey-*` is forwarded automatically (`camelCase` → `snake_case`, no allowlist).
`data-survey-answer-*` is special-cased: the `survey_answer_` prefix is stripped and `"true"`/`"false"`
become real booleans. **Empty survey attributes still ship** as empty strings — `data-survey-name=""`
lands on the payload, it is not omitted.

## Don't bother authoring these — they never resolve

The tracker looks a few fields up with **snake_case** dataset keys, but `dataset` only exposes
camelCase, so they always come out `undefined` regardless of markup: `payroll_workers`,
`*_feature_coverage`, `interested_in_*`, `search_term`, `search_query`, and anything with a colon
(`questionnaire:*` — colons can't appear in a dataset key at all). Listed so nobody wastes time
authoring them.

---

## Who sets what

| Attribute(s) | Authored on | If left blank |
| --- | --- | --- |
| `data-object` | CTA | Falls to the wa-link path, or **untracked** if `data-wa-link` is also blank |
| `data-wa-link` | CTA | No fallback; needs `data-object` to track |
| `data-object-detail`, `data-ui-*`, `data-action` | CTA | Emitted as `""` (and ignored entirely on the wa-link path) |
| `data-ui-access-point` | CTA | **Presence alone** enables the block trail |
| `data-custom-properties` | CTA | No custom props beyond `data-wa-link` |
| `data-tracking` | **Block**, not the CTA | Trail falls back through ancestors, ultimately `page` |
| `data-survey-*` | CTA | Emitted as `""` and forwarded |
| `data-pzn-*`, `data-experiment-*`, `data-treatment-id` | **Code** (pzn/IXP engine) | No personalization details collected |

## The EDS authoring model (the open decision)

**Owner: content-migration + AEM authoring.** On WordPress each CTA's attributes come from a per-CTA
"Tracking tab." EDS has no equivalent, so a mechanism is needed for authors to attach the *authored*
attributes above to CTAs. Options to weigh:

- **Block/section metadata** the block code translates into `data-*` on the rendered CTA (fits the EDS
  model; scales to per-block defaults like `data-tracking`).
- **An authoring convention** (e.g. a tracking table/row alongside the CTA) read during decoration.
- **Carried through content migration**, if the source WordPress attributes are exported with content.

Whatever is chosen has to account for the traps below — several forms of *silent* mis-authoring.

## Authoring traps

1. **Filling the object fields but not `data-object` itself** → drops to the wa-link path and every
   authored `object`/`action`/`ui-*` value is discarded. The tab looks complete; the payload isn't.
2. **A `|` inside a `data-custom-properties` value** → it parses as `key|value` pairs split on commas;
   any segment that isn't exactly two parts is dropped (e.g. `link_name|button-nav|schedule_demo`
   silently never reaches the payload).
3. **Clearing `data-ui-access-point` doesn't turn it off** — the check is key presence, so a
   saved-but-empty field still switches the block trail on. To disable it, remove the attribute.
4. **Blank `data-survey-*` still ship** as empty strings, which is different downstream from the field
   never having been sent.

## Status

Documentation only — no site-visible change; nothing here is wired into the EDS build yet. The
authoring mechanism is the open decision above (content/AEM). The `data-pzn-*` / `data-experiment-*`
code-stamping is a separate change in `scripts/pzn.js` / `scripts/exp.js`.
