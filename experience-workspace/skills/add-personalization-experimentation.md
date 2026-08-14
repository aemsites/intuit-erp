---
name: add-personalization-experimentation
description: Tag a page, section, or block for Personalization (pzn) or Experimentation (exp) by writing the right rows into the DA source — page-level experiment metadata, or Section Metadata keys that the aem.live pipeline turns into data-pzn / data-exp attributes on the section. Also records up to 5 content variants (fragments) so authors can preview each option on the page. Use when a marketer, author, or agent wants to mark an area of a page as personalized or experiment-targeted, without the DA panel — and whenever you have the variant fragments from the offer engine, write them too.
version: 2
status: approved
---

# Add Personalization / Experimentation Tags

Mark an area of a page as a target for **Personalization (`pzn`)** or **Experimentation (`exp`)**, and
record up to **5 variants** for it. This is the same contract the DA "Personalization" panel
(`tools/plugins/personalization/`) writes — follow it exactly so panel-authored and agent-authored tags
stay interchangeable.

## Workflow context

A marketer sets up the experiment or personalization campaign in the **offer engine** (typically via its
MCP), which owns both the id and the list of content variants. They then tag the EDS content — through the
DA MCP or this skill — so the page carries that id. **The offer engine that gives you the id also gives you
the variants: whenever they are available at tag time, write them alongside the id, not just the id by
itself.** Recording the variants is what lets us render a previewed version of the page with each option
swapped in, so authors can see every arm before publishing. Omitting them still produces a valid live tag,
but authors lose that preview — so treat the variants as expected input, not an afterthought.

## The model in one paragraph

Everything is stored in **metadata blocks** so the aem.live **pipeline** emits it as `data-*` attributes on
the section, with the value preserved **verbatim** (camelCase survives). Section/block tags live in the
**Section Metadata** block; page-level experiments live in the page **Metadata** block. There are no CSS
classes and no `Style` tokens involved.

## Where the id and variants come from — the offer engine

The id is an identifier you pull from the upstream **offer engine** that owns each mode — do not invent one,
and do not transform it (keep its exact casing, e.g. camelCase):

- **`exp` (Experimentation)** → the **experiment id** from the **experimentation source**.
- **`pzn` (Personalization)** → the **placement id** from the **personalization source**.

The same offer-engine campaign also defines the **content variants** (the arms/options). When your context
already has them — e.g. the marketer configured them in the offer engine and you can read them over MCP —
capture them into the `*-variants` rows in the same write. Pull the id and the variants together; don't
write a bare id when the variants are within reach.

## Placement → what to write

| Placement | Experimentation (`exp`) | Personalization (`pzn`) |
|-----------|-------------------------|-------------------------|
| **Page**    | `experiment-id` (+ optional `experiment-label`, `experiment-variants`) rows in the page **Metadata** block | — (not supported) |
| **Section** | `exp` row in the section's **Section Metadata** | `pzn` row in the Section Metadata |
| **Block**   | `exp` + `exp-block` rows in the section's Section Metadata | `pzn` + `pzn-block` rows |

Each Section Metadata key becomes a `data-<key>` attribute on the section via the pipeline:

