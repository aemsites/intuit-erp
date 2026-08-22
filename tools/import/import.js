/*
 * import.js — adapter for the AEM/helix Import UI (`aem import`,
 * https://github.com/adobe/helix-importer-ui). Reuses the same extraction core
 * as the CLI so both paths produce identical DA markup.
 *
 * IMPORTANT — Akamai: erp.intuit.com blocks the Import UI's own fetch/proxy and
 * hard rate-limits it, so importing live URLs through the UI usually fails. The
 * reliable runner is the CLI (tools/import/blog-import.mjs), which fetches with
 * curl + retry backoff. To use the Import UI anyway, serve the pre-downloaded
 * SSR HTML locally and point the UI at that (download-then-import); the CLI's
 * --cache dir can seed those files.
 *
 * Scope: blog ARTICLES only. Non-article templates return no output.
 */
// eslint-disable-next-line import/extensions -- Node ESM requires the real .mjs extension
import { extractPageFromDoc } from './extract.mjs';
// eslint-disable-next-line import/extensions -- Node ESM requires the real .mjs extension
import { renderMainInner } from './render-da.mjs';

export default {
  /**
   * @param {{ document: Document, url: string }} ctx
   * @returns {HTMLElement} a <main> element of canonical DA blocks
   */
  transformDOM: ({ document, url }) => {
    const page = extractPageFromDoc(document, url);
    const main = document.createElement('main');
    main.innerHTML = renderMainInner(page);
    if (page.warnings && page.warnings.length) {
      // eslint-disable-next-line no-console
      page.warnings.forEach((w) => console.warn(`[blog-import] ${url}: ${w}`));
    }
    return main;
  },

  /**
   * Output path in DA — mirrors the source /blog/... slug exactly.
   * @param {{ url: string }} ctx
   * @returns {string}
   */
  generateDocumentPath: ({ url }) => new URL(url).pathname.replace(/\/+$/, ''),
};
