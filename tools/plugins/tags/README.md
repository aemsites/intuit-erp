# Tags Plugin

A multi-select, searchable tag picker for Adobe Document Authoring (DA) environments.

## Features

- Fetches tags from a JSON file (`/docs/library/tagging.json`) in your DA repo
- Filter tags by value, key, or comments
- Multi-select with checkboxes; select/deselect all
- Sends comma-separated tag keys to the document via the DA SDK

## Usage

1. Ensure your DA repo has a `docs/library/tagging.json` file:

   ```json
   {
     "data": [
       { "key": "tag-key-1", "value": "Tag Label 1", "comments": "Optional description" },
       { "key": "tag-key-2", "value": "Tag Label 2" }
     ],
     "limit": 100
   }
   ```

   - `key` — value inserted into the document when selected
   - `value` — label shown in the UI
   - `comments` — optional description shown below the label

2. Register the plugin in your DA site config:

   | title  | path                                    | icon                                                                              | format   |
   | ------ | --------------------------------------- | --------------------------------------------------------------------------------- | -------- |
   | `Tags` | `/tools/plugins/tags/tags.html`         | `https://main--{repo}--{org}.aem.page/tools/plugins/tags/classification.svg`      | `dialog` |

## Files

| File                  | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `tags.html`           | Minimal HTML shell                           |
| `tags.js`             | Plugin logic — fetch, render, search, send   |
| `tags.css`            | Spectrum-branded styles                      |
| `classification.svg`  | Plugin icon (Spectrum blue)                  |

## Dependencies

- [DA App SDK](https://da.live/nx/utils/sdk.js) — provides context, authenticated fetch, and document actions
- No build step; plain ES modules
