# OVERRIDES.md

Every place site behavior can be toggled or configured **without a code change** — via page/section
metadata, authored DOM attributes, or URL query parameters. Authors control the metadata/attributes;
developers and QA use the URL params.

Related docs: [MARTECH.md](MARTECH.md) (analytics/consent loading), [CLICK-TRACKING.md](CLICK-TRACKING.md)
(the `data-track-*` attribute contract), [APPVARS.md](APPVARS.md) (`window.appVars` for the tracker).

> **Source of truth is the code.** File links below point at the readers. Values shown as
> `true`/`yes` are matched case-insensitively after trimming.

---

## Page metadata

Set in a page's **Metadata** table (authored as `key | value` rows, emitted as `<meta name="key">`).

### Layout & page chrome

| Metadata | Controls | Values / default | Source |
| --- | --- | --- | --- |
| `template` | Adds template class(es) to `<body>`; drives blog/guide autoblocking & theming | any string (comma-separated → multiple classes); `blog` and `guide` are special | [scripts/aem.js](scripts/aem.js) |
| `theme` | Adds theme class(es) to `<body>` | any string (comma-separated) | [scripts/aem.js](scripts/aem.js) |
| `hide-header` | Removes the global header (gated conversion/landing pages) | `true` / `yes` / `hide` | [scripts/scripts.js](scripts/scripts.js) |
| `hide-footer` | Removes the global footer | `true` / `yes` / `hide` | [scripts/scripts.js](scripts/scripts.js) |
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
> (page metadata **or** the section tags below). With none present, no call is made.

There is also the **aem-experimentation plugin** convention (loaded only when present): `experiment` /
`experiment-*`, `campaign-*`, `audience-*` metadata, `campaign:` / `audience:` og-properties, and
`instant-experiment`. See [scripts/experiment-loader.js](scripts/experiment-loader.js).

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
- `right-rail` — right-rail fragment (bare name resolves under `/fragments/`; default `/fragments/right-rail`).
- `hear-from-our-customers` — trailing customers band fragment (default `/fragments/hear-from-our-customers`).
- `pricing-disclaimer` — trailing pricing-disclaimer fragment (default `/fragments/pricing-disclaimer`).

---

## Section metadata

Authored in a **Section Metadata** block; emitted as `data-*` on the section. Consumed by
[scripts/experience.js](scripts/experience.js) (personalization/experiments) and
[scripts/scripts.js](scripts/scripts.js) (backgrounds).

| Attribute (authored key) | Controls |
| --- | --- |
| `data-exp` | Section-scoped experiment id (numeric); section-level content swap |
| `data-exp-block` | Scopes that experiment to the block whose `data-block-name` matches, instead of the whole section |
| `data-pzn` | Section-scoped personalization access-point name |
| `data-pzn-block` | Scopes personalization to a named block |
| `data-background` | Section background: an image URL → optimized `background-image`; otherwise a CSS color/gradient plus `colored-background` and `dark-background`/`light-background` classes |

> IXP/experiment wins over personalization when both target the same scope (whole-section, or the same
> named block); scoped to different blocks, both run independently.

---

## Block-level authored attributes (click tracking)

Per-element/per-block overrides for click tracking, authored as `data-track-*` attributes and read by
[scripts/tracking.js](scripts/tracking.js). Full contract in [CLICK-TRACKING.md](CLICK-TRACKING.md):
`data-tracking`, `data-track-no-trail`, `data-track-skip`, `data-track-as`, `data-track-id`,
`data-track-object` / `data-track-action` / `data-track-ui-object`, and `data-track-link-name=off`.

---

## URL parameters

| Param | Controls | Values | Source |
| --- | --- | --- | --- |
| `?martech=` | Martech loading | `off` = disable all martech (Tealium + Adobe inert); `local` = load utag.js + OneTrust from local `/scripts/martech/`; absent/other = CDN default | [scripts/scripts.js](scripts/scripts.js) — see [MARTECH.md](MARTECH.md) |
| `?rum=` (alias `?optel=`) | RUM sampling rate | `on`→1, `off`→0, `high`→10, `low`→1000, else weight 100 | [scripts/aem.js](scripts/aem.js) |
| `?lighthouse=on` | Sets `window.hlx.lighthouse = true` (perf-test mode) | `on` | [scripts/aem.js](scripts/aem.js) |
| `?locale=` | Locale sent to the decision API | locale string (falls back to `navigator.language` → `en-US`) | [scripts/experience.js](scripts/experience.js) |
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

## Not overrides (auto-derived — here to prevent confusion)

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
