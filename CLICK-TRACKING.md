# Click tracking — authored `data-*` attributes

Intuit's SBSEG tracker has **two independent channels**:

- **Page view** — reads `window.appVars` (see `APPVARS.md`). Code-generated.
- **Click** (this doc) — on every click, reads `data-*` attributes off the clicked element and its
  DOM ancestors. **Authored per element**, not code-generated.

On the current WordPress `erp.intuit.com`, these attributes are set per-CTA in a **"Tracking tab"**.
Edge Delivery has no such tab; the **mechanism for attaching them to CTAs** is described in
[The EDS authoring model](#the-eds-authoring-model). This document is the
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

This gate is one of **two independent ancestor walks**, and they don't share rules: the gate tests each
ancestor's attribute **value** and stops at 5, while the [access-point trail](#the-access-point-trail)
tests **key presence** and walks the entire chain. Keep them separate when reasoning about what
resolves.

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

Two attributes cooperate to produce `ui_access_point`, and both the ordering and the opt-in are easy to
miss:

- **`data-tracking`** — collected up the ancestor chain and joined with `|`, **outermost ancestor
  first, nearest last** (broad → specific). Hyphens become underscores. The walk starts from the
  **parent of the first `data-tracking`-bearing element** at or above the click, so that nearest value
  is **consumed as an anchor and never appears in the output** (see below). Falls back to `page` when no
  ancestor carries it. Verified against the live `erp.intuit.com` bundle, real values look like
  `rw_cards_container|carousel|rw_card_1` and `footer|footer_menus|footer_menu_section` — broadest
  container on the left, most specific element on the right.
- **`data-ui-access-point`** — the opt-in switch. The trail is computed **only** if this key exists on
  the element or an ancestor. **Presence, not value:** an empty `data-ui-access-point=""` still turns
  the trail on; to disable it the attribute must be **absent**. An explicit non-empty value on the
  element wins outright — the trail is not consulted.

**The sacrificial anchor.** Because the walk begins *above* the first `data-tracking` it finds, that
nearest value is always discarded. A clicked CTA therefore needs its **own** `data-tracking` (the live
site uses `data-tracking="button"`) purely to absorb that skip — otherwise the *block's* `data-tracking`
becomes the anchor and drops out of the access point:

- CTA carries `data-tracking="button"` → the anchor is `button` → trail resolves to `…|cta_block` ✅
- CTA carries none → the block's `cta_block` becomes the anchor → trail resolves to `…|section`, and the
  block is **lost** ❌

This is why a button reports the `data-tracking` of its surrounding **block** (e.g. `cta_block`) rather
than anything on the button itself — and why the button must still carry a throwaway value of its own.

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
| `data-tracking` | **Block** (real segment) **and CTA** (throwaway anchor) | Trail falls back through ancestors, ultimately `page`; a CTA with no `data-tracking` of its own loses its block segment |
| `data-survey-*` | CTA | Emitted as `""` and forwarded |
| `data-pzn-*`, `data-experiment-*`, `data-treatment-id` | **Code** (pzn/IXP engine) | No personalization details collected |

## The EDS authoring model

**Owner: content-migration + AEM authoring.** On WordPress each CTA's attributes come from a per-CTA
"Tracking tab." EDS has no equivalent. The model below reproduces the contract from two inputs — what
code can derive from context, and an authored sheet for the rest — layered so one tracking config can be
reused across pages with local fine-tuning. **Nothing here is built yet; this is the shape put forward
for the team to ratify.**

### Auto-derive + a sparse authored layer

Most of what the live site stamps per CTA is not really content — it is derivable from context:

| Field | Derivable in code? | Source of truth |
| --- | --- | --- |
| `ui_object` | ✅ element tag (`<a>`/`<button>`) | derived |
| `ui_object_detail` | ✅ the CTA's visible label | derived |
| `ui_action`, `action` | ✅ constants (`clicked` / `interacted`) | derived |
| `object` | ✅ generic default (`content`) | derived default, sheet override |
| `data-tracking` (block segment) | ~ block name → `<block>_block` | derived default, sheet override |
| `link_name` (custom prop) | ✅ `button-<slug(label)>` | derived |
| `data-tracking` (CTA anchor) | ✅ constant (`button` / `link`) | derived — always stamped |
| `object_detail`, a semantic `object` | ❌ | sheet |
| `wa-link` | ❌ opaque id | sheet |
| extra `custom-properties` | ❌ | sheet / section / page |
| `survey-*` | ❌ | sheet (opt-in per column) |

**Code derives a full baseline payload for every opted-in CTA; the sheet supplies only the residue and
any overrides; the two merge at decoration time.** On a standard CTA the authored row is nearly empty.

### Opt-in trigger and the sheet key

Tracking is **opt-in**: a CTA is tracked only inside a block carrying a variant class with a configurable
prefix — default `tracking-`, held as a single code constant so it can be changed later — e.g.
`tracking-1234`. The suffix is a **key** into a tracking sheet; a `key` column holds whatever the team
prefers, an opaque id (`1234`) or a slug (`schedule-demo`). One block may hold several CTAs; the sheet
row's per-CTA entries are matched to the CTAs by **DOM order** within the block.

Code-built blocks (header, footer, autoblocks) stamp their attributes in code — the same way the
pzn/experiment layer already does — so the class+sheet path is only for authored blocks.

### Identity vs context — the precedence model

The tracker natively inherits **exactly one** thing: the access-point trail (`data-tracking`).
Everything else is read once, off the single anchor CTA. So the fields divide cleanly, and only context
ever crosses DOM levels:

- **Identity** — `object`, `object_detail`, `action`, `ui_object`, `ui_object_detail`, `ui_action`,
  `wa-link`, `survey-*`. Resolved **per CTA** as `sheet ?? derived` and stamped on the CTA. Section and
  page metadata **do not** touch these: letting a broad level override a CTA-specific value would fan
  out across the heterogeneous CTAs beneath it.
- **Access-point trail** — `data-tracking`. **Additive, and the tracker assembles it for free.** Each
  level stamps its own segment: page metadata → `<main>`, section metadata → the section, the sheet's
  access-point (default `<block>_block`) → the block, plus the throwaway anchor on the CTA. The tracker
  walks and concatenates `page|section|block`. Section/page here **contribute a segment**; they do not
  override.
- **`custom-properties`** — **merged** across page + section + sheet + derived (`link_name`) and stamped
  as one string on the CTA. On a key collision the **more specific level wins** (CTA > section > page),
  so a CTA can always override an inherited campaign prop.

This is what lets one sheet row be reused across pages: the *identity* stays fixed in the row, while the
parts that legitimately vary by location — the trail and shared campaign custom-properties — are exactly
the parts that cascade.

### Cascade mechanics

- **The tracker only walks for the trail.** Section/page values for non-trail fields never reach the
  payload on their own — decoration must resolve the cascade and write the final value onto the **CTA**.
  Stamping `data-object` (or any identity field) on a section does nothing.
- **Blank = defer.** An empty value at any layer means "no opinion, fall through to the next layer." The
  one exception is `survey-*`, where empty is meaningful downstream — which is why survey stays
  identity/per-CTA and opt-in per column.
- **Timing.** Derived and section/page metadata are available synchronously at decoration; the sheet is
  an async fetch sitting *between* them in priority. Stamp `local ?? derived` immediately (tracking works
  before the sheet loads), then re-resolve to `local ?? sheet ?? derived` when the sheet lands.
- **Blast radius.** Editing one section's or page's tracking metadata shifts the access point of *every*
  tracked CTA beneath it — the intended consistency lever, but one edit moves many payloads.

### Migration from WordPress

- **Store only the diff.** For each source CTA, compute the code baseline, diff the live attributes
  against it, and write **only the difference** to the sheet. Most rows come out nearly empty.
- **Preserve the wa-link path faithfully.** A CTA with `data-wa-link` and no `data-object` must stay on
  the wa-link path — do **not** inject a derived `data-object`, or the beacon changes shape. The
  "always derive an `object`" default is for net-new EDS CTAs only.
- **Preserve tag choice.** Only `<a>` yields `link_href`; migrating a modal-opener `<button>` into a
  link silently adds it.

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

The authoring model above neutralizes traps 1–4 by construction: code owns attribute assembly, so it
always sets `data-object` on the full path, builds `custom-properties` from structured columns (no
hand-written `key|value` strings), controls `data-ui-access-point` presence, and emits `survey-*` only
for columns an author actually filled.

## Building & validating (dev guide)

The runtime is implemented and loaded **lazily** — it is not render-critical, so it never touches the
eager/LCP module graph:

- [`scripts/tracking.js`](scripts/tracking.js) — the whole runtime in one file (sheet fetch, resolve,
  stamp, orchestration), dynamically imported in `loadLazy` like `pzn.js`/`exp.js`.
- [`scripts/tracking/derive.js`](scripts/tracking/derive.js) — the derivation helper, split out only
  because the Node dev tools import it too.

**Authoring a tracked CTA**

1. Give the block a `tracking-<key>` variant class (the prefix is a constant in `tracking.js`). Its CTAs
   are now tracked with fully **derived** values — no sheet row needed if that is enough.
2. For the authored residue (a `wa-link`, a semantic `object`/`object-detail`, extra `custom-properties`,
   `survey-*`), add a row to the tracking sheet keyed by `<key>`. Blank cells defer to the derived value;
   multiple CTAs in one block map to rows by DOM order via the `cta` column.
3. Page/section access-point segments come from page metadata `tracking` and a Section Metadata
   `Tracking` row — not the sheet.

**Dev tools** (Node, `scripts/diff/`, never shipped)

- **Seed the sheet from prod** — `node scripts/diff/extract-tracking.mjs --path / --out out.json`
  captures a prod page, subtracts what code derives, and emits deduped residue rows (scraped output is
  gitignored — review before pasting into the sheet).
- **Check parity** — `node scripts/diff/clicktrack-diff.mjs --path / --ours <url> --assert` diffs every
  CTA's computed payload, prod vs our build. `scripts/diff/tracker-replica.mjs` is the reverse-engineered
  oracle both tools share.
- The `--ours` side needs the dev server (`npx @adobe/aem-cli up --html-folder drafts` +
  `drafts/click-tracking.plain.html`). Note: `aem up` builds a `<branch>--<repo>--<owner>.aem.page` host,
  so a branch name past the 63-char DNS-label limit is rejected — run it from `main` or a short branch.

**Tests** — `test/tracking-*.test.js` + `test/clicktrack-diff.test.js` (unit) and
`test/tracking-parity.test.js` (end-to-end: the runtime's output, read back through the oracle, matches
the prod `cta_block` payload).

## Status

The **runtime + tooling are implemented** on this branch (dev guide above): opt-in `tracking-` blocks,
lazy decoration, the reverse-engineered oracle, the prod extractor, and the parity harness, with unit +
end-to-end parity tests. The access-point behaviour (broad→specific trail, sacrificial anchor) was
**verified against the live `erp.intuit.com` bundle**, where the click tracker ships inside the Next.js
app; multi-level trails (two-, three-, four-level `data-tracking` chains on the homepage) are the norm.
No page is tracked until a `tracking-` class is authored, so there is no site-visible change yet.

**Deferred (follow-up):** porting the full sitemap into the sheet — run the extractor across
`sitemap.xml`, dedupe, and reconcile parity page by page. The `data-pzn-*` / `data-experiment-*`
code-stamping remains a separate change in `scripts/pzn.js` / `scripts/exp.js`.
