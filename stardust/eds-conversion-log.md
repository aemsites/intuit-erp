# EDS conversion log — Intuit Enterprise Suite replica

Runtime: **vanilla aem-boilerplate** (`scripts/aem.js` + `scripts.js`), see
`stardust/runtime-contract.json`. Buttons: EDS convention `<strong><a>` →
`.button.primary` (navy), `<em><a>` → `.button.secondary` (outline). Foundation
tokens + button + section scaffold live in `styles/styles.css` (do NOT redefine).

Source prototypes: `stardust/prototypes/{index,pricing,accounting,compare,erp-solutions}-proposed.html`
(each = header + body sections + footer; shared header/footer in `stardust/prototypes/shared/`).

## Locked block library (one block per section type, reused across pages)

| Block | Used on | Authoring shape |
|---|---|---|
| `hero` | all 5 | dark gradient band. rows: eyebrow / h1 / lede / CTAs (`<strong><a>`+`<em><a>`) / optional media `<img>`. Variant `.hero.form` (pricing) shows a lead form on the right. |
| `logo-strip` | index | dark band, row of customer logo `<img>`s. |
| `stat-band` | index, pricing | eyebrow/heading as default content; one row per stat: number / desc / company / segment. Variant `.stat-band.dark` (pricing "Data-backed performance"). |
| `feature-grid` | index | section head default content; one row per card: `<img>` / title / (optional +). 2×2. |
| `media-text` | index(migration), pricing, accounting, erp-solutions | one row = one media+text split: eyebrow / heading / body / media / optional CTA. Variant `.media-text.reverse` (image left). |
| `tabs` | accounting | tab labels row + one panel row (eyebrow/heading/body/media). First active. |
| `comparison-table` | compare | real `<table>`: 4 product columns, grouped rows w/ blue band headers, ✓ glyphs / text values. |
| `icon-columns` | compare | 3 columns: icon `<img>` / eyebrow / heading / body. |
| `testimonial` | index(video), compare | quote + attribution + media/headshot. Variant `.testimonial.video` (play button + poster, index). |
| `cta-band` | index (first-call/90%) | split: left stat card (sky) + right navy card (eyebrow/heading/body/CTA). |
| `form` | pricing, accounting, compare, erp-solutions | "Let's connect" static styled lead form (5 fields + submit). Heading/subtext default content. |
| `faq` | index, compare, erp-solutions | head default content; one row per Q/A: question / answer. `<details>`-based accordion. |
| `disclosure` | index, erp-solutions | blue bar, `<details>` "Important pricing details…". |
| `solution-cards` | erp-solutions | 2 large cards: heading / bullets / CTA / media. |

## Chrome
- `header` block ← `content/nav.html` fragment: brand strip (INTUIT + 4 sibling brands) + sticky nav (INTUIT Enterprise Suite wordmark + nav + Schedule a call) + cyan events bar.
- `footer` block ← `content/footer.html` fragment: two-tier (4 link columns + search + sitemap/country + social; then INTUIT logo + secondary links + brand logos + copyright + legal + TRUSTe).

## Content pages (DA body fragments, `content/*.html`)
`content/index.html`, `content/pricing.html`, `content/accounting.html`,
`content/compare.html`, `content/erp-solutions.html` — each starts `<body>`,
`metadata` block first (Title from `<h1>`, Description), empty `<header></header>`/`<footer></footer>`,
one `<div>` section per block. Images authored as DA-hosted `content.da.live` URLs
after upload (or local `/media/` during build).

## Deploy target
New DA site **aem-intuit-erp**. Content → DA via MCP (`da_create_source`).
Block code → GitHub repo + AEM Code Sync bound to the DA site (user-owned infra).

## Fonts
"AvenirNext forINTUIT" is a licensed kit — NOT rehosted. First in the stack;
self-hosted **Mulish** (OFL, `styles/fonts/mulish-variable.woff2`) is the metric
substitute. Licensed drop-in later wins with no code change.
(Boilerplate `styles/fonts.css` still references demo `roboto-condensed`; unused
by this design — harmless async load, left untouched.)

---

## FINAL CONVERSION OUTCOME (2026-07-20)

**Status: complete.** 14 blocks + header/footer chrome + 5 content pages, all
QA-green in the local dev-server harness (Playwright @1440 and @360).

### Blocks delivered (`blocks/<name>/<name>.{js,css}`)
| Block | Variants | Pages |
|---|---|---|
| `hero` | `.form` (pricing lead card, built in JS) | all 5 (compare `cmp-hero` folded in) |
| `logo-strip` | — | index |
| `stat-band` | `.dark` (pricing perf) | index, pricing |
| `feature-grid` | — | index |
| `media-text` | `.reverse` (alt-start splits) · `.sky` (pricing switch) · `.center` (pricing built) · `.cards` (index migration) · `.power` (erp power list) | index, pricing, accounting, erp-solutions |
| `tabs` | — | accounting |
| `comparison-table` | — | compare |
| `icon-columns` | — | compare |
| `testimonial` | `.video` (index) / default (compare) | index, compare |
| `cta-band` | — | index |
| `form` | `.boxed` (compare) · `.boxed.sky` (erp, hidden labels) / default underline (accounting) | accounting, compare, erp-solutions |
| `faq` | `.cmp` (light band) | index, compare, erp-solutions |
| `disclosure` | — | index, erp-solutions |
| `solution-cards` | — | erp-solutions |

