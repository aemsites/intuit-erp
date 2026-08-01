# erp.intuit.com → EDS Migration Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the ~41 remaining in-scope pages of erp.intuit.com (case studies, research/guides, solution/marketing, webinar landings) into the EDS `content/` mirror using the existing block palette, verify each on localhost, then push per batch to DA.

**Architecture:** Archetype-batch, template-first. Per archetype: migrate one representative end-to-end with the `page-import` skill, lock its block set, then batch the rest. Content is authored as canonical EDS HTML (DA table form) into `content/<path>.html`, previewed on the local `aem up` dev server, diffed against the live source, then pushed to DA via the connected **AEM DA - Prod** MCP.

**Tech Stack:** AEM Edge Delivery Services, `@adobe/aem-cli` (`aem up`), the installed EDS skill suite (`page-import`, `content-driven-development`, `da-content`, `da-auth`), vanilla JS/CSS blocks, `da.live` authoring.

## Global Constraints

- **Fidelity bar:** faithful-but-pragmatic — reproduce content/structure/layout with existing blocks; accept minor visual deltas rather than bespoke pixel-matching.
- **Reuse first:** use existing blocks (28 built). New *blocks* are a last resort; prefer block *variants*. Any block change goes through `content-driven-development`.
- **Case-study slugs:** short slugs, drop the source `-intuit-enterprise-suite` suffix (e.g. `redhammer`, not `redhammer-intuit-enterprise-suite`).
- **Content location:** canonical EDS HTML into `content/<path>.html` (DA table form, matching existing imported pages).
- **CSS scoping:** every selector scoped to the block; mobile-first with `min-width` breakpoints at 600/900/1200px. Never modify `scripts/aem.js`.
- **Lint gate:** `npm run lint` clean before any commit that touches `blocks/`, `scripts/`, or `styles/`.
- **Local-first, then DA:** verify on localhost before pushing a batch to DA.
- **Out of scope:** `/blog/*` articles, blog category landings, blog author pages (Phase 2).

---

## Shared Procedures

These are referenced by name from each page task. Follow them verbatim.

