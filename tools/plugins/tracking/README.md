# Tracking Inspector POC

Branch-only DA app for evaluating a rendered-page tracking editor before exposing one in the
customer's DA configuration.

## Safety boundary

- Reads `/tracking.json` only to seed the initial view.
- Writes only `/drafts/tracking-editor-poc.json`.
- A GET for that sandbox returns an expected `404` until the first successful save; the app treats
  it as "sandbox not created" and continues with the live sheet seed.
- The website runtime does not fetch or consume the sandbox file.
- This branch does not register the app in DA Library, Prepare, Apps, or Sidekick configuration.
- Preview pages load with `?martech=off`, and inspection does not synthesize an interaction.

## POC capabilities

- Loads a rendered page from the same branch as the app.
- Keeps the rendered page as the primary canvas with a bounded inspector rail on desktop.
- Inventories block-scoped, loose-page, and pure-derived tracking targets.
- Selects targets from the list or by clicking the embedded preview.
- Compares automatic and effective values in one table and highlights only differences.
- Edits page-scoped or global sparse overrides.
- Validates `custom-properties` and survey key/value syntax.
- Detects same-field concurrent edits before updating the sandbox.

## Test from a pushed branch

Open the app while signed in to DA, passing the code branch as `ref` and an existing previewed page
as `path`:

```text
https://da.live/app/aemsites/intuit-erp/tools/plugins/tracking/index?ref=codex-tracking-editor-poc&path=/accounting/multi-entity
```

DA expects the AEM-safe branch ref, so replace `/` in the Git branch name with `-`.

The rendered page may also request missing `blocks/metadata/metadata.css` and `.js` assets when its
authored Metadata table appears as a block in DA Preview. The standard block loader catches those
404s; they are unrelated to inspector readiness.

The app and embedded page must come from the same branch origin. Preview the chosen content page
before loading it in the POC if its latest DA edits are not yet available on `aem.page`.

For local development, start AEM CLI and use `ref=local`:

```text
https://da.live/app/aemsites/intuit-erp/tools/plugins/tracking/index?ref=local&path=/accounting/multi-entity
```

## Deliberate POC limitations

- The sandbox does not affect actual click behavior; the Effective panel is a simulation using the
  real runtime resolver.
- The POC does not preview or publish its sandbox file.
- Stale/orphan sheet-row auditing and visual highlighting from list-to-page are deferred.
- No customer-facing DA registration is included.