### Key implementation decisions
- **Full-bleed bands:** vanilla `aem.js` adds `<name>-container` to the section
  and `<name>-wrapper` to the block wrapper. Band backgrounds/vertical padding
  go on `.section.<name>-container` (full-bleed); content stays capped by the
  foundation `main > .section > div` (1380px + 40px padding = prototype
  `.container`).
- **Section heads = default content, no reabsorb JS.** Eyebrow/H2/intro that sit
  above a repeating block are authored as plain content before the block and
  styled via `.<name>-container .default-content-wrapper …`. Zero pixel change,
  no JS. Trailing foot/disclaimer paragraphs authored after the block.
- **Foundation additions (styles.css only):** token aliases `--text`,
  `--heading`, `--sand`, `--ink-teal` (lifted block CSS uses prototype names);
  `main > .section { margin: 0 }` (bands sit flush); `main .section:empty { display:none }`
  (empty metadata-section collapse); `.section.narrow` helper. No tokens redefined.
- **Buttons:** EDS `<strong><a>`→`.button.primary`, `<em><a>`→`.button.secondary`.
  On dark heros + navy CTA card, `.button.primary` is overridden to white-fill /
  `.button.secondary` to white-outline (block-scoped).
- **Chrome (`header`/`footer` blocks):** each block embeds the canonical chrome
  DOM and renders it directly (brand strip + sticky nav + cyan events bar;
  two-tier footer). They *attempt* to read the authorable `/nav` and `/footer`
  fragments but fall back to the embedded chrome unless the fragment still
  carries the `ies-nav`/`ies-footer` markers — **the EDS content pipeline strips
  the `ies-*` classes and rewrites `<i>`→`<em>`**, so the authored fragment is
  not directly usable as chrome. `content/nav.html` + `content/footer.html` are
  kept as the human-readable source-of-record. Sticky-nav scroll-morph +
  mobile-menu toggle wired in `header.js`.
- **Forms** are static and **non-submitting** (EDS CSP blocks inline handlers):
  `<div>`/`<button type="button">`, fixed 5 fields (identical across pages, so
  built in JS, not authored). The pricing lead card (with fake reCAPTCHA widget)
  is built in `hero.js` for the `.hero.form` variant.
- **Comparison table** is reconstructed into a real grouped `<table>` from
  authored rows (column-header row + per-group band rows + data rows); check /
  dash / text values classified in `comparison-table.js`; the column header row
  is repeated per group to match the prototype.
- **Images:** authored as content `<img src="/media/<basename>">` (root-relative)
  — every prototype `{{BASE}}media/<dir>/<file>` maps to `/media/<basename>`.
  All 43 referenced assets present in repo `/media/`; 0 broken in QA.

### QA results (local harness, Playwright)
| Page | h1 | blocks | grids | imgs broken | header/footer | fidelity |
|---|---|---|---|---|---|---|
| index | 1 | 9/9 decorated | grid | 0 | ✓/✓ | very close to prototype |
| pricing | 1 | 5/5 | grid | 0 | ✓/✓ | very close (form hero, alt media rows, dark perf, sky switch) |
| accounting | 1 | 5/5 | grid | 0 | ✓/✓ | very close (tabs, agents split, roles reverse, underline form) |
| compare | 1 | 6/6 | grid | 0 | ✓/✓ | very close (grouped table faithful) |
| erp-solutions | 1 | 6/6 | grid | 0 | ✓/✓ | very close (power list, solution cards, sky form) |

Token-completeness gate: clean. All pages render, one `<h1>`, all blocks
decorated (grids compute `grid`, not stacked), no `pageerror`, no broken images,
header + footer present. Verified at 1440px and 360px.

### Residuals / what the DA + GitHub deploy still needs
1. **Push block code to a GitHub repo + bind AEM Code Sync** to the DA site
   `aem-intuit-erp` so branch preview (`<branch>--aem-intuit-erp--<org>.aem.page`)
   renders with these blocks.
2. **Commit `/media/**` to the code repo** so the root-relative `/media/…` image
   srcs resolve on branch preview. For full authorability, re-host editorial
   images to DA (`admin.da.live/source/<org>/aem-intuit-erp/media/<file>`) and
   swap the content `<img>` srcs to `content.da.live/...` URLs (noted per Step-8
   Images guidance).
3. **Write content to DA** via the Source API (`da_create_source` /
   `PUT admin.da.live/source/...`): the 5 pages `content/{index,pricing,accounting,
   compare,erp-solutions}.html` plus `content/nav.html` → `/nav` and
   `content/footer.html` → `/footer`. **Run `sanitise.js` first** (pages contain
   `® · – — ✓ ›` and smart quotes → entity-encode or DA corrupts to U+FFFD).
4. Preview/publish (`POST admin.hlx.page/preview|live/...`).
5. **Chrome authorability caveat:** because the pipeline strips `ies-*` classes,
   the header/footer render from the embedded template in the blocks, not the
   `/nav` `/footer` fragments. Editing chrome = editing `blocks/header/header.js`
   / `blocks/footer/footer.js` (or extend the blocks to rebuild chrome from a
   class-free authored nav). Documented as an accepted tradeoff for fidelity.
6. Non-fidelity static elements matching the prototype's static state: stat-band
   pager dots, testimonial video play button, form submit (all non-functional by
   design in the prototype).