### PROCEDURE-MIGRATE (per page)
1. Invoke the `page-import` skill with the source URL `https://erp.intuit.com/<path>/`. It scrapes, identifies structure, maps to existing blocks, and writes canonical EDS HTML to `content/<target-path>.html` plus any page images under the images folder.
2. Confirm the generated file uses only existing blocks (see the archetype's locked block set). If a needed block/variant is missing, STOP and handle via `content-driven-development` before continuing.
3. Preview locally: ensure the dev server is up (`npx -y @adobe/aem-cli up --no-open --forward-browser-logs`, background). Open `http://localhost:3000/<target-path>`.

### PROCEDURE-VERIFY (per page)
1. Structural diff: `curl -s http://localhost:3000/<target-path>.plain.html` vs. the source page's main content — confirm every source section is represented (heading, body copy, CTAs, images, stats, quotes).
2. Visual check: load `http://localhost:3000/<target-path>` and the live `https://erp.intuit.com/<path>/` side by side; confirm block order, hero, media, and CTA bands match at the faithful-but-pragmatic bar.
3. Metadata: confirm `<title>`, `og:title`, `og:description`, `og:image`, and (for indexed types) `date`/`industry`/`type` meta are present in the page `metadata` block.
4. Fix any gaps by editing `content/<target-path>.html` (or the block via `content-driven-development`), re-preview.

### PROCEDURE-COMMIT (per page or small batch)
1. If blocks/scripts/styles changed: `npm run lint` — must be clean.
2. `git add content/<...> [blocks/... media/...]`
3. `git commit -m "Migrate <path> from erp.intuit.com"` (append the Co-Authored-By trailer).

### PROCEDURE-DAPUSH (per batch, after local verification)
1. Ensure a valid DA token (`da-auth`) / the **AEM DA - Prod** MCP is connected.
2. For each page in the batch, push `content/<path>.html` to DA at `/aemsites/intuit-erp/<path>` via `da-content` / DA Source API.
3. Trigger DA preview for each pushed path; confirm 200 and spot-check the preview URL.
4. Record pushed paths in `tasks/todo.md`.

---

## Task 0: Environment + spot-check baseline

**Files:**
- Create: `tasks/todo.md`, `tasks/lessons.md`
- Read: `content/construction.html`, `content/blog/case-study/redhammer.html`, `content/blog/research/enterprise-technology-benchmark-report.html`

**Interfaces:**
- Produces: a running dev server on `:3000`; a calibrated understanding of the quality bar; `tasks/todo.md` seeded with all Phase-1 pages.

- [ ] **Step 1:** Start the dev server in background: `npx -y @adobe/aem-cli up --no-open --forward-browser-logs`. Confirm `http://localhost:3000/construction` returns 200.
- [ ] **Step 2:** Spot-check 3 imported pages against source using PROCEDURE-VERIFY (steps 1–2 only, no edits): `construction`, `blog/case-study/redhammer`, `blog/research/enterprise-technology-benchmark-report`. Note any systemic deltas in `tasks/lessons.md`.
- [ ] **Step 3:** Seed `tasks/todo.md` with a checklist of every Phase-1 page grouped by task (copy the lists from Tasks 1–8).
- [ ] **Step 4:** Commit: `git add tasks/ && git commit -m "Seed Phase 1 migration tracker + baseline notes"`.

**Deliverable:** dev server verified, quality bar calibrated, tracker seeded.

---

## Task 1: Case-study template (representative)

**Files:**
- Create: `content/blog/case-study/western-companies.html`
- Reference block set (locked): `case-study-header · stat-band(glance) · media-text · testimonial(video) · case-study-cards(recommended) · cta-band`

**Interfaces:**
- Consumes: existing case-study blocks.
- Produces: the locked case-study block set + a verified reference page for Task 2. `western-companies` chosen as representative (net-new, construction-adjacent, exercises stats + quote + related cards).

- [ ] **Step 1:** PROCEDURE-MIGRATE for `/blog/case-study/western-companies-intuit-enterprise-suite/` → `content/blog/case-study/western-companies.html`.
- [ ] **Step 2:** Confirm output matches the locked block set. If the source uses a section not covered (e.g. a results table), decide reuse (`table`/`stat-band`) — do NOT invent a block.
- [ ] **Step 3:** PROCEDURE-VERIFY. Pay attention to: `industry` meta (drives `/blog/case-study/query-index.json` filtering), the testimonial video id, and the "recommended" related-cards.
- [ ] **Step 4:** Confirm the page appears in `curl -s http://localhost:3000/blog/case-study/query-index.json` after preview.
- [ ] **Step 5:** PROCEDURE-COMMIT.

**Deliverable:** one verified case study; block set locked for batch.

---

## Task 2: Case-study batch (remaining 10)

**Files (create, short slugs):**
- `content/blog/case-study/fefa-financial.html` ← `/blog/case-study/fefa-financial-intuit-enterprise-suite/`
- `content/blog/case-study/fire-and-ice.html` ← `/blog/case-study/fire-and-ice-intuit-enterprise-suite-review/`
- `content/blog/case-study/fixe.html` ← `/blog/case-study/fixe-intuit-enterprise-suite/`
- `content/blog/case-study/four-points-rv-resorts.html` ← `/blog/case-study/four-points-rv-resorts-intuit-enterprise-suite/`
- `content/blog/case-study/hfmm-legacy-group-growth.html` ← `/blog/case-study/hfmm-legacy-group-growth/`
- `content/blog/case-study/humble-house.html` ← `/blog/case-study/humble-house-intuit-enterprise-suite/`
- `content/blog/case-study/lallier-construction.html` ← `/blog/case-study/lallier-construction-intuit-enterprise-suite/`
- `content/blog/case-study/lango.html` ← `/blog/case-study/lango-intuit-enterprise-suite/`
- `content/blog/case-study/nick-schiffer-construction-webinar.html` ← `/blog/case-study/nick-schiffer-construction-webinar/`
- `content/blog/case-study/sylvia-brafman.html` ← `/blog/case-study/sylvia-brafman-intuit-enterprise-suite/`

**Interfaces:**
- Consumes: locked case-study block set from Task 1.

- [ ] **Step 1:** For each page above: PROCEDURE-MIGRATE → PROCEDURE-VERIFY. May be fanned out to parallel subagents (blocks are locked; only `content/` files are written — no shared-file conflicts).
- [ ] **Step 2:** Set correct `industry` meta per page (construction / financial-services / food-service / professional-services) so query-index filtering is right. Cross-check the source page's category.
- [ ] **Step 3:** Confirm all 10 appear in `/blog/case-study/query-index.json`.
- [ ] **Step 4:** PROCEDURE-COMMIT (one commit per 2–3 pages is fine).
- [ ] **Step 5:** PROCEDURE-DAPUSH for the full case-study batch (Tasks 1–2).

**Deliverable:** all 17 source case studies present in `content/` and DA.

---

## Task 3: Research/guide template + path decision

**Files:**
- Create: `content/blog/research/forrester-tei-cost-savings.html` (representative)
- Reference block set (locked): `hero · stat-band · media-text · download-form · resource-cards · faq · cta-band`

**Path decision (make in Step 0, record in `tasks/lessons.md`):** the repo already places research/guide content under `/blog/research/*` (two pages) while the source splits it across `/blog/research/*` and `/blog/guide/*`. **Decision: mirror the repo's existing convention — consolidate all research/guide/whitepaper/report pages under `/blog/research/*`** (keeps one index + one `query-index.json`; the two already-migrated pages stay put). Preserve a human-readable slug per page.

**Interfaces:**
- Produces: locked research block set; the consolidation convention for Task 4.

- [ ] **Step 0:** Record the path-consolidation decision above in `tasks/lessons.md`.
- [ ] **Step 1:** PROCEDURE-MIGRATE for `/blog/research/intuit-enterprise-suite-cost-savings-forrester-tei/` → `content/blog/research/forrester-tei-cost-savings.html`.
- [ ] **Step 2:** Verify the `download-form` gated-asset behavior renders locally (form markup present; submit handler may be inert locally — note that in `tasks/lessons.md`, don't block on it).
- [ ] **Step 3:** PROCEDURE-VERIFY, incl. `date` meta (drives `/blog/research/query-index.json`).
- [ ] **Step 4:** Confirm presence in `/blog/research/query-index.json`.
- [ ] **Step 5:** PROCEDURE-COMMIT.

**Deliverable:** one verified research page; block set + path convention locked.

---

## Task 4: Research/guide batch (remaining ~8)

**Files (create under `content/blog/research/`, mapping source → target slug):**
- `business-solutions-survey-2024.html` ← `/blog/research/business-solutions-survey-2024/`
- `ai-workplace-whitepaper.html` ← `/blog/guide/ai-workplace-whitepaper/`
- `construction-accounting-erp-guide.html` ← `/blog/guide/construction-accounting-erp/`
- `construction-digital-transformation-whitepaper.html` ← `/blog/guide/construction-digital-transformation-whitepaper/`
- `data-analytics.html` ← `/blog/guide/data-analytics/`
- `lt-webinar-capture.html` ← `/blog/guide/lt-webinar-capture/`
- `unlocking-business-growth.html` ← `/blog/guide/unlocking-business-growth/`
- `webinars-on-demand.html` ← `/blog/guide/webinars-on-demand/`

**Interfaces:**
- Consumes: locked research block set + path convention from Task 3.

- [ ] **Step 1:** For each: PROCEDURE-MIGRATE → PROCEDURE-VERIFY. `webinars-on-demand` and `lt-webinar-capture` are list/capture pages — verify they use `resource-cards`/`event-cards`, not a bespoke block.
- [ ] **Step 2:** Set `date` meta per page; confirm all appear in `/blog/research/query-index.json`.
- [ ] **Step 3:** If `/blog/guide/*` inbound paths must resolve, note the need for redirects in `tasks/todo.md` (redirect config is a follow-up, not blocking).
- [ ] **Step 4:** PROCEDURE-COMMIT.
- [ ] **Step 5:** PROCEDURE-DAPUSH for the research batch.

**Deliverable:** all research/guide pages under `/blog/research/`, indexed, in DA.

---

## Task 5: Solution / marketing pages (8, mostly bespoke)

**Files (create):**
- `content/account-management.html` ← `/account-management/`
- `content/accountant.html` ← `/accountant/`
- `content/accountant/free-consultation/ies.html` ← `/accountant/free-consultation/ies/`
- `content/accountant/free-consultation/ies/coffee.html` ← `/accountant/free-consultation/ies/coffee`
- `content/migration.html` ← `/migration/`
- `content/contact.html` ← `/contact/`
- `content/ibs.html` ← `/ibs/`
- `content/oa.html` ← `/oa/`

**Interfaces:**
- Consumes: solution block set `hero · stat-band · media-text · faq · fragment(schedule-call) · cards · icon-columns · tabs · testimonial · cta-band`.

- [ ] **Step 1:** Triage first: `curl -s https://erp.intuit.com/oa/` and `/ibs/` — if they are thin redirect/stub pages, migrate as minimal pages (or note as redirect targets) rather than full builds. Record findings in `tasks/todo.md`.
- [ ] **Step 2:** For each substantive page (`account-management`, `accountant`, `accountant/free-consultation/ies`, `.../coffee`, `migration`, `contact`): PROCEDURE-MIGRATE → PROCEDURE-VERIFY. Do NOT parallelize blindly — these are bespoke; if any needs a block *variant*, handle it via `content-driven-development` and re-lint before proceeding.
- [ ] **Step 3:** `contact` and `accountant/free-consultation` pages likely embed the `form`/`schedule-call` fragment — verify the fragment reference resolves (`content/fragments/schedule-call.html` exists) and the form renders.
- [ ] **Step 4:** PROCEDURE-COMMIT (one commit per page for these bespoke pages).
- [ ] **Step 5:** PROCEDURE-DAPUSH for the solution/marketing batch.

**Deliverable:** all remaining solution/marketing pages migrated + verified + in DA.

---

## Task 6: Webinar-landing template (representative)

**Files:**
- Create: `content/webinar-shawnvandyke.html` (representative)

**Interfaces:**
- Produces: a locked webinar-landing block set for Task 7.

- [ ] **Step 1:** `curl -s https://erp.intuit.com/webinar-shawnvandyke/` and identify the section sequence (expected: hero + registration `form`/`download-form` + speaker(s) `media-text`/`cards` + agenda `text`/`table` + `cta-band`).
- [ ] **Step 2:** PROCEDURE-MIGRATE → PROCEDURE-VERIFY. If a repeating "speakers"/"agenda" pattern doesn't map to an existing block, prefer composing from `cards`/`media-text`/`table` before creating anything new.
- [ ] **Step 3:** Record the locked webinar block set in `tasks/lessons.md`.
- [ ] **Step 4:** PROCEDURE-COMMIT.

**Deliverable:** one verified webinar page; block set locked.

---

## Task 7: Webinar-landing batch (remaining 10)

**Files (create):**
- `content/webinar-fof-april1.html` ← `/webinar-fof-april1/`
- `content/webinar-fof-march.html` ← `/webinar-fof-march/`
- `content/webinar-fof-may.html` ← `/webinar-fof-may/`
- `content/webinar-fofqbo.html` ← `/webinar-fofqbo/`
- `content/webinar-lt-simulive.html` ← `/webinar-lt-simulive/`
- `content/webinar-matthiggins.html` ← `/webinar-matthiggins/`
- `content/webinar-mikemichalowicz/consultation-livestream.html` ← `/webinar-mikemichalowicz/consultation-livestream/`
- `content/webinar-on-demand-cp.html` ← `/webinar-on-demand-cp`
- `content/webinar-product-demo-cp.html` ← `/webinar-product-demo-cp`
- `content/nickschiffer-encore-0326.html` ← `/nickschiffer-encore-0326/`

**Interfaces:**
- Consumes: locked webinar block set from Task 6.

- [ ] **Step 1:** For each: PROCEDURE-MIGRATE → PROCEDURE-VERIFY. Fan out to parallel subagents (blocks locked; only `content/` files written).
- [ ] **Step 2:** Verify registration forms render and CTAs point at the correct source destinations.
- [ ] **Step 3:** PROCEDURE-COMMIT.
- [ ] **Step 4:** PROCEDURE-DAPUSH for the webinar batch.

**Deliverable:** all webinar landing pages migrated + verified + in DA.

---

## Task 8: Final reconciliation

**Files:**
- Modify (if needed): `helix-query.yaml`
- Update: `tasks/todo.md` (review section)

- [ ] **Step 1:** Re-run the source-vs-`content/` gap check (the sitemap-diff command from planning) and confirm every in-scope page now exists. List any stragglers.
- [ ] **Step 2:** Verify each `query-index.json` (`case-studies`, `research`, `events`) contains its new pages; adjust `helix-query.yaml` include globs only if a page is missing.
- [ ] **Step 3:** Full `npm run lint` — clean.
- [ ] **Step 4:** Confirm all batches pushed to DA (PROCEDURE-DAPUSH complete for Tasks 2/4/5/7); list any deferred.
- [ ] **Step 5:** Write the review section in `tasks/todo.md` (pages migrated, deltas accepted, redirects deferred, Phase 2 handoff notes) and commit.

**Deliverable:** Phase 1 complete; source and `content/` reconciled; DA in sync; Phase 2 (`/blog/*` corpus) handoff documented.

---

## Self-Review

- **Spec coverage:** Phase 0 (Task 0) ✓; case studies (Tasks 1–2) ✓; research/guides (Tasks 3–4) ✓; solution/marketing (Task 5) ✓; webinar landings (Tasks 6–7) ✓; publishing/local-first + DA push (PROCEDURE-DAPUSH in each batch + Task 8) ✓; query-index verification (Task 8) ✓; slug decision (Global Constraints + Task 2) ✓; out-of-scope blog (Global Constraints) ✓.
- **Placeholder scan:** every page task lists exact source URL → target file; procedures are spelled out once and referenced by name (identical skill-driven operation, not novel per-page code). No TODO/TBD.
- **Open risk carried forward:** webinar block set is assumed until Task 6 verifies it; `/oa` `/ibs` triaged in Task 5 Step 1; gated-form submit handlers may be inert locally (noted, non-blocking).
