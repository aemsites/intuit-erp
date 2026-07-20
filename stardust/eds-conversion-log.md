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
