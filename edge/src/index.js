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
 *
 * A second, independent transform runs alongside fragment injection: template
 * fill (template.js). Some pages are authored with literal ALL-CAPS placeholder
 * tokens (TITLE, BODY, ...) and a sibling data sheet; the worker fills those
 * tokens from the sheet, enriched with per-visitor signals (visitor.js), so the
 * page's own markup renders live, personalized data.
 */

import { applyPersonalization } from './personalize.js';
import { resolveOfferMarkup, resolvePznEntry } from './pzn.js';
import { resolveIxpEntry } from './ixp/resolve.js';
import { resolveMockEntry } from './ixp/mock-source.js';
import { resolveTemplateData, fillPlaceholders } from './template.js';
import { deriveVisitorTokens } from './visitor.js';
import { handleAssignment } from './mock/ixp-assignment.js';
import { createCacheKeys, mergeCacheKeys, applyCacheKeys } from './cache-keys.js';

/**
 * @typedef {import('./personalize.js').PznEntry} PznEntry
 */

/** mhast html-to-json fallback for `.json` paths the origin 404s. */
const HTML2JSON_BASE = 'https://mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp';
/** Query params forwarded to mhast, and also preserved on `.json` origin calls. */
const HTML2JSON_QUERY_PARAMS = new Set(['head', 'preview', 'compact']);
/**
 * Structured-content JSON source (da-sc). `.json` paths that 404 at the origin
 * and match a `STRUCTURED_CONTENT_PATHS` prefix are served from here instead of
 * the mhast fallback — the content is authored in DA, not published to aem.live.
 */
const STRUCTURED_CONTENT_BASE = 'https://da-sc.adobeaem.workers.dev/live/aemsites/intuit-erp';
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

/**
 * Path prefixes whose `.json` is served by the structured-content (da-sc) source.
 * Read from the `STRUCTURED_CONTENT_PATHS` env var, accepting an array
 * (`["/events/"]`), a JSON string, or a comma-separated string. Empty when unset.
 * @param {Env} env
 * @returns {string[]}
 */
function structuredContentPaths(env) {
  const raw = env.STRUCTURED_CONTENT_PATHS;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON — fall through to comma-separated parsing
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Builds the JSON-fallback URL for a `.json` path that the origin 404'd. Paths
 * under a `STRUCTURED_CONTENT_PATHS` prefix go to the da-sc structured-content
 * source; everything else goes to the mhast html-to-json worker.
 * @param {URL} url
 * @param {Env} env
 * @returns {URL}
 */
function buildJsonFallbackUrl(url, env) {
  // Drop the `.json` extension, then normalize the EDS folder index document to
  // its folder path — `/index` is served at `/`, `/foo/index` at `/foo/` — so
  // `/index.json` resolves to the homepage rather than a non-existent `/index`.
  const pagePath = url.pathname.replace(/\.json$/, '').replace(/\/index$/, '/');

  if (structuredContentPaths(env).some((prefix) => pagePath.startsWith(prefix))) {
    return new URL(`${STRUCTURED_CONTENT_BASE}${pagePath}`);
  }

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
 * @param {Headers | null} [fragmentHeaders] Fragment response headers whose cache
 *   keys are merged in; null/omitted for a template-only fill (no fragment).
 * @returns {Response}
 */
function htmlResponse(body, origin, fragmentHeaders) {
  const headers = new Headers(origin.headers);
  // Body length changed and it is now identity-encoded (we read .text()).
  headers.delete('content-length');
  headers.delete('content-encoding');

  const cacheKeys = createCacheKeys(origin.headers);
  if (fragmentHeaders) mergeCacheKeys(cacheKeys, fragmentHeaders);
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

    // Fetch the origin page, resolve the pzn entry, and resolve any template
    // fill data — all in parallel. The origin HTML is fetched fresh (`cacheTtl: 0`)
    // so a publish on aem.live shows up immediately; without a working push-
    // invalidation purge to this worker's cache, `cacheEverything` would serve a
    // page stale by up to its `max-age` (and hide freshly-authored pzn slots).
    // Revisit once push invalidation is wired up (see README caching note).
    // Non-enrolled paths resolve to null with no network call, so template fill
    // is free for pages that don't use it.
    const [originResponse, entry, templateData] = await Promise.all([
      fetch(originRequest, { cf: { cacheTtl: 0 } }),
      resolveEntry.catch(() => null),
      resolveTemplateData(env, url.pathname).catch(() => null),
    ]);

    let response = originResponse;

    // 7. `.json` 404 → JSON fallback: da-sc for structured-content paths, else mhast.
    if (request.method === 'GET' && url.pathname.endsWith('.json') && response.status === 404) {
      const fallback = await fetch(buildJsonFallbackUrl(url, env).toString(), {
        headers: { accept: 'application/json' },
        cf: { cacheEverything: true },
      });
      if (fallback.ok) response = fallback;
      return finalize(response, savedSearch);
    }

    // 8. Personalization. Two independent transforms run on an ok HTML GET
    //    response: fragment injection for a matched pzn entry, and template fill
    //    for a page authored as a template. Passthrough (body unread) unless at
    //    least one applies.
    if (request.method === 'GET') {
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('text/html')) {
        const offer = entry ? await resolveOfferMarkup(env, entry) : null;
        if (offer || templateData) {
          let html = await response.text();

          // (1) Fragment injection: swap/insert an offer at the entry's slot.
          if (offer && entry) html = applyPersonalization(html, offer.markup, entry);

          // (2) Template fill: the page itself is the template — replace its
          // ALL-CAPS placeholder tokens from the data sheet, enriched with
          // per-visitor signals (geo/lang/greeting). The sheet wins collisions.
          if (templateData) {
            html = fillPlaceholders(html, { ...deriveVisitorTokens(request), ...templateData });
          }

          // Only a fragment carries cache keys to merge; a template-only fill
          // has none, so pass null.
          response = htmlResponse(html, response, offer ? offer.headers : null);
        }
      }
    }

    return finalize(response, savedSearch);
  },
};
