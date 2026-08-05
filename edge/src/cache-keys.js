/**
 * Cache-key (surrogate/cache-tag) propagation.
 *
 * When the worker inlines a fragment (an offer or a page-level variation) into
 * the origin page, the composed response must carry the *union* of the page's
 * and the fragment's cache keys. That way, when the fragment is invalidated at
 * the CDN, every personalized page that inlined it is invalidated too.
 *
 * Ported from adobe-rnd/helix-mixer `inlines.js`. Four header families are
 * tracked because different CDNs use different names:
 *   - `surrogate-key`  (Fastly)   — space-delimited
 *   - `edge-cache-tag` (Akamai)   — comma-delimited
 *   - `cache-tag`      (Cloudflare) — comma-delimited
 *   - `x-cache-tag`    (Cloudflare fallback; `cache-tag` may be stripped by CF)
 */

/** Delimiter used to (de)serialize each header family. */
const DELIMITER = (key) => (key === 'surrogate-key' ? ' ' : ',');

/**
 * Seed a cache-key accumulator from a response's headers.
 * @param {Headers} headers
 * @returns {Record<string, Set<string>>}
 */
export function createCacheKeys(headers) {
  return {
    'surrogate-key': new Set(headers.get('surrogate-key')?.split(' ') || []),
    'edge-cache-tag': new Set(headers.get('edge-cache-tag')?.split(',') || []),
    'cache-tag': new Set(headers.get('cache-tag')?.split(',') || []),
    'x-cache-tag': new Set(headers.get('x-cache-tag')?.split(',') || []),
  };
}

/**
 * Union a fetched fragment's cache keys into the accumulator.
 * @param {Record<string, Set<string>>} cacheKeys
 * @param {Headers} headers
 */
export function mergeCacheKeys(cacheKeys, headers) {
  for (const [key, value] of Object.entries(cacheKeys)) {
    const strValue = headers.get(key)?.trim();
    if (strValue) {
      strValue.split(DELIMITER(key)).forEach((v) => value.add(v.trim()));
    }
  }
}

/**
 * Serialize the accumulated cache keys onto a response's headers. The Cloudflare
 * `cache-tag` and `x-cache-tag` families are unioned so both carry the same set.
 * @param {Headers} headers
 * @param {Record<string, Set<string>>} cacheKeys
 */
export function applyCacheKeys(headers, cacheKeys) {
  const cfUnion = new Set([
    ...cacheKeys['cache-tag'],
    ...cacheKeys['x-cache-tag'],
  ]);
  cacheKeys['cache-tag'] = cfUnion;
  cacheKeys['x-cache-tag'] = cfUnion;

  for (const [key, value] of Object.entries(cacheKeys)) {
    const strValue = [...value].join(DELIMITER(key)).trim();
    if (strValue) {
      headers.set(key, strValue);
    }
  }
}
