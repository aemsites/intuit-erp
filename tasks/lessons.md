# Migration Lessons & Decisions

## Decisions
- **Case-study slugs:** short form, no `-intuit-enterprise-suite` suffix.
- **Guide→research consolidation:** source `/blog/guide/*` pages migrate under `/blog/research/*` (single index + query-index). Two research pages already there stay put.

## Baseline notes (Task 0 spot-check)
- **Preview method (CORRECTED):** requires **aem-cli ≥ 16.20** (the cached 16.16.6 is too old —
  it proxies everything and its `--html-folder` serves `.html` RAW/undecorated). Run
  **`npx -y @adobe/aem-cli@latest up --no-open`** (do NOT pass `--html-folder`). v16.21.4 logs
  "Serving content from local content/, proxying missing files from …aem.page" and auto-serves +
  DECORATES `content/<path>.html` at its clean natural path **`http://localhost:3000/<path>`**
  (NO `/content` prefix), wrapping with head.html + injecting styles/scripts. Missing paths proxy
  to the aem.page backend. (Earlier `--html-folder content` guidance was wrong — that mounts at
  `/content` and, on the old CLI, serves raw undecorated body → pages look unstyled.)
- **Source is client-rendered:** raw `curl https://erp.intuit.com/<path>/` returns no
  headings/body (JS-hydrated). Structural/visual comparison against source must use the
  `page-import` scraper (renders JS) or the browser tool — NOT raw curl of the source.
- **Block decoration is client-side:** server HTML (curl of `/content/<path>`) won't
  contain `class="x block"`; those are added by `aem.js` at runtime. Inspect
  `.plain.html` for authored structure, or the browser DOM for decorated output.
- Spot-checked `construction`, `blog/case-study/redhammer`, `blog/research/
  enterprise-technology-benchmark-report` — all render correctly locally. Quality bar good.

## Workflow discoveries (Task 1) — apply to ALL page tasks
- **EDS skills are now INSTALLED as a plugin** (`aem-edge-delivery-services@adobe-skills`,
  user scope, enabled). Installed via:
  `claude plugin marketplace add adobe/skills` then
  `claude plugin install aem-edge-delivery-services@adobe-skills`.
  All 24 skills (`page-import`, `content-driven-development`, `da-content`, …) are invocable
  via the Skill tool in freshly-dispatched agents / new sessions. Update with
  `claude plugin update aem-edge-delivery-services@adobe-skills`. (An earlier symlink hack under
  `.claude/skills/` was reversed in favor of this proper install. The vendored bundle still sits
  git-ignored at `.claude/skills/skills/` — redundant now but harmless.)
- **Fallback if `page-import`'s scraper is blocked:** erp.intuit.com uses Akamai bot-detection;
  the browser/Playwright scraper may be blocked. If so, extract the source's `__NEXT_DATA__` JSON
  (the site is Next.js): `curl -A "Mozilla/5.0 …" <src-url>` then parse the
  `<script id="__NEXT_DATA__">…</script>` payload. Raw curl WITH a browser User-Agent returns 200
  and the full structured content. (This proven method built western-companies + fefa-financial.)
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

## Execution/tooling lessons (rate-limit + sandbox)
- **Source (erp.intuit.com) rate-limits hard (429), intermittently.** A single blocking
  `curl -s -A <UA> --retry 15 --retry-delay 20 --retry-all-errors --retry-max-time 400 --max-time 45 <URL>`
  absorbs the backoff INSIDE curl and reliably lands 200 — no external wait needed.
- **Subagents STALL if they use the Monitor tool / `run_in_background` / `sleep` for backoff** —
  they spawn a wait-command, end their turn, and never resume (progress commits durably, but the
  dispatch is wasted). FIX: instruct implementers to do all waiting via the blocking `curl --retry`
  above; forbid Monitor/background/sleep. One dispatch then finishes the whole batch.
- **Controller (this session) Bash gets network-sandboxed on long/background calls** — curl returns
  empty and even `rm`/`cat`/`tee` are "command not found". Short foreground curls sometimes work.
  Net: don't rely on the controller to bulk-fetch the source; subagents have reliable network.
- Per-page migration commits in small groups (2-3) so a stall never loses more than the current group.

## IMAGE URL STRATEGY (user directive) — every content image must be a fully-qualified source URL
Target DA org is **`da.live/#/aemsites/intuit-erp`** (NOT `keepthebyte`). On DA preview, DA auto-ingests
images referenced by fully-qualified external URLs into the pipeline. So every CONTENT image must be a
real, fully-qualified `https://erp.intuit.com/...` (or `digitalasset.intuit.com` / `www.intuit.com/oidam`)
source URL. Fix these two bad patterns:
- **`https://content.da.live/keepthebyte/aem-intuit-erp/media/<hash>-<name>`** (wrong org) → reconstruct.
- **`src="/media/<hash>-<name>"`** (root-relative) → reconstruct.
**Reconstruction (verified working, images return 200 even while pages 429):** strip the `<hash>-` prefix;
the DA filename's mangled trailing `-.<ext>` becomes `-2x.<ext>`; then
`https://erp.intuit.com/oidam/intuit/erp/en_us/web/image/<subpath>/<name>` where `<subpath>` ∈
{logo, feature, product, photo, images}. Curl-verify each candidate (200 image/*) before committing.
Many correct URLs already exist as good refs elsewhere in content/ (build a filename→good-URL map first).
Example: `…/keepthebyte/…/d3d8a46c-redhammer-dk-md-logo-ies-us-en-2x.png`
      → `https://erp.intuit.com/oidam/intuit/erp/en_us/web/image/logo/redhammer-dk-md-logo-ies-us-en-2x.png` (200).
**Leave alone (NOT content images):**
- `/media/017826e1-svgexport-17.svg` — decorative testimonial quote-mark; a git CODE asset the
  `testimonial` block requires as its first authored cell; no erp.intuit.com URL exists (inline SVG in
  source React). All testimonial usages (incl. pre-existing) use this git asset.
- `/media/erp-*.png` — stardust prototype placeholders, only on `content/library/blocks/*` demo pages.
Already-good hosts (no change): `erp.intuit.com`, `digitalasset.intuit.com`, `www.intuit.com/oidam`.
Scope: all migrated content headed to DA — mine + pre-existing marketing/case-study pages (~35 files).

## Block-variant changelog
_(record any block/CSS changes made during migration here)_
