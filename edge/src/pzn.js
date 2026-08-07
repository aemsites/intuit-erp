/**
 * Offer rendering — the shared tail of every personalization flow.
 *
 * The flows (Decision Engine `de/*`, IXP `ixp/*`, template fill) each decide
 * *which* offer applies to a request and hand this module a `PznEntry`. This
 * module resolves the *offer* itself — the actual content to inject.
 *
 * Today offers are authored EDS fragments under `/fragments/pzn/` fetched as
 * `.plain.html`, with the entry's `data` filled into any `{{token}}`
 * placeholders. If Intuit later sends offers as JSON, render them to fragment
 * markup with json2html (https://www.aem.live/developer/json2html) at the seam
 * marked below. The worker does NO decisioning — it renders what it is given.
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
 * Escapes a value for safe insertion into HTML (offer data is service-supplied).
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

/** A `{{key}}` or `{{key|default}}` placeholder in an offer template. */
const TOKEN_RE = /\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Fills `{{token}}` / `{{token|default}}` placeholders in offer markup from the
 * entry's `data`. A present value wins (HTML-escaped, since it comes from the
 * pzn service); otherwise the author's `|default` is used; otherwise empty.
 *
 * This is the json2html seam in its lightest form: the personalization *data*
 * renders into an authored template. Markup with no tokens is returned unchanged,
 * so existing (token-free) fragments are unaffected.
 * @param {string} markup
 * @param {Record<string, string>} [data]
 * @returns {string}
 */
export function fillTokens(markup, data) {
  return markup.replace(TOKEN_RE, (_full, key, def) => {
    const value = data?.[key];
    if (value !== undefined) return escapeHtml(String(value));
    return def ?? '';
  });
}

/**
 * Resolves the offer markup to inject for a map entry.
 *
 * Currently: fetch the referenced EDS fragment as `.plain.html`, then fill its
 * `{{token}}` placeholders from the entry's `data` (an IXP assignment payload, or
 * a `data` object on a map row). No data / no tokens → the markup is unchanged.
 * Seam: if the map/service ever hands us a JSON offer instead of a fragment ref,
 * branch here and render it via json2html before returning the markup.
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
    // JSON2HTML seam: the fetched fragment is a template; fill its `{{token}}`
    // placeholders from the offer's `data`. No data / no tokens → unchanged.
    return { markup: fillTokens(await res.text(), entry.data), headers: res.headers };
  } catch {
    return null;
  }
}
