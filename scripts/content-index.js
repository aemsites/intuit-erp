/**
 * content-index — shared query-index fetch/cache + date formatting for the
 * auto-listing card blocks (blog-cards, event-cards). Each index path is
 * fetched once and reused across every block instance on the page. Also hosts
 * normalizePath, the shared helper for trailing-slash-agnostic path comparison.
 */
const cache = new Map();

export function loadIndex(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path)
      .then((resp) => (resp.ok ? resp.json() : { data: [] }))
      .then((json) => json.data || [])
      .catch(() => []));
  }
  return cache.get(path);
}

export function formatDate(value) {
  // a bare YYYY-MM-DD parses as UTC midnight, which renders as the previous day
  // in any negative-offset timezone — pin it to local midnight instead
  const local = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Curated ordering: an entry with a numeric `order` metadata pins first
 * (ascending). Entries without a usable `order` sort last (Number.MAX_SAFE_INTEGER),
 * so they keep their date order among themselves. Used as the primary sort key
 * by the event listing and the blog rails; requires the index to expose `order`.
 * @param {{order?: string|number}} item
 * @returns {number}
 */
export function pinRank(item) {
  const n = Number(item.order);
  return String(item.order ?? '').trim() && Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Date comparator; newest-first when `newestFirst` is true, else oldest-first.
 * NaN-safe (missing/unparseable dates compare equal).
 * @param {{date?: string}} a
 * @param {{date?: string}} b
 * @param {boolean} newestFirst
 * @returns {number}
 */
export function byDate(a, b, newestFirst) {
  const diff = newestFirst
    ? new Date(b.date) - new Date(a.date)
    : new Date(a.date) - new Date(b.date);
  return Number.isNaN(diff) ? 0 : diff;
}

/**
 * Canonicalize a content path for comparison: strips any query/hash and trailing
 * slash(es), keeping the root as '/'. So '/foo', '/foo/', and '/foo/?x#h' all
 * normalize to '/foo'. Apply to BOTH sides of a path comparison to make it
 * trailing-slash agnostic.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  const path = (p || '/').split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}
