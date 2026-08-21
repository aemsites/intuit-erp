# Blog re-import (`tools/import/`)

Reusable, committed tooling to **re-import erp.intuit.com blog _articles_** into the
canonical Document Authoring (DA) block HTML used under `content/blog/**`. Use it when a
source `/blog/*` page has changed on the live site and the migrated DA page needs to be
regenerated so it drops straight back into the existing DA structure.

- **No build step.** Node ESM (`.mjs`). Requires the repo's existing `jsdom` dependency.
- **Full-regenerate.** Every run rebuilds the page from the current source — it does not read
  the existing DA page. CTA fragments are matched from the repo's media-promo catalog; the
  `json-ld` breadcrumb and the trailing pricing-disclaimer are synthesized.
- **Articles only.** Case studies (`/blog/case-study/*`), guides (`/blog/guide/*`), author
  pages (`/blog/author/*`), category landings and the blog root are skipped with a message.

## Usage (CLI — the reliable path)

```bash
# single page (site path or full source URL)
node tools/import/blog-import.mjs /blog/erp/erp-vs-accounting-software

# many pages from a list (one per line; blank lines and # comments ignored)
node tools/import/blog-import.mjs --list urls.txt

# preview only: structural diff vs the existing content/blog file, no writes
node tools/import/blog-import.mjs --dry-run --diff --verbose /blog/erp/erp-system
```

Options: `--list <file>`, `--dry-run`, `--diff`, `--verbose`, `--cache <dir>` (read/write the
fetched SSR so bulk runs don't re-hit the source), `--out <dir>` (output root, default
`content`). Output is written to `content/blog/<slug>.html` (git-ignored; pushing to DA is a
separate step, e.g. `aem content push`).

Recommended flow: re-import a few pages, `--diff` them against the current DA files, eyeball a
couple under `aem up`, then run the full list once happy.

### Source fetching (Akamai)

erp.intuit.com is a Next.js site behind Akamai that blocks headless scrapers and hard
rate-limits (HTTP 429). `fetch.mjs` shells out to `curl` with a browser User-Agent and absorbs
all backoff **inside curl** (`--retry` — never `sleep`/background polling). For bulk runs,
prefer `--cache` and/or run in chunks.

## `aem import` (helix-importer-ui) support

