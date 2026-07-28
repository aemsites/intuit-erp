<!-- stardust:provenance
  writtenBy: stardust:extract
  writtenAt: 2026-07-27T13:45:00Z
  againstInput: https://main--aem-intuit-erp--keepthebyte.aem.page/
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/pages/*.json
  synthesizedInputs: []
  stardustVersion: 0.18.0
-->
---
name: "Intuit Enterprise Suite — current state (AEM EDS replica)"
description: "Descriptive snapshot of the deployed site at main--aem-intuit-erp--keepthebyte.aem.page, captured 2026-07-27 across 8 pages."
colors:
  background: "#ffffff"
  text-primary: "#6b6c72"
  text-heading: "#11181c"
  primary: "#00254a"
  accent-ink: "#21262a"
  accent-blue: "#0077c5"
  border: "#d4d7dc"
typography:
  brand-family: '"AvenirNext forINTUIT"'
  substitute-family: "Mulish Variable, mulish-fallback"
  stack: '"AvenirNext forINTUIT", "Mulish Variable", mulish-fallback, arial, sans-serif'
  h1: { size: "48px", weight: 400, lineHeight: "55.68px" }
  h2: { size: "38px", weight: 400, lineHeight: "43.7px" }
  h3: { size: "34px", weight: 400, lineHeight: "40.8px" }
  h4: { size: "16px", weight: 700, lineHeight: "19.2px" }
  body: { size: "18px", weight: 400, lineHeight: "27px" }
rounded: "4px"
spacing:
  scale: "not measured (per-section padding aggregation not implemented in this extraction pass)"
components:
  - button-primary
  - button-secondary-outline
  - global-header (fragment: /nav)
  - global-footer (fragment: /footer)
  - hero-with-media
  - stat-band-carousel
  - feature-card-grid
  - tabbed-feature-panel
  - comparison-table
  - lead-capture-band
  - faq-accordion
  - social-proof-logo-strip
---

# DESIGN — Intuit Enterprise Suite (current state, descriptive)

## 1. Overview

Descriptive design-system snapshot of the live AEM Edge Delivery Services
build at `https://main--aem-intuit-erp--keepthebyte.aem.page/`, aggregated
from 8 live Playwright captures (home, pricing, 3 solution pages, a
comparison page, and the `/nav` + `/footer` fragments). Values are
cross-page aggregates weighted by occurrence count (badge: `cross-page`)
unless noted `home-only`. See `_brand-extraction.json` for full source
citations.

## 2. Colors

### Primary

`rgb(0, 37, 74)` / `#00254a` — the single most background-used saturated
color across the crawl (30 qualifying-element occurrences); also the
primary CTA button's background ("Schedule a call," all 6 content pages)
and every hero-band background. Deliberately restrained: used on hero
sections and the primary action only, not decoratively.

### Secondary

`rgb(0, 119, 197)` / `#0077c5` — appears as link/wordmark text color
(104 occurrences) but was never observed as a background fill on a visual
button in this crawl. Candidate "brand blue" for links/icons, distinct
from the CTA navy.

### Neutral

- Background/canvas: `rgb(255, 255, 255)` / `#ffffff` (81 occurrences)
- Body/label text: `rgb(107, 108, 114)` / `#6b6c72` (334 occurrences — the
  most-used text color cross-page)
- Heading/high-contrast text: `rgb(17, 24, 28)` / `#11181c` (90
  occurrences) and `rgb(33, 38, 42)` / `#21262a` (141 occurrences)
- Border/hairline: `rgb(212, 215, 220)` / `#d4d7dc` (33 occurrences)

### Named Rules

- Navy (`primary`) is reserved to hero backgrounds and the one repeated CTA
  — never used as a body-text color and never diluted into a gradient
  system (no gradients were captured at all — `motifs.gradients: []`).
- Two visually close near-blacks (`#11181c`, `#21262a`) are both in active
  use for text, 24 combined px-difference in RGB channels — a candidate
  `T-color-imbalance`-adjacent redundancy (not firing the exact detector,
  since both qualify as `text`, but worth flagging as unresolved).

## 3. Typography

Single family in use: **AvenirNext forINTUIT** (a licensed Intuit cut of
Avenir Next) for both headings and body, self-hosted under Intuit's
authorization for this AEM migration (mirrored from erp.intuit.com's own
font kit), falling back to Mulish Variable → arial → sans-serif when
unavailable. No monospace family detected.

### Hierarchy

Weighted-score-selected representative size per level (pixel × weight/400
× √occurrence-count, per the modular-scale audit procedure):

| level | size | weight | line-height |
|---|---|---|---|
| h1 | 48px | 400 | 55.68px |
| h2 | 38px | 400 | 43.7px |
| h3 | 34px | 400 | 40.8px |
| h4 | 16px | 700 | 19.2px |
| body (p) | 18px | 400 | 27px |

**Scale audit: ad-hoc.** Consecutive ratios 48/38=1.263, 38/34=1.118,
34/16=2.125 — none within ±0.025 of a canonical scale (major-third 1.25 is
closest for the first step only). No consistent ratio holds across the
measured levels (`_brand-extraction.json#type.scaleAudit`).

### Named Rules

- Display headings render at **weight 400** (light), not bold — hierarchy
  is carried primarily by size, not weight.
- h4 (16px/700) is a sharp drop from h3 (34px) — likely an
  eyebrow/label-style heading (e.g. "MULTI-ENTITY MANAGEMENT" style
  all-caps tab labels observed in the accounting-page screenshot), not a
  true content sub-heading. Flagged for `direct` to resolve if this project
  proceeds to a redesign.

## 4. Elevation

**Not measured** in this pass — the extraction's style-surface scan
captured `box-shadow` on CTA/button elements only (all sampled buttons
returned `none`); a broader per-component (card/modal) shadow inventory
was not implemented. `_brand-extraction.json#motifs.shadows: []`.

### Shadow Vocabulary

Not measured (see above). Screenshots show soft, low-opacity card shadows
on product-UI mockups (e.g. accounting page feature cards) but no
computed-style value was captured for them.

## 5. Components

### Buttons

**Primary**: background `rgb(0, 37, 74)`, text `rgb(255, 255, 255)`,
`border-radius: 4px`, `padding: 0px 24px`, `font-weight: 600`, no shadow.
Measured directly from the "Schedule a call" CTA, identical across all 6
content pages.

**Secondary/ghost**: not measured — the extraction's "visual button"
filter (background present, radius > 2px, padding > 4px) did not
isolate a second distinct button style beyond a white-background variant
(4 occurrences); screenshots show an outlined/ghost secondary button
("For accountants," "I'm an accountant") but its computed border/fill was
not captured in this pass.

### Chips

Not observed in the captured pages.

### Cards / Containers

Not measured as a distinct component style (see § Elevation). Radius
aggregate across all card/button/image-like elements: `4px` (59
occurrences, dominant/primary), `12px` (16, secondary), `14px` (8), `8px`
(5), `50%`/pill (3), `6px` (1) — a fragmented small-radius vocabulary (see
`T-radius-vocab` in `brand-review.html`).

### Inputs / Fields

Not measured (no per-component input style capture in this pass). The
lead-capture form (pricing, and the "Let's connect" band) is visible in
screenshots as bordered rectangular fields; no computed style recorded.

### Navigation

Global header delivered as the `/nav` EDS content-fragment document,
shared verbatim across every page (top-level items: Capabilities, Industry
tools, Pricing, Resources, Support, For accounting firms; persistent CTA:
Schedule a call).

### Lead-capture band (signature component)

A repeated "Let's connect" multi-field contact band (first/last name,
business name/email/phone, "Schedule a call" submit) appears near the
bottom of 5 of 6 content pages (all but home) — the site's structural
conversion backstop below the primary hero CTA.

## 6. Do's and Don'ts

_Observed patterns — descriptive, not prescriptive. This is the
current-state file; a target board with actual prescriptions is written by
`stardust:direct`, not here._

### Do (observed on this site):

- Reserve the saturated navy to hero bands and the one repeated CTA.
- Repeat one CTA label ("Schedule a call") across nearly every page and
  section.
- Pair every product claim with a real product-UI screenshot rather than
  an illustration.
- Cite specific, named third-party benchmarks (Forrester TEI: 299% ROI,
  $596K benefit) rather than unattributed superlatives.

### Don't (observed gaps, not yet resolved on this site):

- Two near-black text colors in simultaneous use with no documented role
  split.
- A fragmented small-radius vocabulary (4/8/12/14px all in active use).
- An ad-hoc type scale with no consistent ratio across heading levels.
- A secondary CTA label ("Schedule a consultation") forked from the
  canonical "Schedule a call" voice on one page (erp-solutions).
