---
name: edit-click-tracking-overrides
description: Edit the sparse click-tracking overrides in the /tracking.json sheet — the authored residue (campaign wa-link codes, semantic object_detail / ui_object, non-default action, custom-properties, survey) that scripts/tracking.js cannot derive from the DOM. Inventory a page's rendered tracking targets so you never hand-derive a data-track-id, edit page-scoped or global overrides, validate them, and save → preview (→ publish only on explicit confirmation) through DA with an ETag precondition. This is the same contract the DA "Tracking Inspector" panel (tools/plugins/tracking/) writes. Use when a marketer, author, or agent needs to add or correct click-tracking values for one or more CTAs without the panel.
version: 1
status: approved
---

# Edit Click-Tracking Overrides

Add or correct the **authored residue** for click tracking — the per-CTA values `scripts/tracking.js`
**cannot derive** from the DOM — by editing the sparse override rows in the `/tracking.json` sheet.

This is the **same contract the DA "Tracking Inspector" panel (`tools/plugins/tracking/`) writes** —
follow it exactly so panel-authored and agent-authored overrides stay interchangeable. Prefer the
panel when an author is in DA Canvas; use this skill for headless/bulk work or when the panel isn't
available. Full contract: `CLICK-TRACKING.md`.

## The model in one paragraph

At click time the injected Intuit tracker reads `data-*` off the CTA and its ancestors. Our runtime
does **not** author those attributes at rest — it **derives** each CTA's payload and JIT-stamps it on
`pointerdown`/keyboard activation. The sheet holds **only the residue the derive can't know**. Values
merge in precedence order — **derive < region context < block declaration (`trackAs`) < sheet** — so a
sheet override always wins, and a **blank cell defers to the derived value**. Author the minimum: one
row per residue-bearing CTA, only the columns that differ from what code produces.

## Workflow

1. **Pick the page** — a normalized page path (e.g. `/accounting/multi-entity`), or `*` for
   site-wide chrome (nav, footer, floating widgets).
2. **Inventory the targets** (below) — never hand-derive a `data-track-id`. List the page's rendered
   CTAs with their `id`, `automatic` (derived) values, and any current `override`; keep only
   `editable` targets.
