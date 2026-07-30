# Deploy — Intuit Enterprise Suite replica → AEM Edge Delivery + DA

Same-design migration of key pages from https://erp.intuit.com/ to AEM Edge
Delivery Services, authorable in Experience Workspace (DA).

## What's already done

- **Prototypes** (pixel-faithful, gated): `stardust/prototypes/*-proposed.html`
- **EDS project** (vanilla aem-boilerplate runtime):
  - `styles/styles.css` — brand tokens, button system, section scaffold, self-hosted Mulish
  - `blocks/` — 16 blocks (hero, logo-strip, stat-band, feature-grid, media-text, tabs, comparison-table, icon-columns, testimonial, cta-band, form, faq, disclosure, solution-cards, + header/footer chrome)
  - `content/` — 5 pages + `nav.html` + `footer.html` (DA body fragments)
  - `media/` — 43 images referenced by the pages
- **DA content** — all 7 docs pushed to **`keepthebyte/aem-intuit-erp`**, editable now:
  - Home: https://da.live/edit#/keepthebyte/aem-intuit-erp/index
  - Pricing / Accounting / Compare / ERP-solutions: same pattern
  - Nav + footer fragments: `/nav`, `/footer`

## Remaining steps to make it RENDER live (block code needs Code Sync)

The block CSS/JS + `styles/` + `media/` must be served by AEM Code Sync from a
GitHub repo bound to this DA site. DA content is already in place.

1. **Create the GitHub repo** `keepthebyte/aem-intuit-erp` and push this project:
   ```bash
   git init && git add -A && git commit -m "IES replica EDS site"
   git remote add origin git@github.com:keepthebyte/aem-intuit-erp.git
   git push -u origin main
   ```
   (A `.gitignore` excludes node_modules/, qa/, .env*, stardust/prototypes/shared/media/.)
