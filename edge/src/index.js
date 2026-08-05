/**
 * intuit-edge: personalization edge proxy in front of aem.live.
 *
 * The worker is a full aem.live production proxy (so a real domain can point at
 * it) with personalization layered on top. On each request:
 *   1. Serve the in-worker IXP Assignment mock at `/v2/assignment` (so the `ixp`
 *      HTTP flow can self-call it — no second worker).
 *   2. Apply the standard aem.live proxy contract (port redirect, RUM guard,
 *      query-param sanitization, CDN headers, response cleanup) — mirrors
 *      adobe/aem-cloudflare-prod-worker.
 *   3. Fetch the origin page and resolve the personalization entry in parallel.
 *   4. For a `.json` request the origin 404s, fall back to the mhast
 *      html-to-json worker.
 *   5. No map match  -> return the origin response untouched (byte-identical).
 *   6. Map match      -> fetch the referenced offer fragment, inject it into the
 *                        DOM, and merge the fragment's cache keys into the
 *                        response (so fragment invalidation invalidates the page).
 *
 * The worker does no decisioning of its own; it renders whatever the map/service
 * resolves for a path. See pzn.js for the swappable map + offer sources.
 *
 * Three interchangeable resolvers produce the same `PznEntry`, chosen by
 * `PZN_SOURCE` (or a `?pzn=map|ixp|mock` per-request override):
 *   - "map" (default) — the map.json sheet (pzn.js).
 *   - "ixp"           — Intuit's IXP Assignment API over HTTP (ixp/resolve.js);
 *                       `IXP_ASSIGNMENT_URL` may point at this worker's own
 *                       `/us/v2/assignment` route.
 *   - "mock"          — the IXP mock, resolved in-process (ixp/mock-source.js).
 */

import { applyPersonalization } from './personalize.js';
import { resolveOfferMarkup, resolvePznEntry } from './pzn.js';
import { resolveIxpEntry } from './ixp/resolve.js';
import { resolveMockEntry } from './ixp/mock-source.js';
import { handleAssignment } from './mock/ixp-assignment.js';
import { createCacheKeys, mergeCacheKeys, applyCacheKeys } from './cache-keys.js';

/**
 * @typedef {import('./personalize.js').PznEntry} PznEntry
 */

