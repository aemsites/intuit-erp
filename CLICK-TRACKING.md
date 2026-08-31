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
**code-stamped** by the experience layer (`scripts/experience.js`), not authored here; the
click runtime leaves them untouched so that parity is inherited.

---

## Option B — the implemented model

**Decision:** the EDS build does **not** author `data-*` per CTA at rest (no WordPress-style "Tracking
tab"). Instead a single-file runtime (`scripts/tracking.js`) **derives** each CTA's identity from the
element + block context and **JIT-stamps** the resolved `data-*` on `pointerdown`/`keydown` (capture
phase), so the injected tracker reads them on the ensuing click. The DOM stays clean at rest; only the
**structural trail** (`data-tracking`) is stamped up front so the tracker's ancestor walk resolves.

### Track-by-default

Every CTA (`a[href]`, `button`, `summary`, `[role="button"]`) inside a **content region** (`<main>`, `<header>`,
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
   and **`id`** — the CTA's `data-track-id`: a short, readable slug the block derives from the href
   (`footer:company`, `footer:turbotax`), or a semantic id (`footer:country-us`,
   `footer:manage-cookies`) for controls that collide on href or have none. Keyed by identity, not
   DOM position, so render order never matters (see [Id-based keying](#id-based-keying)). Blank cells
   defer to the derived value.

Everything merges in `resolveCta` and is written by `stampCta`. See `scripts/tracking.js` for the
canonical implementation (`initTracking` → delegated handler → `stampInteraction`).

### Where trails come from

A block declares its trail via `trackAs(name, block, …)` (the block's `data-tracking` segment). Nested
trails come from one `trackAs` option — `items`, a selector → segment map for the block's inner
"slots". The segment is a **fixed string** for non-repeating sub-sections (footer →
`footer|footer_menus|footer_menu_section`, `footer|products`, …; article hero → share row / ToC) or an
**`(index, el) => string`** for repeated/indexed children (cards → `rw_cards_container|carousel|rw_card_N`).
Explicit authored `data-tracking` in markup always wins.

Auto-built article structure follows the same trail contract without pretending the section is a
block: `blog-template` stamps `qrc_article_hero` on the generated hero section so eyebrow and byline
links stay at the flat article-hero access point. Its relocatable share widget remains self-contained
as `qrc_article_hero|social_media`.

`items` only stamps the **trail**. Making a non-CTA element emit its **own beacon** is `alsoTrack`
(#769) — a selector → `ui_object` map. Each match gets `data-track-as=<ui_object>` so a click resolves
to it (nearest-wins over the enclosing CTA) and derives `object=content` + that `ui_object`; the
detail comes from `partLabel` (an element's heading / `*-title`, else its `img[alt]` — the card title,
matching prod). A part is **pure-derive** (no sheet) and **drops `link_name` by default** (prod omits
it on thumbnails); a slot that authors one — the card **content slot** — opts back in with
`{ as, linkName: true }`. Pair `alsoTrack` with `items` on a `display:contents` wrapper so the trail
carries the slot leaf. Card blocks wire two such wrappers per card: the thumbnail
(`…|qrc_content_card|image`, no link_name) and the body (`…|qrc_content_card|qrc_content_card_content`).

### Id-based keying

Sheet residue is keyed by each CTA's **identity** (a short `data-track-id` the block stamps during
decoration), not its DOM position. The runtime reads only `data-track-id` (`trackIdOf`) and resolves
the row by `sheetRowById` — never by href at resolution time.

Why identity, not order: the old positional key (`<blockKey>-<n>`, the CTA's index in
`block.querySelectorAll`) was fragile and mis-keyed in practice. `ctasIn` counts `data-track-skip`
controls (the footer's accordion + country toggles), the footer renders the country menu **twice**
(mobile + desktop), and prod's capture order differs from our EDS render — so prod-ordered rows
landed on the wrong CTAs. Id keying is immune to all three: skipped controls have no id, the two
country copies share one id (correct dedupe), and content-derived ids don't depend on order.

Each block supplies a **`trackId(el)`** deriver to `trackAs` (see `scripts/tracking.js`). The default
is `hrefTrackId(el, key)` = `<key>:<hrefSlug>` for a link, else `<key>:<slug(accessible name)>` for an
href-less control — a short, readable slug that strips the `https://` + own-host boilerplate
(`intuit.com/company` → `footer:company`) and labels external hosts (`turbotax.intuit.com/` →
`footer:turbotax`); duplicates within a block get a stable `-2`/`-3` suffix. A block handles its
special cases inline in that one function: the footer gives the country menu a locale id
(`footer:country-us`, so the mobile + desktop copies dedupe and can't collide with the Intuit logo),
the brand logos a `footer:brand-<host>` id, and href-less "Manage cookies" (`#`) a semantic
`footer:manage-cookies`; the video block keys its play control off the source (`video:<provider>-<id>`).
Loose content CTAs in no block are keyed `page:<…>` at interaction time. The exported helpers
`hrefSlug`, `hostLabel`, and `hrefTrackId` are the building blocks; `OWN_HOSTS` in `tracking.js` is the
one site-specific knob (which apexes strip to a path).

**Positional keying is retired.** Every block is id-keyed and the sheet has a single `id` column — no
`<blockKey>-<n>` and no DOM-index resolution (`sheetRowFor`/`pageCtas` are gone). `indexRows` still
tolerates a stray legacy `key` column so an un-republished sheet fails open, but nothing resolves by
it. Publishing the id-keyed `/tracking.json` is therefore part of shipping this — the old positional
sheet won't resolve against the id-only runtime.

---

## Parity harness

Parity is measured deterministically against a golden captured from prod (`scripts/diff/`):

- `tracker-replica.mjs` — a faithful replica of the live tracker's read logic (the oracle).
- `parity-gate.mjs` — scores our pipeline vs the golden on the 11 DOM-derivable per-click fields;
  prints per-field / per-component fidelity + a machine verdict. **Run: `node scripts/diff/parity-gate.mjs`.**
- `gen-sheet-from-golden.mjs` — reverse-engineers the residue sheet from the golden, keyed by `id`
  the way the runtime resolves (`idOf`/`assignIds`: per-block special ids, else `<key>:<hrefSlug |
  slug(label)>`, deduped per page#block). The customer's `/tracking.json` seed.
- `coverage-matrix.mjs` — a readable component × field coverage matrix.

Golden fixtures with customer campaign codes stay **local + gitignored**
(`scripts/diff/fixtures/local/`); they are never committed.

### Authenticated stage replay (workstation only)

The authenticated runner is deliberately limited to the exact `https://stage.erp.intuit.com`
origin, a dedicated Chrome profile, one browser target, and one explicit customer-golden scenario.
Observe mode sends the customer-authorized analytics click; use `Adobe Migration Test` in the
authorization reference. Captures are privacy-sanitized before leaving the page and written mode
`0600` under the gitignored local fixture directory.

```sh
node scripts/diff/live-replay-runner.mjs launch \
  --port 9339 \
  --profile-dir "$HOME/.intuit-erp-clicktrack/chrome-profile-cdp"
```

After connecting VPN and authenticating the opened stage page, qualify the explicit scenario:

```sh
node scripts/diff/live-replay-runner.mjs qualify \
  --cdp http://127.0.0.1:9339 \
  --profile-dir "$HOME/.intuit-erp-clicktrack/chrome-profile-cdp" \
  --golden /absolute/path/to/clicktrack-golden-customer.json \
  --scenario scripts/diff/fixtures/clicktrack-qualification-scenario.json \
  --out scripts/diff/fixtures/local/live-replay-qualification.json \
  --authorization-ref "customer-authorized Adobe Migration Test parity exercise YYYY-MM-DD"
```

The command refuses before clicking if authentication, consent, Tealium, tracker readiness,
runtime hashes, target isolation, or authorization is missing. The current qualification scenario
exercises only the customer golden FAQ click on `/workforce-automation`; it is not complete-golden
coverage. Remove expired local replay evidence with:

```sh
node scripts/diff/live-replay-runner.mjs purge \
  --evidence-dir scripts/diff/fixtures/local \
  --retention-days 30
```

## Status

**Implemented and wired.** `scripts/tracking.js` is loaded lazily from `scripts.js`; blocks declare
their tracking via `trackAs` (hero, cards, faq, testimonial, footer, header nav + secondary-nav,
related-blogs, case-study-header, video, quick-links, cta-band, contact-us/talk-to-sales, blog-template
article hero/share and author-bio). Card blocks (related-blogs, blog-cards) fire per-slot beacons via `alsoTrack`: the
thumbnail (`…|image`) and the body content slot (`…|qrc_content_card_content`); the blog index also
reproduces its paginated **Load More** (`…|oisp_loadmore|button`).

**Parity is measured over every beacon prod fires** (`node scripts/diff/parity-gate.mjs`) — currently
**95.6% of the 724 golden beacons** across 15 pages (717 reproduced; ~96.5% field-fidelity). What
remains (~4.4%) is **not** clean runtime work — see `CLICK-TRACKING-PATH-TO-100.md` for the full
per-cell breakdown:

- **Bucket B — EDS markup limitation (~2.1%)**: secondary-nav (our button flyout vs prod's link nav +
  search input + nested submenus), the product_banner component (not ported), the
  case-study-header share/ToC nesting (#765), the video pause control, and the faq answer-body links
  (would need a CSS restructure — the `.faq-toggle + .faq-panel` sibling selector blocks isolating the
  toggle's `accordion` trail). A team call: restructure vs. accept.
- **Bucket C — pure prod inconsistency (~1.9%)**: prod's `video` trail is stamped 1×/2×/3× for the
  same control; `link_name` is authored inconsistently and truncated to ~47 chars on the related-blogs
  rail; `ui_access_point` opt-in is uneven on loose CTAs. We emit the clean/superset value. A customer
  call: fix prod, author the sheet, or accept the superset.
- **Kept richer by choice (~0.5%)**: prod emits an empty `ui_object_detail` on carousel dots + ToC
  entries; we keep the real label rather than blank a truthful value.

## Authoring the residue sheet

The residue lives in a dedicated DA sheet published to `/tracking.json`. Author only what the runtime
cannot derive, one row per residue-bearing CTA:

- **`path`** — the page path (e.g. `/accounting/multi-entity`) for per-page body residue, or `*`
  (or blank) for site-wide chrome (nav, footer, widgets).
- **`id`** — the CTA's `data-track-id` (copy it from the rendered DOM): a readable href slug
  (e.g. `footer:company`, `nav:pricing`) or a block-set semantic id (e.g. `footer:brand-intuit`,
  `video:youtube-abc123`). Order-independent, so no re-keying when the render order shifts. This is
  the only key column — positional `<blockKey>-<n>` is retired.
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