2. **Install the AEM Code Sync GitHub app** on the repo (https://github.com/apps/aem-code-sync).
3. **Confirm `fstab.yaml`** points the mountpoint at the DA org/site (`keepthebyte/aem-intuit-erp`).
4. **Preview/publish** each page (AEM admin API or the DA sidekick):
   `POST https://admin.hlx.page/preview/keepthebyte/aem-intuit-erp/main/<page>`
5. **Editorial images**: currently referenced root-relative `/media/<file>` (served
   from the code repo). For full author-swappable images, re-host to DA media
   (`da_upload_media` / Source API `/media/`) and switch the content `<img src>` to
   `https://content.da.live/keepthebyte/aem-intuit-erp/media/<file>`.

## Preview URL (after Code Sync)
`https://main--aem-intuit-erp--keepthebyte.aem.page/<page>`

## Events (structured content)

`/events` replaces the external `https://erp.intuit.com/events/` page. The listing
page (`content/events.html`) and the `event-cards` block (`blocks/event-cards/`) are
in this repo already and read from `/events/query-index.json` (see the `events` index
in `helix-query.yaml`), exactly like `case-studies`/`research`. What's different: each
individual event is meant to be authored as a **DA structured-content document**
(https://docs.da.live/developers/guides/structured-content) under `content/events/`
instead of a free-form page — better fit for short, uniform records than long-form copy.

This needs one manual, one-time DA admin step this repo can't do on its own:

1. In the site's DA admin config, add an `editor.path` mapping so `/events` opens in
   the structured-content form editor instead of the plain rich-text editor:
   ```
   key:   editor.path
   value: /aemsites/intuit-erp/events=https://da.live/form#
   ```
   (adjust org/site if the canonical DA org turns out to be `keepthebyte/aem-intuit-erp`
   instead — see the two git remotes note above.)
2. Register an "Event" schema at `https://da.live/apps/schema` with these fields (the
   `helix-query.yaml` selectors and `event-cards` block already expect these exact keys):

   | field         | type   | notes |
   |---------------|--------|-------|
   | `title`       | string | required |
   | `type`        | string | badge shown on the card, e.g. "Live event", "Live webinar", "On-demand webinar", "Demo" |
   | `description` | string | 1–2 sentences |
   | `date`        | string | ISO date preferred (sorts/formats via `formatDate`) |
   | `time`        | string | optional, e.g. "11AM PT \| 2PM ET" |
   | `location`    | string | optional, in-person events only |
   | `speakers`    | string | optional, freeform name(s)/title(s) |
   | `image`       | image  | card image |
   | `ctaLabel`    | string | button text, e.g. "Register", "Watch now" |
   | `ctaUrl`      | string | external registration/video URL |
   | `status`      | string | `upcoming` or `on-demand` — selects which `event-cards` section the card appears in |

3. Author each event under `content/events/<slug>` in the form editor, then Preview +
   Publish — publishing is what populates `/events/query-index.json`.

Until the schema/editor mapping exists, `content/events/*.html` in this repo are plain
DA body-fragment placeholders, hand-authored to match the id-anchored row shape the
`helix-query.yaml` selectors expect (`<div><div id="field"></div><div>value</div></div>`
per field, inferred from the selector pattern in the structured-content docs — not yet
verified against a real form-editor export). They render/index fine as a stopgap;
re-authoring them through the DA form editor once the schema exists is what makes them
author-friendly going forward, and is worth a quick diff against these placeholders to
confirm the row shape matches.

## Adobe Experience Platform (aem-martech)

`plugins/martech` is a vendored, unmodified copy of
[adobe-rnd/aem-martech](https://github.com/adobe-rnd/aem-martech) (Adobe Web SDK /
Alloy + Adobe Client Data Layer), pulled in via `git subtree`. The site already
calls into it — `head.html` preloads `plugins/martech/src/index.js` and
preconnects to `edge.adobedc.net`; `scripts/scripts.js` imports `initMartech`,
`martechEager`, and `martechLazy` and calls them from `loadEager`/`loadLazy` — but
none of it runs by default.

**Activation is a single flag, gated by two constants in `scripts/scripts.js`:**

```js
const AEP_DATASTREAM_ID = 'REPLACE_WITH_DATASTREAM_ID';
const AEP_ORG_ID = 'REPLACE_WITH_ORG_ID@AdobeOrg';
const MARTECH_ENABLED = !AEP_DATASTREAM_ID.startsWith('REPLACE_');
```

As long as `AEP_DATASTREAM_ID` starts with `REPLACE_`, `MARTECH_ENABLED` is
`false` and `initMartech()`/`martechEager()`/`martechLazy()` are never called —
`alloy.min.js` never loads, no request ever reaches `edge.adobedc.net`. Both
call sites are wrapped in try/catch so a bad or placeholder config can't break
page load or block the `appear` reveal. To turn it on:

1. Provision an AEP datastream in the target sandbox and get its
   **datastream id** and the Experience Cloud **org id** (`{org id}@AdobeOrg`).
   The datastream id is not a secret and is safe in client-side source.
2. Replace both constants in `scripts/scripts.js` with the real values.
   `MARTECH_ENABLED` flips to `true` automatically — no other code changes
   needed to get events flowing.
3. `initMartech()` is currently called with `{ personalization: true }` only;
   analytics/data-layer options fall back to the plugin's own defaults (see
   `plugins/martech/README.md` for the full config surface — `launchUrls`,
   `decisionScopes`, etc.) if those need tuning.
4. **Consent**: `updateUserConsent()` (exported by the plugin) is not called
   anywhere in this repo. The SDK defaults to `defaultConsent: 'pending'`, so
   real personalization/analytics calls won't fire until something (a CMP
   integration, or a stopgap default-consent call) invokes it.
5. Debug mode auto-enables on `localhost` and any `.hlx.page`/`.aem.page`
   preview host, so branch previews are safe to test against a real sandbox
   before touching `.aem.live`.

Note: an earlier, unrelated refactor removed `scripts/audience-provider.js` —
a bridge that would have translated AEP personalization propositions into
on-site audience ids for a separate firmographic-personalization system, which
moved to a browser-extension-driven approach instead. That bridge does not
exist today; re-add an equivalent only if a concrete need for
proposition-driven on-site personalization comes up.

## Fidelity notes
- Font "AvenirNext forINTUIT" is a licensed kit — NOT rehosted; Mulish (OFL, self-hosted)
  is the metric substitute, brand family kept first in the stack so a licensed drop-in wins.
- Pages built to solid visual fidelity (breadth-over-pixels per direction); home reached
  ~24.6% full-page pixel diff before that call. Residuals logged in `stardust/replica/progress.json`.
