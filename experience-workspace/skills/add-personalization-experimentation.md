---
name: add-personalization-experimentation
description: Tag a page, section, or block for Personalization (pzn) or Experimentation (exp) by writing the right marker into the DA source — page-level experiment metadata, a Section Metadata Style token, or a block CSS class. Use when an author or agent wants to mark an area of a page as personalized or experiment-targeted, without the DA panel.
version: 1
status: approved
---

# Add Personalization / Experimentation Tags

Mark an area of a page as a target for **Personalization (`pzn`)** or **Experimentation (`exp`)**.
This is the same contract the DA "Personalization" panel (`tools/plugins/personalization/`) writes —
follow it exactly so panel-authored and agent-authored tags stay interchangeable.

There are two modes and three placements. **Personalization is section/block only** — there is no
page-level personalization.

| Placement | Experimentation (`exp`) | Personalization (`pzn`) |
|-----------|-------------------------|-------------------------|
| **Page**    | `experiment-id` (and optional `experiment-label`) rows in the page **Metadata** block | — (not supported) |
| **Section** | an `exp-<id>` token in the section's **Section Metadata** `Style` row | a `pzn-<id>` token in the `Style` row |
| **Block**   | an `exp-<id>` class on the block `<div>` | a `pzn-<id>` class on the block `<div>` |

## Where the `<id>` comes from — two separate source systems

The `<id>` is **not** free-form — it is an identifier you pull from the upstream system that owns each
mode. Get the right value from the source before tagging:

- **`exp-<id>` (Experimentation)** → use the **experiment id** configured in the **experimentation
  source** (the experimentation system where the experiment/test is set up). Tie the tag to that
  experiment by using its id — do not invent one.
- **`pzn-<id>` (Personalization)** → use the **placement id** from the **personalization source** (the
  personalization/decision system that defines the placement). Tag the section/block with the placement
  id that identifies where its personalized content is served — do not invent one.

These are two different systems; the id you enter is only meaningful when it matches the identifier in
that system. For **section and block** tags the id is **slugified** into a valid CSS class token (see
below); the page-level `experiment-id` metadata **value is kept verbatim** (also the experiment id from
the experimentation source).

## The id → token rule (section & block)

Slugify the author's text, then prefix with the mode:

- lowercase everything
- replace every run of non-`[a-z0-9]` characters with a single `-`
- trim leading/trailing `-`
- final token = `exp-<slug>` or `pzn-<slug>`

Examples: experiment id `385944` → `exp-385944`; placement id `SBSEG-QBM-Retail` → `pzn-sbseg-qbm-retail`.
If the slug is empty (input was blank or all symbols), do **not** write a token.

A page may carry both an `exp-` and a `pzn-` tag on the same section/block (one of each mode), but never
two of the same mode — replacing a tag means removing the existing `exp-…` (or `pzn-…`) first.

## Markup — canonical div-class form

All of this is authored as nested `<div>`s (never literal `<table>`), inside `<main>`.

### Page-level experimentation → Metadata block

Add (or update) rows in the page `metadata` block. If the page has no `metadata` block, create one as
the last section of `<main>`. Keep any existing rows (Title, Description, …) intact.

```html
<div>
  <div class="metadata">
    <div><div>Title</div><div>My Page</div></div>
    <div><div>experiment-id</div><div>385944</div></div>
    <div><div>experiment-label</div><div>Homepage hero test</div></div>
  </div>
</div>
```

`experiment-id` is the experiment id from the experimentation source (e.g. `385944`).
`experiment-label` is optional — a human-readable name for that experiment; omit the row when there's none.

### Section-level → Section Metadata `Style` token

Append the token to the section's `section-metadata` `Style` row, preserving any other Style tokens
(e.g. `dark`). Create the `section-metadata` block and/or the `Style` row if absent.

```html
<div>
  <div class="cards">
    <div><div>…</div></div>
  </div>
  <div class="section-metadata">
    <div><div>Style</div><div>dark, exp-385944, pzn-sbseg-qbm-retail</div></div>
  </div>
</div>
```

### Block-level → CSS class on the block

Add the token as an extra class on the block's outer `<div>` (the first class is the block name; tag
tokens are additional classes alongside any variant classes).

```html
<div class="hero exp-385944">
  <div><div>…</div></div>
</div>
```

## Reading and writing the page source

Work against the **DA source** (the stored authoring HTML), not the rendered page.

- **If you have the DA content MCP tools**, use `content_read` to fetch the page HTML and `content_create`
  (or the equivalent write) to store the modified HTML back at the same path.
- **If you're calling the DA Admin Source API directly** (what the panel does):
  - `GET  https://admin.da.live/source/<org>/<repo>/<path>.html` (Bearer token) to read
  - `PUT` the full modified HTML back to the same URL as multipart form-data field `data`
    (a `text/html` Blob)

Steps:

1. Read the current page source.
2. Locate the target — sections are the direct `<div>` children of `<main>`; a block is a child `<div>`
   whose first class is the block name (ignore `section-metadata` and `metadata` blocks; do **not** tag
   default content — headings/paragraphs have no block element to carry a class).
3. Apply the tag per the table above (slugify for section/block; verbatim value for page metadata).
4. Write the **whole** document back. A save can conflict with a concurrently open live DA edit, so
   avoid tagging a page someone is actively editing.

## Clearing a tag

- **Block**: remove the `exp-…` / `pzn-…` class, keeping the block name and any variant classes.
- **Section**: remove the token from the `Style` row; if the row becomes empty, drop it, and if the
  `section-metadata` block then has no rows, drop the block.
- **Page**: remove the `experiment-id` / `experiment-label` rows; if the `metadata` block is then empty,
  drop it (and its now-empty wrapping section).

## Reference implementation

The pure, unit-tested logic for every operation above lives in
`tools/plugins/personalization/experience.js` (`parseExperience`, `setBlockTag`, `setSectionTag`,
`setPageExperiment`, and their `clear*` counterparts, plus `slugify`). Mirror its behavior when applying
tags by hand.
