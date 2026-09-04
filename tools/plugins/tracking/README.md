# Tracking Inspector

A fullscreen Document Authoring plugin for inspecting rendered tracking values and maintaining the
sparse overrides in `/tracking.json`.

## What it does

- Opens the current DA document automatically, with an optional `path` query override for direct-app
  use.
- Inventories block-scoped, loose-page, and pure-derived tracking targets from the rendered page.
- Selects targets from the list or by clicking the embedded preview.
- Compares automatic and effective values and highlights only the fields changed by an override.
- Edits page-scoped or global sparse overrides without requiring authors to derive tracking IDs.
- Validates `custom-properties` and survey key/value syntax.
- Preserves unrelated rows and columns, stops same-field concurrent edits, and uses DA ETag
  preconditions so an interleaved whole-sheet write cannot be overwritten.
- Saves the source sheet, previews it through AEM, and publishes only after an explicit confirmation.

The rendered inspector is query-gated and available only on AEM preview, DA preview, and localhost
origins. It never enables martech while inspecting a page and never synthesizes an interaction.

## DA registration

Register the plugin in the site's `library` config sheet:

| title | path | format | icon | experience | ref |
| --- | --- | --- | --- | --- | --- |
| Tracking Inspector | `/tools/plugins/tracking/index.html` |  | `/tools/plugins/tracking/tracking.svg` | `fullsize-dialog` |  |

Use the `ref` column only while reviewing a feature branch. Leave it blank in the production
registration so DA loads the plugin from `main`.

## Direct app

The registered plugin is the normal entry point. For branch review, open the app directly with the
AEM-safe branch ref and a previewed content path:

```text
https://da.live/app/aemsites/intuit-erp/tools/plugins/tracking/index?ref={feature-ref}&path=/accounting/multi-entity
```

For local development, start AEM CLI and use `ref=local`. DA loads the plugin and rendered page from
localhost; source delivery is intentionally previewed and published against the `main` AEM ref:

```text
https://da.live/app/aemsites/intuit-erp/tools/plugins/tracking/index?ref=local&path=/accounting/multi-entity
```

## Editing and delivery lifecycle

1. Select a rendered target and edit its page or global overrides.
2. **Save & preview** re-reads `/tracking.json`, checks for same-field concurrent changes, writes the
   merged sheet only if its ETag is still current, and verifies the same revision after previewing it
   through AEM.
3. **Publish** asks for confirmation, verifies the reviewed ETag before and after a fresh preview,
   and then publishes that preview to live.

If the source write succeeds but previewing fails, the editor reports the partial success explicitly.
Re-open the target and save again after resolving the preview error. DA versions every source update,
so previous sheet revisions remain available in document history.

## Verification

Run the focused editor and runtime tests:

```bash
npx vitest run test/tracking-editor-api.test.js test/tracking-editor-delivery.test.js test/tracking-editor-model.test.js test/tracking-inspector.test.js
```

Before release, also run `npm run lint` and exercise an authenticated add → edit → remove lifecycle
against a disposable row, previewing after every change and publishing only the cleaned final sheet.
