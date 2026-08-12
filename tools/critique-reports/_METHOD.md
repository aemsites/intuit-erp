# Critique method — full browser, per page (source of truth vs migrated)

Each page in `tools/critique-reports/<path>.json` was critiqued by rendering BOTH
sides in a real browser (Chrome via CDP) so the source SPA executes its JS.

- **Source of truth:** `https://erp.intuit.com/<path>/` (rendered, SPA-safe)
- **Migrated:** `http://localhost:3000/content/<path>` (local EDS)
- **Viewport:** headless default (~1280 wide)

## Categories (visual-critique skill)
- **content** — source headings/sections present on migrated (word-overlap match ≥60%); broken forms
- **styling** — hero background, h1 color/weight/size
- **global** — body font family
- **structural/interactions** — noted where detected (e.g. list rendered as tabs)

## Scoring
`similarity = contentFidelity% − stylePenalty − formPenalty`
- contentFidelity = % of source content headings found on migrated
- stylePenalty ≤ 50 (hero bg / h1 diffs, scoring.md weights)
- formPenalty = 15 if migrated form fails to load

## Known caveats (all CONSERVATIVE — they understate, never overstate)
1. Source is a Next.js SPA; the extractor scrolls + expands hidden panels to
   trigger lazy content, but some lazily-loaded items may still miss the snapshot.
2. Stats rendered as non-heading `<div>` (e.g. "$596K") can flag as "missing".
3. Source-side related-article chrome ("Download", "Customer stories") can count
   as missing content on blog pages.
4. `source: BLOCKED` / `deferred: source-unavailable` = erp.intuit.com bot-throttled
   the automated request even after 5 retries; NOT a migration defect.
Every report keeps the raw `missingOnMigrated` list so residual noise is auditable.
