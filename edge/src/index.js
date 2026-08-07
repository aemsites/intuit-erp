/**
 * intuit-edge: personalization edge proxy in front of aem.live.
 *
 * The worker is a full aem.live production proxy (so a real domain can point at
 * it) with personalization layered on top. On each request:
 *   1. Apply the standard aem.live proxy contract (port redirect, RUM guard,
 *      query-param sanitization, CDN headers, response cleanup) — mirrors
 *      adobe/aem-cloudflare-prod-worker.
 *   2. Fetch the origin page and resolve the personalization entry in parallel.
 *   3. For a `.json` request the origin 404s, fall back to the mhast
 *      html-to-json worker.
 *   4. No personalized entry -> return the origin response untouched (byte-identical).
 *   5. Entry resolved        -> fetch the referenced offer fragment, inject it into
 *                        the DOM, and merge the fragment's cache keys into the
 *                        response (so fragment invalidation invalidates the page).
 *
 * The worker does no decisioning of its own; it renders whatever Intuit's
 * service resolves for a path. See pzn.js for the shared offer-rendering tail.
 *
 * Interchangeable resolvers produce the same `PznEntry` (or an array of them),
 * chosen by `PZN_SOURCE` (or a `?pzn=de|ixp` per-request override):
 *   - "de" (default) — Intuit's Decision Engine "Batch" flow (de/resolve.js): a
 *                       batch decision per visitor → one entry per personalized
 *                       slot. Yields a `PznEntry[]`.
 *   - "ixp"          — Intuit's IXP Assignment API over HTTP (ixp/resolve.js),
 *                       for whole-page / block A-B experiments.
 *
 * A second, independent transform runs alongside fragment injection: template
 * fill (template.js). Some pages are authored with literal ALL-CAPS placeholder
 * tokens (TITLE, BODY, ...) and a sibling data sheet; the worker fills those
 * tokens from the sheet, enriched with per-visitor signals (visitor.js), so the
 * page's own markup renders live, personalized data.
 */

import { applyPersonalization } from './personalize.js';
import { resolveOfferMarkup } from './pzn.js';
import { resolveIxpEntry } from './ixp/resolve.js';
import { resolveDeEntries } from './de/resolve.js';
import { resolveTemplateData, fillPlaceholders } from './template.js';
import { deriveVisitorTokens } from './visitor.js';
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
  if (override === 'ixp' || override === 'de') return override;
  return String(env.PZN_SOURCE) === 'ixp' ? 'ixp' : 'de';
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
 * @param {Headers[]} [fragmentHeaders] Fragment response headers (one per injected
 *   offer) whose cache keys are merged in; empty/omitted for a template-only fill.
 * @returns {Response}
 */
