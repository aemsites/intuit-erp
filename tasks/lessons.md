# Migration Lessons & Decisions

## Decisions
- **Case-study slugs:** short form, no `-intuit-enterprise-suite` suffix.
- **Guide→research consolidation:** source `/blog/guide/*` pages migrate under `/blog/research/*` (single index + query-index). Two research pages already there stay put.

## Baseline notes (Task 0 spot-check)
- **Preview URL convention:** run `aem up --html-folder content` (backgrounded). Local
  `content/<path>.html` is served at **`http://localhost:3000/content/<path>`** — the
  html-folder mounts at `/content` by default. Plain `/<path>` (no prefix) proxies to
  the aem.page backend and 404s for content not yet pushed to DA. Always verify local
  work at the `/content/...` URL.
- **Source is client-rendered:** raw `curl https://erp.intuit.com/<path>/` returns no
  headings/body (JS-hydrated). Structural/visual comparison against source must use the
  `page-import` scraper (renders JS) or the browser tool — NOT raw curl of the source.
- **Block decoration is client-side:** server HTML (curl of `/content/<path>`) won't
  contain `class="x block"`; those are added by `aem.js` at runtime. Inspect
  `.plain.html` for authored structure, or the browser DOM for decorated output.
- Spot-checked `construction`, `blog/case-study/redhammer`, `blog/research/
  enterprise-technology-benchmark-report` — all render correctly locally. Quality bar good.

## Block-variant changelog
_(record any block/CSS changes made during migration here)_
