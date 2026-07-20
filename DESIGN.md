---
_provenance:
  writtenBy: stardust:replica
  mode: bounded-single
  synthesizedFrom:
    - stardust/current/tokens/index-1440.json
    - stardust/current/tokens/index-360.json
    - stardust/current/pages/index.json (customProps)
colors:
  background: "#ffffff"
  surface-sand: "#f7f8f3"
  surface-tofu: "#f3f2ef"
  surface-sky: "#dbedee"
  text: "#21262a"
  text-muted: "#6b6c72"
  text-soft: "#8d9096"
  primary: "#0077c5"        # Intuit blue
  primary-dark: "#055393"
  navy: "#00254a"           # primary CTA background / dark hero
  navy-hover: "#001a36"     # CTA hover-darken (derived)
  navy-mid: "#053d6d"
  ink-teal: "#0d333f"       # lifted: "Watch product demo" button text
  blue-bright: "#0097e6"
  blue-light: "#34bfff"
  accent-green: "#0a8543"
  accent-green-bright: "#0fd46c"
  info-band: "#236cff"
  # --- replica support tokens (lifted/derived from erp.intuit.com) ---
  heading-ink: "#11181c"       # computed heading color
  hairline: "#d4d7dc"          # borders/dividers
  hairline-soft: "#eeeeee"     # inner list dividers
  hero-violet: "#3b2f7a"       # hero gradient far stop
  hero-eyebrow: "#9fd0ff"      # light-blue hero eyebrow
  hero-lede: "#e6eef6"         # hero lede on dark
  navy-body: "#d5e0ec"         # body text on navy card
  video-ink: "#0b2233"         # video poster backdrop
  feature-fill: "#eef2f6"      # feature section fill
  feature-img-tint: "#dfeafc"  # feature card image panel tint
  dot-idle: "#cbd1d6"          # carousel idle dot
typography:
  brand-family: '"AvenirNext forINTUIT"'
  substitute-family: "Mulish"     # metric-matched free substitute (licensed kit not rehosted)
  stack: '"AvenirNext forINTUIT", Mulish, Helvetica, Arial, sans-serif'
  base-size: "16px"
  ramp:
    hero-h1:    { size-1440: "48px", lh-1440: "60px",   size-360: "40px", lh-360: "52px",   weight: 400 }
    section-h2: { size-1440: "48px", lh-1440: "67.2px", size-360: "30px", lh-360: "33.9px", weight: 400 }
    sub-h3:     { size-1440: "18.72px", lh-1440: "24.34px", weight: 400 }
    body:       { size: "16px", lh: "1.5", weight: 400 }
    small:      { size: "14px", weight: 400 }
rounded: "4px"          # buttons; cards use 8-12px
spacing:
  section-y: "80px"     # default vertical section rhythm (40px compact)
  container: "1380px"   # dominant max-width; inner content ~1360px
  gutter: "30px"
components:
  - button-primary
  - button-outline
  - global-header
  - global-footer
  - hero
  - stat-band
  - feature-grid
  - media-text-split
  - tabs
  - comparison-table
  - pricing-cta-band
  - faq-accordion
  - testimonial
---

# DESIGN — Intuit Enterprise Suite (descriptive)

## Palette

White-first. Body text `#21262a`, muted `#6b6c72`. Intuit blue `#0077c5`
for links/accents; deep navy `#00254a` for the primary CTA and dark hero
bands (which also use a blue→indigo gradient toward `#053d6d`/indigo).
Neutral section fills alternate white / sand `#f7f8f3` / tofu `#f3f2ef` /
sky `#dbedee`. Green `#0a8543`/`#0fd46c` is the data-positive accent
(stats, checkmarks). A saturated `#236cff` band appears as an info/notice
strip.

## Typography

Single family: **AvenirNext forINTUIT** (custom licensed Avenir Next).
Weights 400/500/600/700 loaded; large headings render at **weight 400**
(light, airy). Because the kit is domain-licensed it is **not rehosted** —
the prototypes keep `"AvenirNext forINTUIT"` first in the stack and fall
back to **Mulish** (metric-matched, Google Fonts) then Helvetica/Arial. A
licensed drop-in later wins with no code change. Substitution logged in the
replica progress ledger; expect a justified width-probe font residual at
the gate.

Type ramp (see frontmatter): hero H1 48/60 desktop → 40/52 mobile; section
H2 48/67 desktop → 30/34 mobile; H3 ~19/24; body 16/1.5.

## Layout & container

Content max-width **1380px** (inner ~1360), centered, ~30px gutters.
Section vertical rhythm 80px (40px for compact bands). Global header is
60px tall, transparent when over a hero band, becoming solid on light
sections. Deep 4-column footer (Company / For Individuals / For Small
Business / For Accountants) plus a legal/brand strip, shared across pages.

## Components / motifs

Primary button: navy `#00254a`, white text, 4px radius, `0 30px` padding.
Outline button: 2px white/navy border, transparent fill, 4px radius.
Cards: white on neutral fill, ~8–12px radius, soft shadow. Recurring
modules: hero (with product screenshot or photo), stat band, feature grid
(2×2 screenshot cards), media+text split, tabbed feature explorer,
competitor comparison table, pricing/CTA band, FAQ accordion, testimonial.
