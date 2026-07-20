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

## Fidelity notes
- Font "AvenirNext forINTUIT" is a licensed kit — NOT rehosted; Mulish (OFL, self-hosted)
  is the metric substitute, brand family kept first in the stack so a licensed drop-in wins.
- Pages built to solid visual fidelity (breadth-over-pixels per direction); home reached
  ~24.6% full-page pixel diff before that call. Residuals logged in `stardust/replica/progress.json`.
