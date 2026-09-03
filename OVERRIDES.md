# OVERRIDES.md

Every place site behavior can be toggled or configured **without a code change** — via page/section
metadata (per-page or in bulk via the root metadata sheet), authored DOM attributes, URL query
parameters, or cookies. Authors control the metadata/attributes; developers and QA use the URL params.

Related docs: [MARTECH.md](MARTECH.md) (analytics/consent loading), [CLICK-TRACKING.md](CLICK-TRACKING.md)
(the `data-track-*` attribute contract), [APPVARS.md](APPVARS.md) (`window.appVars` for the tracker).

> **Source of truth is the code.** File links below point at the readers. Values shown as
> `true`/`yes` are matched case-insensitively after trimming.
>
> **Metadata key naming.** Authored keys are case-insensitive and space/hyphen-equivalent — the
> pipeline lowercases the key and replaces spaces with hyphens to form the `<meta name>`. So
> `Events Bar`, `events bar`, and `events-bar` all produce `<meta name="events-bar">`. Both forms
> appear in current content; they behave identically.

---

## Page metadata

Set in a page's **Metadata** table (authored as `key | value` rows, emitted as `<meta name="key">`),
or in bulk via the [metadata sheet](#bulk-metadata-metadatajson) (see below). The keys below are the
ones this site's code actually reads.

### Layout & page chrome

| Metadata | Controls | Values / default | Source |
| --- | --- | --- | --- |
| `template` | Adds template class(es) to `<body>`; drives blog/guide autoblocking & theming | values in use: `Blog Article`, `Category`, `Case Study`, `Guide`, `Research`, `Author`, `Blog Home`, `block-library` (each `toClassName`-d, e.g. `blog-article`); mostly set in bulk via the metadata sheet, not per page | [scripts/aem.js](scripts/aem.js), [blocks/blog-template/blog-detect.js](blocks/blog-template/blog-detect.js), [blocks/guide-hero/guide-detect.js](blocks/guide-hero/guide-detect.js) |
| `theme` | Adds theme class(es) to `<body>` | any string (comma-separated) | [scripts/aem.js](scripts/aem.js) |
| `hide-header` | Removes the global header (gated conversion/landing pages) | `true` / `yes` / `hide` | [scripts/scripts.js](scripts/scripts.js) |
| `hide-footer` | Removes the global footer | `true` / `yes` / `hide` | [scripts/scripts.js](scripts/scripts.js) |
| `hide-contact-widget` | Skips the persistent bottom-right "Contact us" sales widget | `true` / `yes` / `hide` | [scripts/scripts.js](scripts/scripts.js) |
| `nav` | Path to the nav fragment | path (default `/nav`) | [blocks/header/header.js](blocks/header/header.js) |
| `footer` | Path to the footer fragment | path (default `/footer`) | [blocks/footer/footer.js](blocks/footer/footer.js) |

### Events bar (top banner)

| Metadata | Controls | Values / default | Source |
| --- | --- | --- | --- |
| `events-bar` | Enables the top events bar (also adds body class `has-events-bar`) | `true` / `yes` | [blocks/header/header.js](blocks/header/header.js) |
| `events-bar-text` | Bar lead text | string (default `Check out`) | [blocks/header/header.js](blocks/header/header.js) |
| `events-bar-link` | Bar link href | path (default `/events`) | [blocks/header/header.js](blocks/header/header.js) |
| `events-bar-cta` | Bar CTA text | string (default `upcoming events and Intuit Enterprise Suite updates`) | [blocks/header/header.js](blocks/header/header.js) |
| `events-bar-variant` | Styling-variant modifier | string (lower-cased) | [blocks/header/header.js](blocks/header/header.js) |
| `events-bar-highlight` | Highlighted fragment of the bar text | string | [blocks/header/header.js](blocks/header/header.js) |

### Personalization & experimentation (server-driven orchestrator)

| Metadata | Controls | Values / default | Source |
| --- | --- | --- | --- |
| `experiment-id` | Page-level IXP experiment (whole-page swap). **Wins over `personalization-id`** on the same target | digits only (`/^\d+$/`); non-numeric ignored | [scripts/experience.js](scripts/experience.js) |
| `personalization-id` | Page-level personalization access-point name (whole-page swap) | any string | [scripts/experience.js](scripts/experience.js) |
| `experience-api-base` | Overrides the decision-API base URL for local/QA | URL/path (default `/api`; trailing slashes stripped) | [scripts/experience.js](scripts/experience.js) |

> The orchestrator call only fires when the page has at least one experiment id or access-point name
> (page metadata **or** the section tags below). `experiment-id` / `personalization-id` are **not
> currently authored on any page**, so today no orchestrator call is made — these document available
> capability, not live config.

There is also the **aem-experimentation plugin** convention (loaded only when present): `experiment` /
`experiment-*` (e.g. `experiment-variants`), `campaign-*`, `audience-*` metadata, `campaign:` /
`audience:` og-properties, and `instant-experiment`. Present today only on a couple of
`experiments/` pages. See [scripts/experiment-loader.js](scripts/experiment-loader.js).

### Block-specific

| Metadata | Controls | Values / default | Source |
| --- | --- | --- | --- |
| `marketo` | Marketo Munchkin environment | `dev` / `e2e` / anything-else→`prod` | [blocks/form/form.js](blocks/form/form.js) |
| `chat-now` | Wires up LivePerson chat globals (paints only on prod/stage) | `true` / `yes` | [blocks/contact-us/contact-us.js](blocks/contact-us/contact-us.js) |
| `schedule-fragment` | Fragment path for the "schedule a demo" modal | path (default in [scripts/schedule-modal.js](scripts/schedule-modal.js)) | [scripts/schedule-modal.js](scripts/schedule-modal.js) |
| `tracking` | Click-tracking access-point segment stamped on `<main>` as `data-tracking` | string | [scripts/tracking.js](scripts/tracking.js) — see [CLICK-TRACKING.md](CLICK-TRACKING.md) |

### Blog article metadata

Read by the blog autoblock in [blocks/blog-template/blog-template.js](blocks/blog-template/blog-template.js):

- `author`, `category`, `tags`, `date`, `updated` — byline / eyebrow.
- `hide-rails` — suppress the article side rails. `true`/`yes`/`hide`/`all` drops **both** the TOC and the right rail and lets the body flow full-width; `right` drops **only** the right rail and keeps the TOC (matches the upstream research layout). Absent/other → both rails as normal.
- `right-rail` — right-rail fragment (bare name resolves under `/fragments/`; default `/fragments/right-rail`).
- `hear-from-our-customers` — trailing customers band fragment (default `/fragments/hear-from-our-customers`).
- `pricing-disclaimer` — trailing pricing-disclaimer fragment (default `/fragments/pricing-disclaimer`).

---

## Bulk metadata (`metadata.json`)

Metadata can be applied **in bulk** — to a whole section of the site or to every page — via the
metadata sheet at the site root, `content/metadata.json` (authored as a spreadsheet in DA; `content/`
is gitignored and deploys via `aem content push`, so it is not on GitHub). Each row has a **`URL`**
glob plus one column per metadata
field; a page inherits the fields of **every** row whose glob matches, with more-specific globs
overriding broader ones. `**` targets the entire site. This is how blog pages get their template,
category, footer, and right-rail with no per-page metadata at all. These fields resolve to the same
`<meta>` names the readers above consume.

Columns currently in the sheet and the rules in place today:

| Column | Effect | Current rules |
| --- | --- | --- |
| `locale` | Page locale (`<html lang>` / `og:locale`) | `/en/**` → `en-US`, `/in/**` → `en-GB` |
| `robots` | Search-engine indexing | `noindex,nofollow` for `/events/**`, `/webinar-*`(`/**`), `/accountant/free-consultation/ies`(`/**`), `/oa`, `/ibs`, `/drafts/**` |
| `twitter:site` / `twitter:creator` | Social card meta | site-wide (`**`): `https://www.intuit.com/` / `@intuit` |
| `footer` | Footer fragment (same as the `footer` page metadata) | `/blog` and `/blog/**` → `/footer-blog` |
| `hide-contact-widget` | Skips the contact-us widget (same as the `hide-contact-widget` page metadata) | `true` for `/webinar-*`(`/**`); also needed on `/contact` and `/library/templates/contact` (previously hardcoded in code) |
| `Template` | Template (same as the `template` page metadata) | `/blog/**` → `Blog Article`; `/blog/case-study/**` → `Case Study`; `/blog/guide/**` → `Guide`; `/blog/research/**` → `Research`; `/blog/author/**` → `Author` |
| `Category` | Blog category (byline/eyebrow + query filtering) | per `/blog/<category>/**` (e.g. `financials`, `erp`, `construction`, `payroll`, …) |
| `right-rail` | Right-rail fragment (same as the `right-rail` page metadata) | per blog category → `/fragments/right-rail/<id>` |

> A per-page **Metadata** block overrides the sheet for that page. To change behavior for a whole
> path prefix (e.g. all `/blog/**`), edit the sheet instead of touching each page.

---

## Section metadata

Authored in a **Section Metadata** block (`key | value` rows scoped to one section). The pipeline
converts it to the section `<div>`: the **`Style`** key becomes space-separated CSS **classes** on the
section, and **every other key** becomes a `data-<key>` attribute the client code reads.

| Authored key | Becomes | Controls |
| --- | --- | --- |
| `Style` | class(es) on the section | Section styling. Value is a comma-separated list of class names — **currently used across the site** (73×). Vocabulary in use: `narrow`, `center`, `contained`, `left`/`right`, `navy`, `sky`, `super-blue`, `blue-divider`, `teal-band`, `light`, `two-col`, `media-lead`, `feature-cards`, `product-cards`, `hear-customers`, and spacing `spacer-top-*` / `spacer-bottom-*` / `padding-bottom-*` (`l`/`xl`/`xxl`). Classes are defined in [styles/](styles/) and block CSS |
| `Background` | `data-background` | Section background — **currently used** (values are hex colors, a `conic-gradient(...)`, `white`, or `none`). An image URL → optimized `background-image`; otherwise a CSS color/gradient plus `colored-background` and `dark-background`/`light-background` classes. Read by [scripts/scripts.js](scripts/scripts.js) |
| `Exp` | `data-exp` | Section-scoped experiment id (numeric); section-level content swap |
| `Exp Block` | `data-exp-block` | Scopes that experiment to the block whose `data-block-name` matches, instead of the whole section |
| `Pzn` | `data-pzn` | Section-scoped personalization access-point name |
| `Pzn Block` | `data-pzn-block` | Scopes personalization to a named block |
| `Exp Mode` | `data-exp-mode` | `append` = the experiment fragment is **appended** to the slot, not swapped in (additive behavior/code widgets). Any other value / absent = swap (default) |
| `Pzn Mode` | `data-pzn-mode` | `append` = the personalization fragment is **appended** to the slot, not swapped in (additive behavior/code widgets). Any other value / absent = swap (default) |

The `Exp*` / `Pzn*` rows are read by [scripts/experience.js](scripts/experience.js) but are **not
currently present in authored content** — only `Style` and `Background` are used today.

> IXP/experiment wins over personalization when both target the same scope (whole-section, or the same
> named block); scoped to different blocks, both run independently.

---

## Block-level authored attributes (click tracking)

Per-element/per-block overrides for click tracking, authored as `data-track-*` attributes and read by
[scripts/tracking.js](scripts/tracking.js). Full contract in [CLICK-TRACKING.md](CLICK-TRACKING.md):
`data-tracking`, `data-track-no-trail`, `data-track-skip`, `data-track-as`, `data-track-id`,
`data-track-object` / `data-track-action` / `data-track-ui-object`, and `data-track-link-name=off`.

---

## Fragment-rendered content

Not an authored toggle — behavior that follows from **where** content lives. The `fragment` block
marks the detached `<main>` it builds with `data-fragment="true"` while its blocks are decorated
([blocks/fragment/fragment.js](blocks/fragment/fragment.js)); `media-text` reads that ancestor and
gives its CTAs (`.button-wrapper a`) `target="_blank"` + `rel="noopener"`, because fragment content is
shared boilerplate reused across many pages
([blocks/media-text/media-text.js](blocks/media-text/media-text.js)). A `media-text` authored directly
on a page keeps its CTAs in the same tab.

---

## URL parameters

| Param | Controls | Values | Source |
| --- | --- | --- | --- |
| `?martech=` | Martech loading | `off` = disable all martech (Tealium + Adobe inert); `local` = load utag.js + OneTrust from local `/scripts/martech/`; absent/other = CDN default | [scripts/scripts.js](scripts/scripts.js) — see [MARTECH.md](MARTECH.md) |
| `?rum=` (alias `?optel=`) | RUM sampling rate | `on`→1, `off`→0, `high`→10, `low`→1000, else weight 100 | [scripts/aem.js](scripts/aem.js) |
| `?lighthouse=on` | Sets `window.hlx.lighthouse = true` (perf-test mode) | `on` | [scripts/aem.js](scripts/aem.js) |
| `?locale=` | Locale sent to the decision API | locale string, hyphen converted to underscore (falls back to `navigator.language` → `en_US`) | [scripts/experience.js](scripts/experience.js) |
| `?preview=true` | Routes the `/intuit-orchestrator` decision call to the preview backend (Akamai keys off the param); only `preview` + `previewContext` are forwarded, and both are stripped from `context.permalink` | `true` | [scripts/experience.js](scripts/experience.js) |
| `?previewContext=` | Context JSON forwarded to the preview backend alongside `?preview=true` (ignored without it) | URL-encoded context JSON | [scripts/experience.js](scripts/experience.js) |
| `?search-term=` | Seeds/reads the blog search query | string | [blocks/blog-search/search-utils.js](blocks/blog-search/search-utils.js) |
| `?q=` (only on `/construction`) | Rewritten into the `llm_app_ctx` param, then redirects | string | [scripts/scripts.js](scripts/scripts.js) |
| widget href params | Any `key=value` on a widget's authored link is copied onto the widget as `data-<key>` (config into the widget) | author-defined | [blocks/widget/widget.js](blocks/widget/widget.js) |

### Attribution / intent capture (stored, not behavior-toggling)

Parsed from the query string into the persisted intent profile by
[scripts/of1-intent.js](scripts/of1-intent.js): `gclid`, `fbclid`, `msclkid`, `utm_source`,
`utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `llm_app_ctx`.

### aem-experimentation plugin simulation params

Defaults (this project passes no overrides), in [plugins/experimentation/src/index.js](plugins/experimentation/src/index.js):
`?experiment=` / `?experiment-*=` force a variant, `?campaign=` / `?campaign-*=` force a campaign,
`?audience=` forces an audience, and `?utm_campaign=` auto-selects a matching campaign.

---

## Cookies (pair with the above)

| Cookie | Role | Source |
| --- | --- | --- |
| `ivid` | First-party visitor id feeding personalization / Tealium / logging. **Cookie is the only source** — the old `?ivid=` URL override was removed | [scripts/experience.js](scripts/experience.js), [scripts/erp-logging.js](scripts/erp-logging.js), [plugins/tealium-martech/src/index.js](plugins/tealium-martech/src/index.js) |
| `OptanonConsent` | OneTrust consent groups; gates analytics/personalization (pairs with `?martech=local`) | [plugins/tealium-martech/src/index.js](plugins/tealium-martech/src/index.js) |
| `AKES_GEO` | Akamai edge geo signal (only present behind Akamai) | [plugins/tealium-martech/src/index.js](plugins/tealium-martech/src/index.js) |

---

## Not overrides (here to prevent confusion)

- **Standard SEO / social metadata.** `title`, `description`, `image`, `json-ld`, `robots`,
  `twitter:*`, `locale` are authored per page or in the sheet and consumed by the pipeline/head for
  SEO — they don't toggle site behavior, so they're not listed above.

- **Informational-only keys.** `pagetype` (`category` / `hub` / `search`) and `industry` appear in
  authored content but are **not read by any site code** — they carry no behavior.

- **Content identifier.** `window.appVars.externalContentIdentifier` (analytics) and the orchestrator's
  `context.casId` are both the page **pathname** (`window.location.pathname`) — automatically, with **no
  authored metadata**. The orchestrator also gets the **full URL** as `context.permalink`. There is no
  `cas-id` / `page-cas-id` metadata anymore. Set in `loadEager` ([scripts/scripts.js](scripts/scripts.js))
  and `buildContext` ([scripts/experience.js](scripts/experience.js)); see [APPVARS.md](APPVARS.md).

- **Environment cannot be escalated by any param or metadata.** `resolveEnvironment`
  ([plugins/tealium-martech/src/index.js](plugins/tealium-martech/src/index.js)) keys strictly off
  `window.location.hostname`; only `erp.intuit.com` and `stage.erp.intuit.com` resolve to prod, and
  experimentation treats `localhost` / `.page` hosts as preview. `?martech=` and the metadata above
  tune behavior **within** an environment — they never unlock prod integrations off-prod.