`import.js` is an [import UI](https://github.com/adobe/helix-importer-ui) adapter
(`transformDOM` + `generateDocumentPath`) that reuses the same extraction core. **Caveat:** the
Import UI's own fetch is blocked/rate-limited by Akamai, so importing live erp.intuit.com URLs
through the UI usually fails — the CLI is the supported runner. To use the UI anyway, serve the
pre-downloaded SSR HTML locally and point the UI at it (download-then-import); `--cache` can
seed those files.

## Architecture

| File | Responsibility |
|------|----------------|
| `fetch.mjs` | curl-based source fetch with Akamai-proof retry backoff; `--cache` support |
| `extract.mjs` | **the mapping** — source DOM (+ `__NEXT_DATA__`) → intermediate block model |
| `render-da.mjs` | block model → canonical DA collapsed-table HTML (verbatim corpus templates) |
| `catalog.mjs` | index `content/fragments/media-promo/*` → match source CTAs to fragment IDs |
| `diff.mjs` | structural (not byte) diff of block/section signatures |
| `blog-import.mjs` | CLI (single/`--list`, `--dry-run`/`--diff`, path derivation, scope filter) |
| `import.js` | `aem import` adapter over the shared core |

## Source → DA block mapping (articles)

| Source (SSR / `__NEXT_DATA__`) | DA block |
|--------------------------------|----------|
| `metaData.seo_og_title` / `seo_metaDescription` / `seo_og_image` | `metadata` Title / Description / Image |
| `a.QrcArticleHero_primaryAuthor` | `metadata` Author (else `Intuit`) |
| URL segment / secondary `categories[].concepts[]` | `metadata` Category / Tags |
| `metaData.lastPublishedDate` | `metadata` Date (see limitations) |
| URL (`/blog/research/*` → Research) | `metadata` Template |
| synthesized breadcrumb from path | `metadata` json-ld |
| `h1` + hero `<img>` | section-1 `<h1>` + `<picture>` (not a block) |
| `h1` + hero `Video_video` (YouTube poster) | section-1 `<h1>` + `video` link (`<a href><picture></a>`, upgraded to a player) |
| `.Responsivetext` prose (h2/h3/p/ul/ol) | headings/paragraphs/lists (Quill spans stripped, `<strong>`/`<em>`/links kept; malformed Quill wrappers like `<left<p>` recursed) |
| bottom `Disclaimer` block with footnote markers (`[1]`…) | trailing default-content section (distinct from the pricing-disclaimer fragment) |
| `.root > .colored-box`, `.TipBox-tip-box` | `highlight` |
| `.root > .quote-box` | heading + `testimonial` (name/role split on first comma) |
| `.core-block-container` / image+heading+link CTA | `fragment` (media-promo, matched by image asset → heading), else inline `media-text` |
| `datawrapper.dwcdn.net` iframe | `embed` |
| poster `img` from `i.ytimg.com/vi/<id>/` | `video` link (`<a href><picture></a>`, upgraded by the video autoblock) |
| MDS `snackable-cards-slider` (client-rendered; data in `__NEXT_DATA__`) | `stat-band cards` (horizontal image scroller: title card + stat graphics + captions) |
| body `<img>` | `<picture>` (fully-qualified) |
| — (appended) | `Recommended for you` + `blog-cards`, then pricing-disclaimer `fragment` |
| nav / mega-nav / footer / social / ProductBanner / right-rail / AuthorBio / related grids / byline | **dropped** (the `blog-template` autoblock regenerates byline/TOC/right-rail) |

Links to `erp.intuit.com` are made site-relative; images stay fully-qualified. Byline, TOC and
right-rail are **not** authored — the `blog-template` autoblock builds them from the metadata.

## Fidelity — the "commonly missed" content types are covered

highlights · media-text · **all** images (fully-qualified) · quotes (blockquote + testimonial) ·
embedded tables (`table` passthrough + datawrapper `embed`) · YouTube videos · bottom
disclaimer fragment · bold (`<strong>`) & inline formatting · paragraphs · lists.

The tool logs a **warning** (see `--verbose`) rather than fabricating whenever it can't map
something confidently.

## Known limitations (warned, never fabricated)

- **`stat-band` (SnackableCards)** render client-side (empty in SSR) but the card data (images,
  alt-text stats, captions) is in `__NEXT_DATA__`, so it is auto-extracted into a `stat-band cards`
  block (horizontal image scroller). If a page's slider has no parseable cards, it warns instead.
- **Datawrapper** widgets (charts **and** tables) are emitted as `embed`, matching the DA
  convention (e.g. `/blog/financials/cash-flow-variance-analysis`).
- **`ask-the-expert` / video-led layouts** scatter prose across nested containers (max one
  `.Responsivetext` per wrapper) instead of a single flat article body. `findBody` falls back to
  the article main region (`ArticleComponent-main-content`) and picks the container with the most
  direct content blocks, so these import cleanly (e.g. `intuit-enterprise-suite-gene-marks`).
  Their video hero (a `Video_video` component with a YouTube poster) is emitted as a `video`, and
  any bottom footnote `Disclaimers` block is captured as a trailing content section.
- **Date** uses the deterministic `lastPublishedDate`. DA's own `Date` is inconsistent (some
  values are the migration date), so this may differ from a page's originally-displayed date;
  it's easy to review/adjust and does not affect byline/sort correctness.
- **Events Bar** is global chrome (no blog page authors it per-page) and is intentionally not
  emitted.
- Validation diffs run against the local `content/blog/**` pull; live-DA diffing is auth-gated.
