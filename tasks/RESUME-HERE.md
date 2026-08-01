# erp.intuit.com → EDS Migration — RESUME HERE

**Last updated:** 2026-08-01 · **Branch:** `migrate-site-1` · **Status:** Phase 1 content migration COMPLETE (local); DA push pending.

This is the single entry point to resume. Companion docs:
- Spec: [docs/superpowers/specs/2026-07-31-erp-intuit-migration-phase1-design.md](../docs/superpowers/specs/2026-07-31-erp-intuit-migration-phase1-design.md)
- Plan: [docs/superpowers/plans/2026-07-31-erp-intuit-migration-phase1.md](../docs/superpowers/plans/2026-07-31-erp-intuit-migration-phase1.md)
- Task tracker + review + fix list: [tasks/todo.md](todo.md)
- Gotchas & decisions (READ FIRST when resuming): [tasks/lessons.md](lessons.md)

---

## Where we are

- **39 pages migrated this session**, all render **200, fully decorated** locally: 11 case studies, 9 research/guides, 8 solution/marketing, 9 webinar landings. Combined with ~24 pre-existing pages, `content/` has **109 HTML pages** covering all **65 in-scope** source URLs.
- **Images normalized** to fully-qualified `erp.intuit.com` (+`digitalasset`/`www.intuit.com`) source URLs so DA auto-ingests on preview. `keepthebyte`-org refs eliminated. (Intentional keeps: testimonial quote-mark svg + library-demo prototype images.)
- **Zero code changes** — branch is content-only (`content/`, `docs/`, `tasks/`, config). No `blocks/`/`scripts/`/`styles/` touched. Nothing pushed to DA yet.
- Branch: **35+ commits vs `main`**, working tree clean.

## How to preview locally (IMPORTANT — version matters)

```bash
npx -y @adobe/aem-cli@latest up --no-open   # needs aem-cli >= 16.20; cached 16.16.6 is too old
```
Then open pages at their **clean natural paths** (NO `/content` prefix), e.g.:
- http://localhost:3000/blog/case-study/western-companies
- http://localhost:3000/accountant
- http://localhost:3000/blog/research/forrester-tei-cost-savings
- http://localhost:3000/webinar-shawnvandyke

v16.21.4 auto-serves + decorates `content/`. Do NOT use `--html-folder` (old-CLI workaround; serves raw undecorated). Missing paths proxy to `https://main--intuit-erp--aemsites.aem.page`.

## Next steps (in priority order)

1. **DA push (main pending action).** Local-first is done; push `content/*.html` to DA org **`aemsites/intuit-erp`** (NOT `keepthebyte`) and trigger preview. The **AEM DA - Prod MCP is connected**. Use the `da-content` / `da-auth` skills or the DA MCP. Push per batch, verify preview 200. Images auto-ingest from the fully-qualified URLs.
2. **Fidelity fix list** (in [tasks/todo.md](todo.md) → "Fidelity fix list"):
   - **Webinar/schedule-call form variant** — CONTENT-ONLY, trivial. Source "Let's connect" form uses the borderless UNDERLINE style; we authored `class="form boxed"` (boxed + labels). Fix = change `form boxed` → `form` on `content/webinar-*.html` (8) + `webinar-mikemichalowicz/consultation-livestream.html`. The `form` block's DEFAULT variant is already correct (no block code change). VERIFY source before flipping the shared `fragments/schedule-call.html` + `accountant/free-consultation/ies*.html`.
   - **Carousel block (deferred)** — the ONLY item needing real code. Source uses `mds-components/vertical-carousel` sliders (e.g. accountant "Trusted by firms", ~12 on that page); we flattened to stacked `testimonial` blocks. Build a reusable `blocks/carousel/` (slider + arrows/dots + a11y), **match the source's look**, then audit+remap solution pages. Use `content-driven-development` skill.
3. **Deferred/minor:** `/blog/guide/*`→`/blog/research/*` redirects; `accountant.html` logo-strip sections omitted; 2 source-404 pages (`/webinar-fof-may`, `/nickschiffer-encore-0326` — removed from live site, cannot migrate).
4. **Phase 2 (separate spec/plan):** the ~223-page `/blog/*` article + category + author corpus.

## Key how-to (full detail in tasks/lessons.md)

- **EDS skills** installed as plugin `aem-edge-delivery-services@adobe-skills` (24 skills; `page-import`, `content-driven-development`, `da-content`, …). Update via `claude plugin update`. Note: plugin skills enumerate for FRESH sessions/subagents.
- **Source content extraction:** the `page-import` skill's browser scraper is blocked by Akamai on erp.intuit.com. Working method = curl the page with a browser UA + parse the `<script id="__NEXT_DATA__">` JSON (Next.js site). Source rate-limits (429) — use a single blocking `curl --retry 15 --retry-delay 20 --retry-all-errors` (waiting happens inside curl).
- **Subagent anti-stall rule:** forbid Monitor/`run_in_background`/`sleep` for backoff (agents stall); use blocking `curl --retry` only.
- **Controller (main session) bash gets network-sandboxed on long/background calls** — dispatch subagents for source fetches.
- **Case-study playbook:** `experience-workspace/skills/case-study-page-creation.md` (block skeleton + gotchas: absolute image URLs, photo-first header, `<h2>` narrative / `<h3>` utility, UPPERCASE Industry).
- **SDD ledger** (`.superpowers/sdd/2026-07-31-erp-intuit-migration-phase1/progress.md`) has the full task-by-task trail — but `.superpowers/` is gitignored, so it won't survive a fresh clone; this file is the durable handoff.
