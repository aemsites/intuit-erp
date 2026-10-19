/**
 * product-bus — shared fetch-once cache for Product Bus product JSON.
 * Modeled on content-index.js's loadIndex(): a module-level Map keyed by
 * URL, fetch-once, never-reject (any failure resolves to null). Lets
 * multiple pricing-cards instances (or future blocks) share one
 * in-flight/resolved fetch per URL.
 */
const cache = new Map();

const FETCH_TIMEOUT_MS = 8000;

// eslint-disable-next-line import/prefer-default-export
export function loadProduct(url) {
  if (!cache.has(url)) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    cache.set(url, fetch(url, { signal: controller.signal })
      .then((resp) => (resp.ok ? resp.json() : null))
      .catch(() => null)
      .finally(() => clearTimeout(timeoutId)));
  }
  return cache.get(url);
}