3. **Decide the residue** — for each CTA that needs it, gather the non-derivable values (campaign
   code, semantic detail, intent action, …) from the [What you can override](#what-you-can-override)
   table. Ask the author for anything marketing-owned; do not invent campaign codes.
4. **Validate** — run the [Validation](#validation) rules on `custom-properties` / `survey` before writing.
5. **Confirm** — present the exact rows to add/change (path, id, and each field, old → new) and wait:

   > Save these N override rows to `/tracking.json` and preview? Reply **proceed**.

6. **Save & preview** — apply the change, write the sheet with an **ETag precondition**, then preview
   (see [Reading and writing the sheet](#reading-and-writing-the-sheet)). Report conflicts instead of
   overwriting.
7. **Publish** — a **separate, explicit** step. Publishing `/tracking.json` changes live beacons, so
   ask again and wait for an explicit **publish to live** before calling publish. Preview is the
   default stopping point.

## Find the target — inventory, don't guess ids

A CTA's `data-track-id` is **derived and JIT-stamped at interaction time**, so it is not sitting in
the DOM at rest for you to copy. Get the ids from the runtime's own non-mutating inventory,
`collectTrackingInventory(document, sheetData, location)` (exported from `scripts/tracking.js`) — the
exact data the Tracking Inspector panel consumes. Run it against the **rendered, decorated preview**
of the page (the panel loads a hidden probe at `?tracking-editor=1&martech=off`; headless, load the
authenticated `…--intuit-erp--aemsites.aem.page` / `.preview.da.live` preview and call the helper).

Each entry describes one target:

| Field | Meaning |
| --- | --- |
| `id` | the CTA's stable `data-track-id` — the sheet key |
| `path` | normalized page path for this render |
| `label` / `href` / `tag` / `block` | what/where the CTA is (for you to recognize it) |
| `editable` | `true` only when the target has an id and is not an `alsoTrack` part |
| `automatic` | the payload **code derives** (what fires with no sheet row) |
| `override` | the current `/tracking.json` row for this id, if any |
| `effective` | derive **+** override — what fires today |

Only author rows for **`editable`** targets. `alsoTrack` parts (card thumbnails/slots) and id-less
controls are pure-derive and take no sheet row. Compare `automatic` to what the CTA should send;
author only the differing fields.

## What you can override

The sheet's editable columns are exactly the panel's `OVERRIDE_FIELDS`
(`tools/plugins/tracking/model.js`). Most are derived — author only what's marketing/analytics-semantic
and has no DOM signal.

| Column | Author it when… | Usually |
| --- | --- | --- |
| `wa-link` | there's a **marketing campaign code** (e.g. `ies-nav:capabilities`) | **authored** — the main reason a row exists |
| `object-detail` | a **semantic taxonomy detail** is needed (e.g. `nav\|capabilities`, `diag\|full`) | authored |
| `action` | intent ≠ the derived `interacted`/`engaged` (e.g. `started`, `submitted`) | authored when intent differs |
| `custom-properties` | arbitrary `key=value` props, or an authored **`link_name`** override | authored as needed |
| `survey` | survey metadata `key=value` pairs | authored as needed |
| `ui-object` | the semantic `ui_object` differs from the tag-derived `link`/`button`/`link_icon`/`video_link` | rarely |
| `ui-object-detail` | the detail must differ from the derived accessible name | rarely |
| `ui-action` | the interaction verb ≠ default `clicked` | rarely |
| `object` | the object ≠ derived `content`/`video` | rarely |

**Not authorable here:** `ui-access-point` is **presence-gated and runtime-managed** — the panel
deliberately omits it, and so must you. The runtime computes the access-point trail from ancestor
`data-tracking` segments; an authored value does not replace it. (`link_name` is derived by default
and rides inside `custom-properties`; override it there, e.g. `custom-properties: link_name=…`.)

## Page-scoped vs global

Each row is keyed by **`path` + `id`**:

- a **path** (e.g. `/accounting/multi-entity`) scopes the override to that page's render;
- **`*`** (or blank) is **site-wide chrome** — nav, footer, floating widgets that render on every page.

A page-scoped row **wins** over a global row with the same `id`. Put footer/nav residue on `*`; put
body-CTA residue on the specific path.

## Validation

Mirror `validateOverride` (`tools/plugins/tracking/model.js`) before writing:

- **`custom-properties`** — one `key=value` per line (newline- or semicolon-separated). Neither key
  nor value may contain **`|`** or **`,`** (they are the tracker's own delimiters — such a pair is
  silently dropped). Every pair needs a non-empty key **and** value.
- **`survey`** — one `key=value` per line; each pair needs a non-empty key and value.

Reject the edit and ask the author to fix it rather than writing a value that will be dropped at runtime.

## Reading and writing the sheet

Work against the **DA source** for `/tracking.json`, then preview, then (only on explicit
confirmation) publish. This is the panel's lifecycle — reuse it exactly (`tools/plugins/tracking/api.js`,
`tools/plugins/tracking/delivery.js`). Use the DA content MCP if it exposes sheet read/write; otherwise
the DA Admin + AEM Admin APIs below (the authenticated `daFetch` the panel uses):

| Step | Call |
| --- | --- |
| **Read** (+ETag) | `GET https://admin.da.live/source/<org>/<repo>/tracking.json` (`cache: no-store`); capture the `ETag` (strip a `W/` prefix) |
| **Write** | `POST` the same URL with `If-Match: <etag>`; body = multipart form-data field **`data`** = a JSON `Blob` of `{ ":type":"sheet", total, data:[…] }`, pretty-printed with a trailing newline |
| **Preview** | `POST https://admin.hlx.page/preview/<org>/<repo>/<ref>/tracking.json` |
| **Publish** | `POST https://admin.hlx.page/live/<org>/<repo>/<ref>/tracking.json` |

`<org>/<repo>` = `aemsites/intuit-erp`; `<ref>` = `main`, or the branch label on a `*.preview.da.live`
host (`resolveTrackingRef`). The ETag precondition is mandatory — it stops an interleaved whole-sheet
write from being clobbered.

**Editing rules** (from `tools/plugins/tracking/model.js`):

- **Preserve every unrelated row and column.** `applyOverride` finds the row by `path` + `id`, updates
  only the given fields, and **removes a field when its value is blank**. A row left with no residue
  (only `path`/`id`) is **deleted** — that is how you clear an override.
- **Save → preview lifecycle** (`saveAndPreviewOverride`): re-read the latest sheet+ETag, run
  `mergeOverride` to detect a **same-field concurrent edit** (someone changed the same field since you
  read it) — if it conflicts, **stop and report**, don't overwrite — else write with `If-Match`,
  re-read, preview, and confirm the revision is unchanged.
- **Publish lifecycle** (`publishReviewedSheet`): re-read and verify the source still matches the
  reviewed revision (ETag + content); if stale, stop; otherwise preview, re-verify, then publish. DA
  versions every write, so a bad publish is recoverable from document history.

If the source write succeeds but the follow-up preview fails, report the **partial success**
explicitly and have the author re-open and save again after resolving it.

## Reference implementation

The pure, unit-tested logic for every operation above lives in the Tracking Inspector plugin — mirror
it when acting by hand:

- `tools/plugins/tracking/model.js` — `OVERRIDE_FIELDS`, `applyOverride`, `validateOverride`,
  `mergeOverride`, `findOverride`, `buildSheetFormData`.
- `tools/plugins/tracking/api.js` — `createTrackingApi` (ETag-safe DA source read/write +
  preview/publish), `resolveTrackingRef`.
- `tools/plugins/tracking/delivery.js` — `saveAndPreviewOverride`, `publishReviewedSheet`.
- `scripts/tracking.js` — `collectTrackingInventory` / `describeTrackingTarget` (target inventory) and
  the derive/resolve helpers.
- `tools/plugins/tracking/README.md` — the panel and its editing/delivery lifecycle.
