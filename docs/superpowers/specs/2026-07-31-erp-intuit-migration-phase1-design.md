# erp.intuit.com → EDS Migration — Phase 1 Design

**Date:** 2026-07-31
**Branch:** `migrate-site-1`
**Repo:** `aemsites/intuit-erp` · DA: `da.live/#/aemsites/intuit-erp`
**Status:** Approved (approach + phases); spec pending user review

## Goal

Migrate the remaining in-scope pages of `https://erp.intuit.com/` into Edge
Delivery Services using the existing block palette, at a **faithful-but-pragmatic**
fidelity bar (reproduce content, structure, and layout with existing blocks;
accept minor visual deltas where a bespoke pixel-match would be disproportionately
costly). Content is generated and verified locally in the `content/` mirror, then
pushed to DA per batch.

## Scope

Source site = **289 URLs**. Already migrated ≈ 72 local pages (15 marketing/
solution, 8 case studies, 2 research, ~18 EDS-native events, plus block-library
and fragment pages).

### In scope for Phase 1 (~32 pages)

| Archetype | Approx. count | Notes |
|---|---|---|
| Case studies (`/blog/case-study/*`) | ~11 | Remaining after the 8 already imported |
| Research & guides (`/blog/research/*`, `/blog/guide/*`) | ~11 | Some gated whitepapers / webinar-capture pages |
| Solution / marketing pages | ~6 | `account-management`, `accountant` (+ `free-consultation/ies` + `/coffee`), `migration`, `contact`, `ibs`, `oa` |
| Webinar landing pages | ~10 | `/webinar-*`, `/nickschiffer-encore-0326` |

### Explicitly out of scope (deferred to Phase 2)

The ~230-page `/blog/*` corpus: individual articles (`/blog/financials/*`,
`/blog/erp/*`, `/blog/construction/*`, …), blog **category** landing pages
(`/blog/erp/`, `/blog/financials/`, …), and blog **author** pages
(`/blog/author/*`). This is a separate template-then-bulk-import effort with its
own spec → plan cycle. Case studies, research, and guides live under `/blog/` but
ARE in scope because they are bespoke, high-value pages using the marketing block set.

## Approach — Archetype-batch, template-first (Approach A)

For each archetype:
1. Migrate **one representative page** end-to-end via the `page-import` skill.
2. Resolve any block-variant gaps (via `content-driven-development` /
   `building-blocks`) — expected to be minor variants, not new blocks.
3. **Lock** the resulting block set as the archetype template.
4. **Batch-migrate** the rest of the archetype against the locked block set.
5. Verify each page individually.

Parallel subagent fan-out (Approach C) may be used *within* an archetype **only
after** its blocks are locked, to avoid concurrent edits to shared blocks.

### Why this works

The block palette is effectively complete for every in-scope archetype
(confirmed by inspecting imported pages):

- **Case study:** `case-study-header · stat-band(glance) · media-text ·
  testimonial(video) · case-study-cards(recommended) · cta-band`
- **Solution/marketing:** `hero · stat-band · media-text · faq · fragment
  (schedule-call) · cards · icon-columns · tabs · testimonial · cta-band`
- **Research/guide:** `hero · stat-band · media-text · download-form ·
  resource-cards · faq · cta-band`
- **Webinar landing:** expected `hero · download-form/form (registration) ·
  speakers · agenda · cta-band` — confirm on first representative.

Remaining work is therefore **mostly content migration**, not block-building.

## Phases

- **Phase 0 — Spot-check baseline (½ day).** Verify 3–4 already-imported pages
  (`construction`, one case study, one research page) against the live source on
  localhost to calibrate the quality bar and confirm block behavior. Fix only if
  broken.
- **Phase 1 — Case studies (~11).** Slug convention **decided**: use short slugs
  (e.g. `redhammer`, `pulseroller`), dropping the source `-intuit-enterprise-suite`
  suffix. Batch-migrate, verify each.
- **Phase 2 — Research & guides (~11).** Watch for gated/whitepaper download
  variants and webinar-capture pages.
- **Phase 3 — Solution / marketing (~6).** Most bespoke; may need minor block
  *variants* (not new blocks). Verify each visually against source.
- **Phase 4 — Webinar landing (~10).** Confirm the repeating template on the
  first page, then batch the rest.

## Per-page workflow

1. `page-import`: scrape source → identify page structure → map to existing
   blocks → generate canonical EDS HTML into `content/<path>.html`.
2. Local preview via `aem up` / localhost:3000.
3. Verify: visual comparison + `.plain.html` structure diff against the source
   page.
4. Fix issues; route any block change through `content-driven-development`.
5. `npm run lint` before marking done.

New or adjusted blocks are tracked in a running block-variant changelog.

## Publishing

- **Local first:** generate + verify every page in the `content/` mirror.
- **DA push per batch:** the **AEM DA - Prod** MCP connector is connected. After a
  batch is verified locally, push via `da-content` / DA admin API and trigger DA
  preview. Push is still gated on local verification passing.

## Cross-cutting

- Track all work in `tasks/todo.md` with checkable items; add a review section on
  completion.
- `helix-query.yaml` indices (`case-studies`, `research`, `events`) already exist
  and cover the new pages — verify `query-index.json` coverage after each batch
  (listing pages depend on it).
- Capture any correction patterns in `tasks/lessons.md`.

## Definition of done (per phase)

- Every in-scope page for the phase exists in `content/`, renders on localhost,
  and matches the source at the faithful-but-pragmatic bar.
- No lint errors.
- Listing/query indices reflect the new pages.
- Batch pushed to DA and preview verified (or explicitly queued if DA push is
  deferred).

## Risks / open items

- ~~Slug reconciliation for case studies~~ — **decided**: short slugs, no
  `-intuit-enterprise-suite` suffix.
- **Gated/form pages** (research downloads, webinar registration) may hit
  form-handler or martech wiring not present locally; verify the `form` /
  `download-form` behavior early.
- **`/oa`, `/ibs`** may be thin redirect/landing pages — confirm they are real
  content pages before investing.
- Webinar template assumption unverified until Phase 4 representative is imported.
