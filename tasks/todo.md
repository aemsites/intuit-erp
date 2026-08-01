# erp.intuit.com → EDS Migration — Phase 1 Tracker

Plan: `docs/superpowers/plans/2026-07-31-erp-intuit-migration-phase1.md`
Spec: `docs/superpowers/specs/2026-07-31-erp-intuit-migration-phase1-design.md`

## Task 0 — Environment + spot-check baseline
- [x] Dev server up on :3000
- [x] Spot-check construction / redhammer / enterprise-technology-benchmark-report
- [x] Tracker seeded

## Task 1 — Case-study template (western-companies)
- [x] western-companies (representative, locks block set)

## Task 2 — Case-study batch (10)
- [x] fefa-financial
- [x] fire-and-ice
- [x] fixe
- [x] four-points-rv-resorts
- [x] hfmm-legacy-group-growth
- [x] humble-house
- [x] lallier-construction
- [x] lango
- [x] nick-schiffer-construction-webinar
- [x] sylvia-brafman
- [ ] DA push (case-study batch)

## Task 3 — Research/guide template (forrester-tei-cost-savings)
- [x] forrester-tei-cost-savings (representative, locks block set + path convention)

## Task 4 — Research/guide batch (8)
- [x] business-solutions-survey-2024
- [x] ai-workplace-whitepaper
- [x] construction-accounting-erp-guide
- [x] construction-digital-transformation-whitepaper
- [x] data-analytics
- [x] lt-webinar-capture
- [x] unlocking-business-growth
- [x] webinars-on-demand
- [ ] DA push (research batch)

## Task 5 — Solution / marketing (8)
- [x] oa / ibs triage
- [x] account-management
- [x] accountant
- [x] accountant/free-consultation/ies
- [x] accountant/free-consultation/ies/coffee
- [x] migration
- [x] contact
- [ ] DA push (solution batch)

## Task 6 — Webinar-landing template (webinar-shawnvandyke)
- [x] webinar-shawnvandyke (representative, locks block set)

## Task 7 — Webinar-landing batch (10)
- [x] webinar-fof-april1
- [x] webinar-fof-march
- [~] webinar-fof-may (SOURCE 404 — removed from live site)
- [x] webinar-fofqbo
- [x] webinar-lt-simulive
- [x] webinar-matthiggins
- [x] webinar-mikemichalowicz/consultation-livestream
- [x] webinar-on-demand-cp
- [x] webinar-product-demo-cp
- [~] nickschiffer-encore-0326 (SOURCE 404 — removed from live site)
- [ ] DA push (webinar batch)

## Task 8 — Final reconciliation
- [ ] Gap re-check vs sitemap
- [ ] query-index coverage
- [ ] Full lint clean
- [ ] All DA pushes confirmed
- [ ] Review section written

## Deferred / follow-ups
- [ ] `/blog/guide/*` → `/blog/research/*` redirects (non-blocking)

## Task 8 — Reconciliation
- [x] Gap re-check vs sitemap (65 in-scope; all migratable pages present)
- [x] query-index coverage (helix-query.yaml globs cover case-study/research/events — populate on publish)
- [x] Lint — N/A (zero blocks/scripts/styles changes; pure content migration)
- [ ] DA push (all batches) — DEFERRED, queued for authorization
- [x] Review section written

## Review — Phase 1 complete
**Migrated this session (39 pages, all render 200 locally at `/content/<path>`):**
- 11 case studies (`/blog/case-study/*`) — template locked on western-companies
- 9 research/guides (`/blog/research/*`, guides consolidated here)
- 8 solution/marketing (`account-management`, `accountant` +2 sub, `migration`, `contact`, `oa`, `ibs`)
- 9 webinar landings (`/webinar-*`, thin lead-form stubs — faithful to source)

**Images:** all content images normalized to fully-qualified `erp.intuit.com` (+`digitalasset`/`www.intuit.com`)
source URLs for DA auto-ingestion; org corrected off `keepthebyte`. Intentional keeps: testimonial
quote-mark svg (git code asset) + prototype placeholders (library demo pages only).

**Could not migrate (source 404 — removed from live site since the July sitemap):**
- `/webinar-fof-may`, `/nickschiffer-encore-0326`

**Deferred / follow-ups (non-blocking):**
- DA push of all batches (queued — DA prod MCP connected, awaiting go-ahead)
- `/blog/guide/*` → `/blog/research/*` redirects (guides were consolidated)
- `accountant.html` logo-strip sections omitted (logo-strip block exists; faithful-but-pragmatic)
- Phase 2: the ~223-page `/blog/*` article + category + author corpus (separate spec/plan)