function htmlResponse(body, origin, fragmentHeaders = []) {
  const headers = new Headers(origin.headers);
  // Body length changed and it is now identity-encoded (we read .text()).
  headers.delete('content-length');
  headers.delete('content-encoding');

  const cacheKeys = createCacheKeys(origin.headers);
  for (const fh of fragmentHeaders) mergeCacheKeys(cacheKeys, fh);
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
 * @param {Env} env
 * @returns {Response}
 */
function finalize(response, savedSearch, env) {
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

  // We may only let a CDN cache our output when we can purge it on publish —
  // i.e. when push invalidation is wired up. Until then, force `no-store` so
  // every request re-fetches the origin and a publish (or a freshly-authored
  // pzn slot) shows up immediately, instead of serving a stale edge-cached copy
  // we have no way to invalidate. Remove this alongside re-enabling
  // PUSH_INVALIDATION once real purge is set up.
  if (env.PUSH_INVALIDATION === 'disabled') {
    resp.headers.set('cache-control', 'no-store');
    resp.headers.set('cdn-cache-control', 'no-store');
  }
  return resp;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Port redirect (prod only). Cloudflare exposes a few ports besides 443;
    //    normalize to the default. Skipped on localhost so `wrangler dev` (which
    //    always has a port) keeps working.
    if (url.port && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      const redirectTo = new URL(request.url);
      redirectTo.port = '';
      return new Response(`Moved permanently to ${redirectTo.href}`, {
        status: 301,
        headers: { location: redirectTo.href },
      });
    }

    // 2. RUM/optel: only GET/POST/OPTIONS.
    if (isRUMRequest(url) && !['GET', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 3. Validate the configured origin before proxying to it.
    const originBase = new URL(env.ORIGIN_BASE_URL);
    if (!/^https:\/\/main--.*--.*\.(?:aem|hlx)\.live/.test(originBase.origin)) {
      return new Response('Invalid ORIGIN_BASE_URL', { status: 500 });
    }

    // Resolve the personalization source from the *original* URL before its
    // demo params are stripped for the origin subrequest.
    const source = resolveSource(url, env);

    // 4. Sanitize the origin subrequest URL (strips demo params, sorts).
    const extension = getExtension(url.pathname);
    const savedSearch = url.search;
    sanitizeOriginSearch(url, extension);
    const originUrl = new URL(`${url.pathname}${url.search}`, originBase).toString();

    // 5. Build the origin request with the aem.live proxy headers.
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    headers.set('x-forwarded-host', request.headers.get('host') || url.host);
    // BYO-CDN signaling only when we actually cache (push invalidation on).
    // While it is off we bypass caching entirely, so don't advertise as a CDN:
    // that stops the origin from tailoring cache-control/surrogate headers we
    // would not use anyway.
    if (env.PUSH_INVALIDATION !== 'disabled') {
      headers.set('x-byo-cdn-type', 'cloudflare');
      headers.set('x-push-invalidation', 'enabled');
    }
    if (env.ORIGIN_AUTHENTICATION) headers.set('authorization', `token ${env.ORIGIN_AUTHENTICATION}`);

    // Origin caching: we may only use Cloudflare's cache when we can purge it on
    // publish — i.e. once push invalidation is wired up. Until then bypass it
    // with `cache: 'no-store'`. A `workers.dev` deployment has no zone to purge,
    // and `cf.cacheTtl: 0` is not enough: it still serves an entry already stored
    // by an earlier `cacheEverything` fetch, so a publish (or a freshly-authored
    // pzn slot) stays hidden behind stale HTML. `no-store` makes the runtime skip
    // the cache read and write entirely. Revisit alongside PUSH_INVALIDATION.
    const bypassOriginCache = env.PUSH_INVALIDATION === 'disabled';

    const originRequest = new Request(originUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
      ...(bypassOriginCache ? { cache: 'no-store' } : {}),
    });

    // Resolve the personalization entry(ies) from the selected source. The
    // `ixp` source yields a `PznEntry | null`; the `de` (Decision Engine) source
    // yields a `PznEntry[]` (one per personalized slot). Both are normalized to
    // an array below, so the render path is shared.
    /** @type {Promise<PznEntry | PznEntry[] | null>} */
    let resolveEntry;
    if (source === 'ixp') resolveEntry = resolveIxpEntry(env, request);
    else resolveEntry = resolveDeEntries(env, request);

    // Fetch the origin page, resolve the pzn entry, and resolve any template
    // fill data — all in parallel. `bypassOriginCache` chooses fresh (no-store,
    // set on the request above) vs. cached (`cacheEverything`) origin reads.
    // Non-enrolled paths resolve to null with no network call, so template fill
    // is free for pages that don't use it.
    const [originResponse, resolved, templateData] = await Promise.all([
      fetch(originRequest, bypassOriginCache ? undefined : { cf: { cacheEverything: true } }),
      resolveEntry.catch(() => null),
      resolveTemplateData(env, url.pathname).catch(() => null),
    ]);

    // Normalize to an array of entries (0..n slots): `de` already yields an
    // array; the single-entry sources yield one entry or null.
    /** @type {PznEntry[]} */
    let entries = [];
    if (Array.isArray(resolved)) entries = resolved;
    else if (resolved) entries = [resolved];

    let response = originResponse;

    // 6. `.json` 404 → JSON fallback: da-sc for structured-content paths, else mhast.
    if (request.method === 'GET' && url.pathname.endsWith('.json') && response.status === 404) {
      const fallback = await fetch(buildJsonFallbackUrl(url, env).toString(), {
        headers: { accept: 'application/json' },
        cf: { cacheEverything: true },
      });
      if (fallback.ok) response = fallback;
      return finalize(response, savedSearch, env);
    }

    // 7. Personalization. Two independent transforms run on an ok HTML GET
    //    response: fragment injection for a matched pzn entry, and template fill
    //    for a page authored as a template. Passthrough (body unread) unless at
    //    least one applies.
    if (request.method === 'GET') {
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('text/html')) {
        // Resolve each entry's offer markup (one per slot for `de`; 0..1 for the
        // other sources). Entries whose offer fails to resolve are skipped.
        const offers = await Promise.all(
          entries.map(async (e) => ({ entry: e, offer: await resolveOfferMarkup(env, e) })),
        );
        const applicable = offers.filter((o) => o.offer);

        if (applicable.length > 0 || templateData) {
          let html = await response.text();

          // (1) Fragment injection: apply each resolved offer at its own slot.
          for (const { entry, offer } of applicable) {
            html = applyPersonalization(html, offer.markup, entry);
          }

          // (2) Template fill: the page itself is the template — replace its
          // ALL-CAPS placeholder tokens from the data sheet, enriched with
          // per-visitor signals (geo/lang/greeting). The sheet wins collisions.
          if (templateData) {
            html = fillPlaceholders(html, { ...deriveVisitorTokens(request), ...templateData });
          }

          // Merge every injected fragment's cache keys so CDN invalidation of any
          // fragment invalidates this page; a template-only fill contributes none.
          response = htmlResponse(html, response, applicable.map((o) => o.offer.headers));
        }
      }
    }

    return finalize(response, savedSearch, env);
  },
};