/** mhast html-to-json fallback for `.json` paths the origin 404s. */
const HTML2JSON_BASE = 'https://mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp';
/** Query params forwarded to mhast, and also preserved on `.json` origin calls. */
const HTML2JSON_QUERY_PARAMS = new Set(['head', 'preview', 'compact']);
/** Query params kept on a media origin subrequest. */
const MEDIA_PARAMS = new Set(['format', 'height', 'optimize', 'width']);
/** Query params kept on a `.json` origin subrequest (sheet knobs + json renders). */
const JSON_PARAMS = new Set(['limit', 'offset', 'sheet', ...HTML2JSON_QUERY_PARAMS]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * The path's file extension, or '' when there is none.
 * @param {string} path
 * @returns {string}
 */
function getExtension(path) {
  const basename = path.split('/').pop();
  const pos = basename.lastIndexOf('.');
  return (basename === '' || pos < 1) ? '' : basename.slice(pos + 1);
}

/** True for aem.live optimized-media requests (`/media_<hash>...`). */
function isMediaRequest(url) {
  return /\/media_[0-9a-f]{40,}[/a-zA-Z0-9_-]*\.[0-9a-z]+$/.test(url.pathname);
}

/** True for RUM / OpenTelemetry collection requests. */
function isRUMRequest(url) {
  return /\/\.(rum|optel)\/.*/.test(url.pathname);
}

/** Personalization source: a `?pzn=` override, else the configured default. */
function resolveSource(url, env) {
  const override = url.searchParams.get('pzn');
  if (override === 'ixp' || override === 'map' || override === 'mock') return override;
  const configured = String(env.PZN_SOURCE);
  if (configured === 'ixp') return 'ixp';
  if (configured === 'mock') return 'mock';
  return 'map';
}

/**
 * Sanitizes the origin subrequest's query params in place, per aem.live rules:
 * media keeps sizing params, `.json` keeps sheet + json-render params, and any
 * other request (HTML) strips all params. Worker demo params (pzn/ivid/…) are
 * read from the original request earlier and dropped here. Params are sorted for
 * a stable cache key.
 * @param {URL} url
 * @param {string} extension
 */
function sanitizeOriginSearch(url, extension) {
  const { searchParams } = url;
  const keys = [...searchParams.keys()];
  if (isMediaRequest(url)) {
    keys.forEach((key) => { if (!MEDIA_PARAMS.has(key)) searchParams.delete(key); });
  } else if (extension === 'json') {
    keys.forEach((key) => { if (!JSON_PARAMS.has(key)) searchParams.delete(key); });
  } else {
    url.search = '';
  }
  url.searchParams.sort();
}

/** Builds the mhast html-to-json URL for a `.json` path (drops the extension). */
function buildHtml2JsonUrl(url) {
  // Drop the `.json` extension, then normalize the EDS folder index document to
  // its folder path — `/index` is served at `/`, `/foo/index` at `/foo/` — so
  // `/index.json` resolves to the homepage rather than a non-existent `/index`.
  const pagePath = url.pathname.replace(/\.json$/, '').replace(/\/index$/, '/');
  const target = new URL(`${HTML2JSON_BASE}${pagePath}`);
  for (const [key, value] of url.searchParams.entries()) {
    if (HTML2JSON_QUERY_PARAMS.has(key)) target.searchParams.append(key, value);
  }
  return target;
}

/**
 * Builds a response carrying transformed HTML, reusing the origin's headers and
 * merging the injected fragment's cache keys so CDN invalidation of the fragment
 * also invalidates this page.
 * @param {string} body
 * @param {Response} origin
 * @param {Headers} fragmentHeaders
 * @returns {Response}
 */
function htmlResponse(body, origin, fragmentHeaders) {
  const headers = new Headers(origin.headers);
  // Body length changed and it is now identity-encoded (we read .text()).
  headers.delete('content-length');
  headers.delete('content-encoding');

  const cacheKeys = createCacheKeys(origin.headers);
  mergeCacheKeys(cacheKeys, fragmentHeaders);
  applyCacheKeys(headers, cacheKeys);

  return new Response(body, {
    status: origin.status,
    statusText: origin.statusText,
    headers,
  });
}

/**
 * Shared response postprocessing (mirrors the prod worker): rewrap to make
 * headers mutable, restore the query on a 301 redirect, drop CSP on a 304, and
 * strip `age` / `x-robots-tag`.
 * @param {Response} response
 * @param {string} savedSearch
 * @returns {Response}
 */
function finalize(response, savedSearch) {
  const resp = new Response(response.body, response);
  if (resp.status === 301 && savedSearch) {
    const location = resp.headers.get('location');
    if (location && !location.match(/\?.*$/)) {
      resp.headers.set('location', `${location}${savedSearch}`);
    }
  }
  if (resp.status === 304) {
    resp.headers.delete('Content-Security-Policy');
  }
  resp.headers.delete('age');
  resp.headers.delete('x-robots-tag');
  return resp;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. In-worker IXP Assignment mock. `IXP_ASSIGNMENT_URL` can point here so
    //    the `ixp` HTTP flow self-calls it — no separate mock worker.
    if (request.method === 'GET' && /\/v2\/assignment$/.test(url.pathname)) {
      return handleAssignment(request, env);
    }

    // 2. Port redirect (prod only). Cloudflare exposes a few ports besides 443;
    //    normalize to the default. Skipped on localhost so `wrangler dev` (which
    //    always has a port) and the worker's self-call keep working.
    if (url.port && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      const redirectTo = new URL(request.url);
      redirectTo.port = '';
      return new Response(`Moved permanently to ${redirectTo.href}`, {
        status: 301,
        headers: { location: redirectTo.href },
      });
    }

    // 3. RUM/optel: only GET/POST/OPTIONS.
    if (isRUMRequest(url) && !['GET', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 4. Validate the configured origin before proxying to it.
    const originBase = new URL(env.ORIGIN_BASE_URL);
    if (!/^https:\/\/main--.*--.*\.(?:aem|hlx)\.live/.test(originBase.origin)) {
      return new Response('Invalid ORIGIN_BASE_URL', { status: 500 });
    }

    // Resolve the personalization source from the *original* URL before its
    // demo params are stripped for the origin subrequest.
    const source = resolveSource(url, env);

    // 5. Sanitize the origin subrequest URL (strips demo params, sorts).
    const extension = getExtension(url.pathname);
    const savedSearch = url.search;
    sanitizeOriginSearch(url, extension);
    const originUrl = new URL(`${url.pathname}${url.search}`, originBase).toString();

    // 6. Build the origin request with the aem.live proxy headers.
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    headers.set('x-forwarded-host', request.headers.get('host') || url.host);
    headers.set('x-byo-cdn-type', 'cloudflare');
    if (env.PUSH_INVALIDATION !== 'disabled') headers.set('x-push-invalidation', 'enabled');
    if (env.ORIGIN_AUTHENTICATION) headers.set('authorization', `token ${env.ORIGIN_AUTHENTICATION}`);

    const originRequest = new Request(originUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    });

    // Resolve the personalization entry from the selected source. All resolvers
    // yield the same `PznEntry` shape (or null → passthrough).
    /** @type {Promise<PznEntry | null>} */
    let resolveEntry;
    if (source === 'mock') resolveEntry = resolveMockEntry(request);
    else if (source === 'ixp') resolveEntry = resolveIxpEntry(env, request);
    else resolveEntry = resolvePznEntry(env, url.pathname);

    // Fetch the origin page and resolve the entry in parallel. CF does not cache
    // HTML by default; cacheEverything overrides that.
    const [originResponse, entry] = await Promise.all([
      fetch(originRequest, { cf: { cacheEverything: true } }),
      resolveEntry.catch(() => null),
    ]);

    let response = originResponse;

    // 7. `.json` 404 → mhast html-to-json fallback.
    if (request.method === 'GET' && url.pathname.endsWith('.json') && response.status === 404) {
      const fallback = await fetch(buildHtml2JsonUrl(url).toString(), {
        headers: { accept: 'application/json' },
        cf: { cacheEverything: true },
      });
      if (fallback.ok) response = fallback;
      return finalize(response, savedSearch);
    }

    // 8. Personalization. Passthrough unless a matched entry, a GET, an ok HTML
    //    response, and a fetchable offer are all present.
    if (entry && request.method === 'GET') {
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('text/html')) {
        const offer = await resolveOfferMarkup(env, entry);
        if (offer) {
          const originalHtml = await response.text();
          const personalized = applyPersonalization(originalHtml, offer.markup, entry);
          response = htmlResponse(personalized, response, offer.headers);
        }
      }
    }

    return finalize(response, savedSearch);
  },
};
