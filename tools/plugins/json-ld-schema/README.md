# JSON-LD Schema Plugin

A DA (Document Authoring) library plugin that generates `FAQPage` JSON-LD
structured data for the currently open page and copies it to the clipboard,
ready to paste into the page's `json-ld` metadata row.

## What it does

1. Reads the current page's source (read-only — never writes back to the
   document; see [Why copy-to-clipboard, not direct injection](#why-copy-to-clipboard-not-direct-injection)).
2. Finds every `.faq`-classed block on the page (any variant, e.g. `faq cmp`)
   and extracts each Question/Answer row.
3. Reads the page's existing `json-ld` metadata value, if any, and merges the
   generated `FAQPage` node into its `@graph` by `@type` — safe to re-run
   after content changes without duplicating nodes.
4. Resolves the `@id` in this order: an existing `WebPage` node's `url`/`@id`
   in the page's own `json-ld` → a plain `canonical`/`url` metadata key → the
   current `aem.page`/`aem.live` URL as a last resort.
5. Shows the detected Q&A pairs and the generated JSON, and a
   **Copy JSON-LD to clipboard** button.

You paste the copied JSON into the page's `Metadata` block yourself, in a
`json-ld` row (adding the row if the page doesn't have one yet).

## Why copy-to-clipboard, not direct injection

An earlier version of this plan used the DA Source API (`daFetch` `GET`/`PUT`)
to write the merged JSON-LD straight back into the document. That was
dropped: a raw `PUT` to the Source API is not a Y.js delta, so it can race
with — and be overwritten by — an open live-editing session on the same
document. Reading the source is always safe; writing it isn't. Copy-to-
clipboard sidesteps that entirely: insertion happens through the normal DA
editor, which goes through the live collaborative session properly.

## v1 scope

FAQ only. Other schema types (`BreadcrumbList`, `Product`, `Review`, etc.)
are future work — add another extractor module rather than rewriting this
one. The core functions (`extractFaqEntities`, `buildFaqPageSchema`) are
exported from `json-ld-schema.js` for reuse.

## Staleness

This is a manual, author-triggered tool — it does not detect or notify when
FAQ content changes after the JSON-LD was generated. The UI shows a reminder
to re-run it after editing FAQ content; there is no automatic check.

## Usage

1. Register the plugin in your DA site config
   (`https://da.live/config#/{org}/{site}/`, `library` sheet):

   | title            | path                                                   | experience |
   | ---------------- | ------------------------------------------------------- | ---------- |
   | `JSON-LD Schema` | `/tools/plugins/json-ld-schema/json-ld-schema.html`      | `dialog`   |

2. Open a page with a `.faq` block in the DA editor, open the Library panel,
   and select **JSON-LD Schema**.
3. Review the detected Q&A pairs and the generated JSON, then click
   **Copy JSON-LD to clipboard**.
4. In the document's `Metadata` block, add (or update) a `json-ld` row and
   paste the copied value into it.
5. Preview/publish the page as usual.

## Files

| File                   | Purpose                                       |
| ---------------------- | ---------------------------------------------- |
| `json-ld-schema.html`  | Minimal HTML shell                             |
| `json-ld-schema.js`    | Plugin logic — fetch, extract, merge, preview  |
| `json-ld-schema.css`   | Styles                                         |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — provides `context` and
  authenticated `daFetch`
- No build step; plain ES modules

## Prior art

- `tools/plugins/tags/` — the simple plugin pattern (fetch, render, insert via
  `actions.sendText`) this plugin's shell follows.
- `tools/plugins/personalization/` — demonstrates the DA Source API
  read/write pattern; this plugin reuses only its read side
  (`GET /source/{org}/{repo}{path}.html`), not the write side, per the
  decision above.
- [`usman-khalid/da-playground/tools/json-ld-generator`](https://github.com/usman-khalid/da-playground/tree/main/tools/json-ld-generator) —
  external reference plugin that generates generic `Article` schema from
  page metadata and copies it to clipboard. `parseMetadata()`,
  `buildSourceUrl()`, `buildPageUrl()`, and `pick()` in this plugin are
  adapted from it; the FAQ extraction and `@graph` merge logic are new,
  ported from the Python extraction script used in
  [#484](https://github.com/aemsites/intuit-erp/issues/484).
