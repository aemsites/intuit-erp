/**
 * Offer rendering — the shared tail of every personalization flow.
 *
 * The flows (Decision Engine `de/*`, IXP `ixp/*`, template fill) each decide
 * *which* offer applies to a request and hand this module a `PznEntry`. This
 * module resolves the *offer* itself — the actual content to inject.
 *
 * Today offers are authored EDS fragments under `/fragments/pzn/` fetched as
 * `.plain.html` and injected verbatim. If Intuit later sends offers as JSON,
 * render them to fragment markup with json2html
 * (https://www.aem.live/developer/json2html) at the seam marked below. The
 * worker does NO decisioning — it renders what it is given.
 */

/**
 * @typedef {import('./personalize.js').PznEntry} PznEntry
 */

/**
 * An inlined offer: its markup plus the response headers it came with (used to
 * propagate cache keys onto the composed page).
 * @typedef {Object} OfferResult
 * @property {string} markup
 * @property {Headers} headers
 */

/**
 * Escapes a value for safe insertion into HTML (service-supplied values).
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves the offer markup to inject for an entry.
 *
 * Currently: fetch the referenced EDS fragment as `.plain.html` and inject it
 * verbatim. Seam: if the service ever hands us a JSON offer instead of a fragment
 * ref, branch here and render it via json2html before returning the markup.
 *
 * Returns the markup plus the fragment response headers (for cache-key
 * propagation), or null on any failure so the caller passes the page through
 * untouched.
 *
 * Request headers mirror the main origin fetch: the BYO-CDN pair
 * (`x-byo-cdn-type` / `x-push-invalidation`) is sent only when push invalidation
 * is enabled, so the origin emits its surrogate/cache-tag headers only when we
 * actually cache. `accept-encoding: identity` avoids compressed-body edge cases
 * since we read the body as text. The fragment is fetched fresh (`cacheTtl: 0`)
 * so its cache tags are always current.
 * @param {Env} env
 * @param {PznEntry} entry
 * @returns {Promise<OfferResult | null>}
 */
export async function resolveOfferMarkup(env, entry) {
  // --- JSON2HTML seam -----------------------------------------------------
  // if (entry.offer) return renderJsonOffer(entry.offer); // json2html → markup
  // ------------------------------------------------------------------------

  if (!entry.fragment) return null;
  const base = entry.fragment.replace(/(\.plain)?\.html$/i, '');
  const fragmentUrl = new URL(`${base}.plain.html`, env.ORIGIN_BASE_URL).toString();

  const headers = {
    'accept-encoding': 'identity',
  };
  if (env.PUSH_INVALIDATION !== 'disabled') {
    headers['x-byo-cdn-type'] = 'cloudflare';
    headers['x-push-invalidation'] = 'enabled';
  }

  try {
    const res = await fetch(fragmentUrl, {
      headers,
      cf: { cacheEverything: false, cacheTtl: 0 },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('text/html')) return null;
    // JSON2HTML seam: if offers ever arrive as JSON, render them to markup here.
    return { markup: await res.text(), headers: res.headers };
  } catch {
    return null;
  }
}