| Section Metadata key | Value | Resulting DOM attribute |
|----------------------|-------|--------------------------|
| `pzn` / `exp` | the id, verbatim | `data-pzn` / `data-exp` |
| `pzn-block` / `exp-block` | a block name (the block's `data-block-name`) — **only for block scope** | `data-pzn-block` / `data-exp-block` |
| `pzn-variants` / `exp-variants` | up to 5 `/fragments/pzn/…` paths, comma-separated | `data-pzn-variants` / `data-exp-variants` |

**Section vs block scope:** a section carries the tag. Add the `*-block` row (value = the target block's
name) to scope the tag to that one block; omit it to target the whole section. **One tag per mode per
section** — `pzn` and `exp` may coexist on one section, but a given mode targets either the whole section or
a single block, not several. If two blocks in the section share a name, the **first** match wins.

## Variants

Variants are stored **for preview** — so a preview experience can render the page with each experiment/pzn
option swapped in and let an author flip through the arms before publishing. They come from the offer-engine
campaign; write them whenever they are available at tag time (see Workflow context). Variants only feed
preview — they don't decide what live visitors see (the offer engine does that at runtime) — so a missing
variants row never breaks the live experience, it only costs the author the preview.

Up to **5** per tag, stored as one comma-separated cell (splits on comma or newline; reduce full
`aem.page`/`hlx.page` URLs to a pathname):

- **Block/section (`pzn`/`exp`)** → **fragment** paths under `/fragments/pzn/…`.
- **Page-level experimentation** → **fragment** paths under `/fragments/experiments/…` (the whole-page
  variant authored as a fragment). Both are picked from the same DA fragment picker.

Write variant references as **plain text** (not DA links) so the pipeline's data-attribute value stays clean
and body `/fragments/` autoblocking is never triggered.

## Markup — canonical div-class form

All authored as nested `<div>`s (never literal `<table>`), inside `<main>`.

### Section-level personalization

```html
<div>
  <div class="cards">
    <div><div>…</div></div>
  </div>
  <div class="section-metadata">
    <div><div>pzn</div><div>sbsegQbmRetail</div></div>
    <div><div>pzn-variants</div><div>/fragments/pzn/retail, /fragments/pzn/default</div></div>
  </div>
</div>
```
→ `<div data-pzn="sbsegQbmRetail" data-pzn-variants="/fragments/pzn/retail, /fragments/pzn/default" class="section cards-container">`

### Block-level (scope to one block in the section)

```html
<div class="section-metadata">
  <div><div>exp</div><div>385944</div></div>
  <div><div>exp-block</div><div>cards</div></div>
</div>
```
→ `data-exp="385944" data-exp-block="cards"` on the section. Runtime applies the tag to the block whose
`data-block-name` is `cards`.

### Page-level experimentation → Metadata block

```html
<div>
  <div class="metadata">
    <div><div>Title</div><div>My Page</div></div>
    <div><div>experiment-id</div><div>385944</div></div>
    <div><div>experiment-label</div><div>Homepage hero test</div></div>
    <div><div>experiment-variants</div><div>/fragments/experiments/variant-a, /fragments/experiments/variant-b</div></div>
  </div>
</div>
```
`experiment-id` is the experiment id (verbatim). `experiment-label` and `experiment-variants` are optional.
If the page has no `metadata` block, create one as the last section of `<main>`; keep existing rows intact.

## Reading and writing the page source

Work against the **DA source** (stored authoring HTML), not the rendered page.

- With the DA content MCP tools: `content_read` to fetch, `content_create` (or equivalent) to write back at
  the same path.
- With the DA Admin Source API (what the panel does): `GET https://admin.da.live/source/<org>/<repo>/<path>.html`
  (Bearer token) to read; `PUT` the full modified HTML back to the same URL as multipart form-data field
  `data` (a `text/html` Blob).

Steps: read source → locate the target section (sections are the direct `<div>` children of `<main>`; a
block is a child `<div>` whose first class is the block name; ignore `section-metadata`/`metadata` blocks;
default content is not a block) → add/update the rows per the tables above → write the whole document back.
A save can conflict with a concurrently open live DA edit.

## Clearing a tag

- **Section/block**: remove the `pzn`/`exp` row and its `*-block` / `*-variants` rows; drop the
  `section-metadata` block if no rows remain.
- **Page**: remove `experiment-id` / `experiment-label` / `experiment-variants`; drop the `metadata` block
  (and its now-empty wrapping section) only if no other rows remain.

## Reference implementation

The pure, unit-tested logic for every operation above lives in
`tools/plugins/personalization/experience.js` (`parseExperience`, `setSectionTag`, `clearSectionTag`,
`setPageExperiment`, `clearPageExperiment`, plus `splitList` / `joinList` / `toPath`). Mirror its behavior
when applying tags by hand.
