/**
 * Shared ordering for the blog right-rail blocks (blog-rail-case-study,
 * related-blogs). Default is newest-first; an authored `items` list lets an
 * author hand-pick the exact articles to show, in order.
 */

// Normalize a path or absolute href to a slash-trimmed pathname for comparison.
function toPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, window.location.origin).pathname.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
}

// readBlockConfig gives an array of hrefs for multi-link cells, a string
// otherwise; a plain-text cell may hold comma/newline-separated paths. Accept
// all three and return an ordered list of normalized paths.
export function parsePathList(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[\n,]+/);
  return raw.map(toPath).filter(Boolean);
}

function byDateDesc(a, b) {
  const time = (s) => {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return time(b.date) - time(a.date);
}

/**
 * Order rail entries by author intent.
 * @param {object} opts
 * @param {Array}  opts.pool  category-filtered candidates (fallback set)
 * @param {Array} [opts.all]  full valid entry set for curated lookups (defaults to pool)
 * @param {*}     [opts.items] authored path list (curation) — hrefs, array, or text
 * @returns {Array} ordered entries (caller applies the limit)
 */
export function orderRailItems({ pool, all = pool, items } = {}) {
  const wanted = parsePathList(items);
  if (wanted.length) {
    const byPath = new Map(all.map((entry) => [toPath(entry.path), entry]));
    const picked = wanted.map((p) => byPath.get(p)).filter(Boolean);
    if (picked.length) return picked;
  }
  return [...pool].sort(byDateDesc);
}
