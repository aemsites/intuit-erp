/**
 * content-index — shared query-index fetch/cache + date formatting for the
 * auto-listing card blocks (case-study-cards, resource-cards). Each index
 * path is fetched once and reused across every block instance on the page.
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
