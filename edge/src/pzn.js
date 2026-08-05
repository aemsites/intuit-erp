/**
 * Personalization source resolution.
 *
 * Two concerns, both deliberately swappable:
 *
 *  1. The *map* — which offer applies to a path. Today this is a mock JSON sheet
 *     (`PZN_MAP_URL`) that proxies Intuit's real pzn service. When the real
 *     service arrives, only `fetchMap` changes (e.g. POST the path + audience
 *     signals, or swap in a service binding). Nothing else in the worker cares.
 *
 *  2. The *offer* — the actual content to inject. Today offers are authored EDS
 *     fragments under `/fragments/pzn/` and fetched as `.plain.html`. If Intuit
 *     later sends offers as JSON, render them to fragment markup with json2html
 *     (https://www.aem.live/developer/json2html) at the seam marked below.
 *
 * The worker does NO decisioning — it renders whatever the map resolves for a
 * path. Intuit's service (and RTCDP) decide which offer applies.
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
 * Normalizes a path for comparison (drops a trailing slash except at root).
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Fetches the personalization map. Swap this for the real pzn service call.
 * Returns [] on any failure so the caller falls back to an untouched passthrough.
 * @param {Env} env
 * @returns {Promise<PznEntry[]>}
 */
async function fetchMap(env) {
  try {
    const res = await fetch(env.PZN_MAP_URL, {
      // The map is intentionally not cached at the edge yet — caching is an
      // open design question (see README). Revisit once the real pzn service
      // and its cache semantics are known.
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the map entry for a path, or null if the path is not personalized.
 * @param {Env} env
 * @param {string} path
 * @returns {Promise<PznEntry | null>}
 */
export async function resolvePznEntry(env, path) {
  const entries = await fetchMap(env);
  const target = normalizePath(path);
  return entries.find((e) => normalizePath(e.path) === target) ?? null;
}

/**
 * Resolves the offer markup to inject for a map entry.
 *
 * Currently: fetch the referenced EDS fragment as `.plain.html`.
 * Seam: if the map/service ever hands us a JSON offer instead of a fragment ref,
 * branch here and render it via json2html before returning the markup.
 *
 * Returns the markup plus the fragment response headers (for cache-key
 * propagation), or null on any failure so the caller passes the page through
 * untouched.
 *
 * Request headers mirror the main origin fetch: `x-byo-cdn-type` /
 * `x-push-invalidation` ask the origin to emit its surrogate/cache-tag headers,
 * and `accept-encoding: identity` avoids compressed-body edge cases since we read
 * the body as text. The fragment is fetched fresh (`cacheTtl: 0`) so its cache
 * tags are always current.
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
    'x-byo-cdn-type': 'cloudflare',
  };
  if (env.PUSH_INVALIDATION !== 'disabled') headers['x-push-invalidation'] = 'enabled';

  try {
    const res = await fetch(fragmentUrl, {
      headers,
      cf: { cacheEverything: false, cacheTtl: 0 },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('text/html')) return null;
    return { markup: await res.text(), headers: res.headers };
  } catch {
    return null;
  }
}
