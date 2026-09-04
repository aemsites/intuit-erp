# Tracking Inspector

A Document Authoring rail extension for inspecting rendered tracking values and maintaining the
sparse overrides in `/tracking.json`.

## What it does

- Opens the current DA document automatically.
- Inventories block-scoped, loose-page, and pure-derived tracking targets from the rendered page.
- Keeps the rendered document in the DA canvas and shows only tracking properties in the extension
  rail.
- Selects targets from the searchable interaction list.
- Compares automatic and effective values and highlights only the fields changed by an override.
- Edits page-scoped or global sparse overrides without requiring authors to derive tracking IDs.
- Validates `custom-properties` and survey key/value syntax.
- Preserves unrelated rows and columns, stops same-field concurrent edits, and uses DA ETag
  preconditions so an interleaved whole-sheet write cannot be overwritten.
- Saves the source sheet, previews it through AEM, and publishes only after an explicit confirmation.

The extension gathers its inventory from the rendered preview already owned by DA Canvas. A narrow,
same-project `postMessage` bridge lets the rail ask that sibling preview for resolved properties
without embedding a second copy of the page. The bridge loads only in DA quick-edit previews (or
when explicitly enabled for local tests); it never enables martech or synthesizes an interaction.

## DA registration

Register the plugin in the site's `library` config sheet:

| title | path | format | icon | experience | ref |
| --- | --- | --- | --- | --- | --- |
| Tracking Inspector | `/tools/plugins/tracking/index.html?v=20260904.1` |  | `/tools/plugins/tracking/tracking.svg` |  |  |

Use the `ref` column only while reviewing a feature branch. Leave it blank in the production
registration so DA loads the plugin from `main`.

The version query is the plugin release identifier. Bump it in both this row and the plugin's local
asset imports whenever a release changes browser code; this prevents Canvas from reusing a mixed or
stale module graph.

Open Tracking Inspector from the extension selector in DA Canvas. The standalone `/app/` URL has no
rendered Canvas sibling and is therefore not an end-to-end test for this extension.

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
npx vitest run test/tracking-editor-assets.test.js test/tracking-editor-api.test.js test/tracking-editor-delivery.test.js test/tracking-editor-model.test.js test/tracking-inspector.test.js test/tracking-inspector-bridge.test.js
```

Before release, also run `npm run lint` and exercise an authenticated add → edit → remove lifecycle
against a disposable row, previewing after every change and publishing only the cleaned final sheet.
