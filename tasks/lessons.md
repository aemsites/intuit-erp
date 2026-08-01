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

## Workflow discoveries (Task 1) — apply to ALL page tasks
- **The `.claude/skills/skills/*` EDS skills (page-import etc.) are NOT invocable** via the
  Skill tool ("Unknown skill"); they are reference docs only. Migrate content by **manually
  extracting the source's `__NEXT_DATA__` JSON** (the site is Next.js): `curl -A "Mozilla/5.0
  …" <src-url>` then parse the `<script id="__NEXT_DATA__">…</script>` payload. Raw curl WITH a
  browser User-Agent returns 200 and the full structured content.
- **Browser tools cannot reach erp.intuit.com** (Akamai bot-detection + sandbox domain policy).
  Use the curl+`__NEXT_DATA__` path, not the browser, for source content.
- **Source rate-limits (429)** on bursts — space requests a few seconds apart, always send a
  real User-Agent.
- **Project playbook for case studies:** `experience-workspace/skills/case-study-page-creation.md`
  — full page skeleton + gotchas. Also `brand-check-and-fix.md`, `document-update-brand-check.md`.
- **Case-study gotchas (from playbook, verified):**
  - **Image `src` MUST be an absolute URL** (`https://content.da.live/aemsites/intuit-erp/media/…`
    or a verified external hotlink). Root-relative `/media/…` silently breaks → `about:error`.
    Existing pages hotlink the real source photos — follow that.
  - **Header media row: lead PHOTO first, logo second** (og:image = first image = index card thumb).
  - **Narrative sections = `<h2>`; utility headings (`Hear from our customers`, `Recommended for
    you`, `Results at a glance`) = `<h3>`** (auto-ToC is built from h2 only).
  - **Industry = UPPERCASE, one of 7:** CONSTRUCTION, NONPROFIT, HEALTHCARE, TECHNOLOGY,
    FIELD SERVICES, PROFESSIONAL SERVICES, FINANCIAL SERVICES — based on the *customer's own*
    company. Drives `/blog/case-study/query-index.json` filter pills.
  - `case-study-cards recommended` is authored EMPTY (`<div class="case-study-cards recommended">
    </div>`) — the block JS auto-fills 3 related studies from the query-index.
  - `testimonial video` reuses the fixed Rhodes Companies story unless the source has its own video.
- **Slug decision OVERRIDES the playbook:** we use SHORT slugs (no `-intuit-enterprise-suite`),
  contrary to the playbook's Step 1 note.
- **DA authoring tools** in the playbook (`content_create`/`content_preview`) map to our
  **local-first** flow: write the file to `content/<path>.html`; DA push is a later batch step.

## Block-variant changelog
_(record any block/CSS changes made during migration here)_
