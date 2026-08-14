/**
 * intuit-edge: a thin Cloudflare Worker exposing the client-facing
 * personalization / experiment endpoints under `/api/*`.
 *
 * Architecture: Akamai is the CDN in front of the aem.live site and serves all
 * page and fragment traffic directly; it routes only the `/api/*` paths to this
 * worker. Personalization (Decision Engine) and experimentation (IXP) decisioning
 * happens in the browser (see the site's `scripts/pzn.js` / `scripts/exp.js`);
 * this worker is a thin, authenticated proxy that attaches the secret API keys
 * and calls Intuit's Decision Engine and IXP backends. It does NO decisioning of
 * its own and does NOT proxy or transform page HTML.
 *
 *   POST /api/pzn — batch Decision Engine personalization for a page's slots.
 *   GET  /api/ixp — IXP experiment assignment for a page.
 *
 * Everything else 404s. See `src/api/` for the handlers and `README.md`.
 */

import { handleApi } from './api/router.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return new Response('Not found', { status: 404 });
  },
};
