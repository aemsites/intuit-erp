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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
