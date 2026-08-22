# Click tracking

Intuit's SBSEG analytics has **two independent channels**:

- **Page view** — reads `window.appVars` (see `APPVARS.md`). Code-generated.
- **Click** (this doc) — on every click, the injected tracker reads `data-*` attributes off the
  clicked element and its ancestors and posts a Segment `content:<action>` beacon.

This document is the reference for **what the injected tracker reads** (the contract) and **how our
Edge Delivery build produces it** (the Option B runtime). The authoring model is no longer an open
question — see [Option B](#option-b--the-implemented-model).

---

## The injected tracker (not in this repo)

The sender+reader is `uxfabric.intuitcdn.net/analytics/prod/track-event-lib*.min.js`, a **generic,
delegated, DOM-driven click tracker injected via the `intuit/ies-erp` Tealium profile** — present on
prod and stage, absent from the public `*.aem.page` preview (its martech chain is consent/VPN-gated).
This repo never ships the tracker; it only produces the `data-*` the tracker reads. The beacon is a
Segment `track` `content:<action>` POST to `eventbus.intuit.com`.

## The contract — what the tracker reads

**The gate.** On click the tracker walks up **at most 5 ancestors** for `data-object` **or**
`data-wa-link`. If neither is found, nothing is sent (silently). There is a single code path — a
`data-wa-link` does **not** replace `object`/`action` (contrary to older notes); it only **adds**
`data-wa-link` + `icom_user_action`.

**Payload.** `event = ${object}:${action}`. Unauthored defaults: `object=content`, `action=engaged`,
`ui_object=link`, `ui_action=clicked`.

| Attribute | Payload field |
| --- | --- |
| `data-object` | `object` (default `content`) |
| `data-object-detail` | `object_detail` |
| `data-action` | `action` (default `engaged`) |
| `data-ui-object` | `ui_object` (default `link`) |
| `data-ui-object-detail` | `ui_object_detail` |
| `data-ui-action` | `ui_action` (default `clicked`) |
| `data-ui-access-point` | `ui_access_point` — see the trail below |
| `data-custom-properties` | each `key\|value` pair expands to a **top-level** property (there is no `custom_properties` object) |
| `data-wa-link` | top-level `data-wa-link` + `icom_user_action` (`<wa-link> [breadcrumb]`) |

**The access-point trail.** `ui_access_point` is the `data-tracking` chain, collected up the ancestor
chain and joined with `|` (hyphens → underscores), **broad→specific, with the nearest/leaf
`data-tracking` skipped** (the "sacrificial anchor"). It is computed **only if `data-ui-access-point`
is present** on the element or an ancestor (presence, not value — an empty string still opts in). When
no trail resolves, prod falls back to `""` inside the global nav/header and `page` elsewhere.

**`link_name` is authored, not derived.** The tracker source contains **zero** references to
`link_name` — it rides in `data-custom-properties` (prod's CMS emits `<ui_object>-<slug(label)>`).

**Survey.** Any `data-survey-*` is forwarded (`camelCase`→`snake_case`); `data-survey-answer-*` strips
the prefix and coerces `"true"`/`"false"` to booleans.

**Personalization / experiment.** `data-pzn-*` / `data-experiment-*` / `data-treatment-id` are
**code-stamped** by the pzn/IXP layer (`scripts/pzn.js` / `scripts/exp.js`), not authored here; the
click runtime leaves them untouched so that parity is inherited.

---

## Option B — the implemented model

**Decision:** the EDS build does **not** author `data-*` per CTA at rest (no WordPress-style "Tracking
tab"). Instead a single-file runtime (`scripts/tracking.js`) **derives** each CTA's identity from the
element + block context and **JIT-stamps** the resolved `data-*` on `pointerdown`/`keydown` (capture
phase), so the injected tracker reads them on the ensuing click. The DOM stays clean at rest; only the
**structural trail** (`data-tracking`) is stamped up front so the tracker's ancestor walk resolves.

### Track-by-default

Every CTA (`a[href]`, `button`, `[role="button"]`) inside a **content region** (`<main>`, `<header>`,
`<footer>`) is tracked — matching the live tracker's document-wide model (prod annotates ~all content
links). A CTA in **no** declared block is tracked under the `page` key with pure-derive defaults.

- **Opt out** pure-UI controls (hamburger, toggles, close) with `data-track-skip`.
- A **declared `tracking-` block is tracked wherever it mounts** — even outside the content regions
  (e.g. the floating talk-to-sales widget the runtime appends to `<body>`), while undeclared body-root
  chrome (OneTrust, dev sidekick) stays untracked.

### Three inputs, in precedence order

1. **Derive** (`deriveForCta`) — the ~majority of the payload from the element: `object` (`content`, or
   `video` for a YouTube/Vimeo link), `ui_object` (`link`/`button`/`link_icon`/`video_link`),
   `ui_object_detail` + `link_name` from the accessible name (text → `img[alt]` → `aria-label`),
   `action` (`interacted`, `engaged` for video links), and the `data-tracking` sacrificial anchor.
2. **Block defaults** (`trackAs`) — a block's `decorate()` **declares** its trail segment(s) and any
   payload defaults (`object`/`action`/`uiObject`), `linkName:false` to suppress the derived
   `link_name`, and `skip` selectors. It is a *declaration*, not a tracking gate. Defaults resolve
   from the CTA's **nearest** ancestor carrying them, so a block can set a default and a sub-section
   refine it.
3. **Sheet residue** (`/tracking.json`) — the authored values the derive cannot know: `wa-link`
   campaign codes, semantic `object_detail` / `ui_object`, non-default `action`, and authored
   `link_name`. Two authoring columns: **`path`** (the page path, or `*`/blank for site-wide chrome)
   and **`key`** (`<blockKey>-<n>`, 1-based CTA order). Blank cells defer to the derived value.

Everything merges in `resolveCta` and is written by `stampCta`. See `scripts/tracking.js` for the
canonical implementation (`initTracking` → delegated handler → `stampInteraction`).

### Where trails come from

A block declares its trail via `trackAs(name, block, …)` (the block's `data-tracking` segment). Nested
trails come from two `trackAs` options: `itemSelector`+`itemLabel` for **indexed** repeated children
(cards → `rw_cards_container|carousel|rw_card_N`) and `segments` (a selector → segment map) for
**fixed** sub-sections (footer → `footer|footer_menus|footer_menu_section`, `footer|products`, …;
article hero → share row / ToC). Explicit authored `data-tracking` in markup always wins.

---

## Parity harness

Parity is measured deterministically against a golden captured from prod (`scripts/diff/`):

- `tracker-replica.mjs` — a faithful replica of the live tracker's read logic (the oracle).
- `parity-gate.mjs` — scores our pipeline vs the golden on the 11 DOM-derivable per-click fields;
  prints per-field / per-component fidelity + a machine verdict. **Run: `node scripts/diff/parity-gate.mjs`.**
- `gen-sheet-from-golden.mjs` — reverse-engineers the residue sheet from the golden, keyed to the
  runtime's `(path, key, DOM-index)` (the customer's `/tracking.json` seed).
- `coverage-matrix.mjs` — a readable component × field coverage matrix.

Golden fixtures with customer campaign codes stay **local + gitignored**
(`scripts/diff/fixtures/local/`); they are never committed.

## Status

**Implemented and wired.** `scripts/tracking.js` is loaded lazily from `scripts.js`; blocks declare
their tracking via `trackAs` (hero, cards, faq, testimonial, footer, header nav + secondary-nav,
related-blogs, case-study-header, video, quick-links, cta-band, contact-us/talk-to-sales, blog-template
author-bio). Current parity is **~96% of the DOM-derivable per-click fields** across a 15-page golden.

Remaining gaps are tracked out-of-band and fall into three buckets: **(A)** markup-structure deltas in
our ported blocks (e.g. blog cards tracked per-thumbnail on prod — issues #765, #769); **(B)** prod-side
authoring inconsistencies where we emit a clean/superset value (inconsistent `link_name` omission,
empty `ui_object_detail` on dots/ToC, inconsistent `video` trails); **(C)** a small tail of
structurally-entangled trails on our end.

## Authoring the residue sheet

The residue lives in a dedicated DA sheet published to `/tracking.json`. Author only what the runtime
cannot derive, one row per residue-bearing CTA:

- **`path`** — the page path (e.g. `/accounting/multi-entity`) for per-page body residue, or `*`
  (or blank) for site-wide chrome (nav, footer, widgets).
- **`key`** — `<blockKey>-<n>` (the block's `tracking-<key>` and the CTA's 1-based DOM order), or a
  bare `<blockKey>` for a single-CTA block.
- Residue columns: `object`, `object-detail`, `action`, `ui-object`, `ui-object-detail`, `ui-action`,
  `ui-access-point`, `wa-link`, `custom-properties` (`k=v` pairs), `survey`. Blank cells are dropped
  and defer to the derived value.

### Authoring traps

1. **A `|` or `,` inside a `custom-properties` value** breaks the tracker's `k|v,k|v` parse — the pair
   is dropped. The runtime refuses to emit such values rather than corrupt the string.
2. **`data-ui-access-point` is presence-gated** — an empty value still turns the trail on; the runtime
   manages this attribute, so authors don't set it directly.
3. **Prod's authored codes are inconsistent** (see the (B) bucket above and
   `scripts/diff/fixtures/local` notes). We replicate prod for parity; corrections belong in the sheet
   + golden with the customer's sign-off, not in block code.
