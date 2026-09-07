# Verification tools

This directory contains the supported browser and contract checks for the site's martech
integration. It also contains independently maintained visual/content parity tools; those are not
part of the martech verification kit.

## Prerequisites

Install the repository dependencies with `npm install`. The browser checks require Playwright,
network access, and a local development server at `http://localhost:3000`.

## Supported checks

Run the normalized vendor, Tealium tag, and data-layer comparison against the committed production
baseline:

```sh
npm run verify:martech
```

Run the deployed `window.appVars`, personalization DOM channel, and page-view beacon checks:

```sh
npm run verify:appvars
```

Run the deterministic click-tracking contract tests:

```sh
npm run verify:click-tracking
```

`verify:martech` and `verify:appvars` expect the local server to be running and fail if any selected
page cannot be measured. Their committed goldens contain normalized names and shapes rather than
visitor, session, or campaign values. The underlying tools still support report-only runs, where an
unreachable environment is shown as `SKIPPED` rather than being mistaken for parity.

For an ad hoc click comparison, `clicktrack-diff.mjs` can compare live pages or saved HTML:

```sh
node scripts/diff/clicktrack-diff.mjs --path / --ours http://localhost:3000/ --assert
node scripts/diff/clicktrack-diff.mjs --html-baseline baseline.html --html-ours local.html --assert
```

Refreshing a committed production baseline is an intentional maintenance operation. Review the
resulting diff before committing it:

```sh
node scripts/diff/martech-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/martech.golden.json
node scripts/diff/appvars-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/appvars-homepage.golden.json
```

## Repository boundary

Raw production payloads, authenticated browser profiles, campaign values, and replay evidence are
not part of this repository. Do not add them under `scripts/diff/fixtures`; local captures belong in
the gitignored `scripts/diff/fixtures/local/` directory.

The following files are the independently maintained visual/content parity toolset and are outside
the martech kit:

- `content-diff.mjs`
- `content-inventory.mjs`
- `diff-profiles.mjs`
- `visual-diff.mjs`
- `live-session.mjs` (shared browser utility)
