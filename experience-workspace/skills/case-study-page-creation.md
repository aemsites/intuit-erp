---
name: case-study-page-creation
description: Create a new case study page from a customer brief, following the Intuit Enterprise Suite site's case-study template (header, results-at-a-glance, body sections with real quotes, download/CTA bands, recommended cards), then preview it.
version: 1
status: approved
---

# Case Study Page Creation

Create a new case study page under `/case-studies/` from a customer brief. Publishing it is the only step required to make it appear on the `/case-studies` index — the listing is query-index-driven, not hand-maintained.

---

## Step 1 — Collect the brief

Ask the user for the brief. Extract the following automatically if pasted in full, or prompt for anything missing:

- **Company** — name, industry/segment, one-line description of what they do
- **The people** — name + title of each person quoted (real names only — never invent a spokesperson)
- **Results at a glance** — 3 headline numbers, each with a short plain-English description (e.g. "20 hrs — saved per month on manual bank reconciliation")
- **Narrative sections** — the story in order: who they are → the problem with their old setup → why they chose Intuit Enterprise Suite / what they implemented → the results → what's next. 4–6 sections is typical.
- **Pull quotes** — 1–2 direct quotes, verbatim, with attribution (name, title, company)
- **Byline + date** — author name, publish date
- **Images** — a lead photo (person or site photo) and the company logo. If the brief doesn't include usable image files, note that a suitable existing asset or a new upload will be needed (Step 3).

If the user names a real, not-yet-migrated case study from erp.intuit.com/blog/case-study/ instead of writing a brief from scratch, fetch that page and extract the same fields from the real content — never fabricate numbers, quotes, or attributions. This site's case studies are always grounded in real source material.

---

## Step 2 — Plan (concise)

Present a short content plan and wait for user confirmation before creating anything. Keep it scannable.

Include:

1. **Path** — `case-studies/<kebab-case-slug>` (from the company name)
2. **Metadata** — Title, Description, Date, Template (`Case Study`)
3. **Section outline** — table: section | block used | one-line note
   - header → `case-study-header` → eyebrow/h1/byline + lead photo
   - stats → `stat-band` (`glance` variant) → 3 results-at-a-glance sentences
   - body → plain `h2` + `p` + `blockquote` → narrative sections in order
   - promo → `media-text` (default) → reusable "Unlock growth for your complex business" insert (optional, can be dropped if the story doesn't need a mid-article breather)
   - video → `testimonial` (`video` variant) → reuse the existing Rhodes Companies customer story
   - related → `resource-cards`... — wait, use `case-study-cards` (`recommended` variant) → 3 related case studies
   - closing → `cta-band` → schedule-a-call CTA
4. **Images** — which existing DA media asset(s) will be used, or what needs to be uploaded first

End with:
> **Ready to generate?** Reply "proceed" to create the page, or give feedback to revise first.

---

## Step 3 — Generate the page

Use `da_create_source` (org `keepthebyte`, repo `aem-intuit-erp`, path `case-studies/<slug>.html`) with valid EDS HTML. Rules:

- Start with `<body>`, end with `</body>`; wrap content in `<main>…</main>` with `<header></header>` before it and `<footer></footer>` after
- No `<!DOCTYPE>`, `<html>`, `<head>`, inline styles, or literal `<table>` for blocks

### Images — the #1 way this breaks

**Every image `src` must be an absolute URL** — either an already-uploaded DA asset (`https://content.da.live/keepthebyte/aem-intuit-erp/media/<file>`) or a fully-qualified external URL (e.g. hotlinking the real photo from the source erp.intuit.com article, which this site already does elsewhere). **A root-relative path like `/media/<file>.png` silently breaks**: DA's content pipeline can't resolve it and stores `src="about:error"` instead — the image will look fine in your authored HTML but render broken everywhere.

Before writing the page, check whether the image you want is already uploaded:
```
da_list_sources(org: "keepthebyte", repo: "aem-intuit-erp", path: "media")
```
If it's not there, either use `da_upload_media` to add it, or hotlink the real image directly from the source article (confirm the URL actually loads first).

**Header media row cell order matters**: put the lead **photo first, logo second** (or logo omitted). The Helix pipeline derives the page's `og:image` from the first image on the page, and the `case-study-cards` index block uses that as the card thumbnail — a logo-first page gets a logo for a thumbnail, which looks wrong on the index grid.

### Utility headings — h2 vs h3

The page has an auto-generated table of contents built from every `<h2>` in the page. Only the **real narrative sections** should be `<h2>` — utility sections that aren't part of the story ("Hear from our customers", "Recommended for you") must be **`<h3>`**, or they'll incorrectly show up as numbered ToC entries. (A `class` on the heading won't reliably survive DA's content roundtrip — heading level is the only durable signal, so don't rely on a CSS class to exclude something from the ToC.)

### Page skeleton

```html
<body>
  <header></header>
  <main>
    <div>
      <div class="metadata">
        <div><div>Title</div><div>…</div></div>
        <div><div>Description</div><div>…</div></div>
        <div><div>Date</div><div>Month DD, YYYY</div></div>
        <div><div>Template</div><div>Case Study</div></div>
      </div>
    </div>

    <div>
      <div class="case-study-header">
        <div><div><p>Case study</p></div></div>
        <div><div><h1>…</h1></div></div>
        <div><div><p>By {author} &middot; Published {date}</p></div></div>
        <div>
          <div><img src="{lead photo — absolute URL}" alt="…"></div>
          <div><img src="{company logo — content.da.live URL}" alt="{Company}"></div>
        </div>
      </div>
    </div>

    <div>
      <h3>Results at a glance</h3>
      <div class="stat-band glance">
        <div><div>{number}</div><div>{plain-English result}</div></div>
        <div><div>{number}</div><div>{plain-English result}</div></div>
        <div><div>{number}</div><div>{plain-English result}</div></div>
      </div>
    </div>

    <!-- repeat for each narrative section, in order -->
    <div>
      <h2>{section heading}</h2>
      <p>{narrative paragraph(s)}</p>
      <blockquote>
        <p>{verbatim quote}</p>
        <cite>{Name, Title, Company}</cite>
      </blockquote>
    </div>

    <div>
      <h3>Hear from our customers</h3>
      <div class="testimonial video">
        <div>
          <div><img src="https://erp.intuit.com/oidam/intuit/erp/en_us/web/motion-and-video/caleb-mcdaniels-photo-ies-us-en-2x.jpg" alt="Rhodes Companies customer story"></div>
          <div>PROFESSIONAL SERVICES</div>
          <div>Unified 9 entities and cut accounting time by 50%*</div>
          <div>Caleb McDaniels, CFO Rhodes Companies <a href="https://erp.intuit.com/blog/case-study/rhodes-companies-intuit-enterprise-suite/">See their story</a></div>
        </div>
      </div>
    </div>

    <div>
      <h3>Recommended for you</h3>
      <div class="case-study-cards recommended"></div>
    </div>

    <div>
      <div class="cta-band">
        <div>
          <div>{number}</div>
          <div>{short caption}</div>
          <div>READY TO MODERNIZE?</div>
          <div>See what Intuit Enterprise Suite can do for your firm</div>
          <div>Join {Company} and hundreds of other businesses scaling with a connected, AI-powered ERP.</div>
          <div><p><strong><a href="#schedule">Schedule a call</a></strong></p></div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
```

Share the DA edit link after creating: `https://da.live/edit#/keepthebyte/aem-intuit-erp/case-studies/<slug>`

---

## Step 4 — Preview

Preview requires an authenticated DA session, which the author already has in Experience Workspace — hit **Preview** in the DA sidekick (an automated call from outside that session will get a 401). Once previewed, share the URL:

`https://main--aem-intuit-erp--keepthebyte.aem.page/case-studies/<slug>`

Publishing (also via the sidekick) is what makes the page appear on `/case-studies` and in `/case-studies/query-index.json` — that's the whole point of the query-index setup, so call this out to the author rather than treating the page as "done" once merely previewed.

---

## Step 5 — Fidelity check

Report as a checklist. This project's case studies are held to a real-source-only standard — this step exists to catch fabrication and the two structural bugs above, not brand tone (there's no governance agent on this project).

```
:::checklist
- [x] **Every quote and number traces to the brief or the real source article** — no invented spokespeople, stats, or attributions.
- [x] **Every image `src` is an absolute URL** — content.da.live or a verified external URL, no `/media/...` root-relative paths.
- [x] **Lead photo is the first image in the header media row**, logo second (or omitted).
- [x] **Only real narrative sections are `<h2>`** — utility headings ("Hear from our customers", "Recommended for you") are `<h3>`.
- [x] **Metadata block has Title, Description, Date, and `Template: Case Study`**.
:::
```

If anything fails, fix it with `da_update_source` and re-check.

---

## Step 6 — Final summary

```
:::checklist
- [x] Page created at case-studies/<slug>
- [x] Edit at https://da.live/edit#/keepthebyte/aem-intuit-erp/case-studies/<slug>
- [x] Previewed at https://main--aem-intuit-erp--keepthebyte.aem.page/case-studies/<slug>
- [x] Fidelity check — all checks passed
:::
```

Flag remaining manual actions:
```
:::alert-warning
Publish the page in the DA sidekick to make it appear on /case-studies and in the query-index.
:::
```
