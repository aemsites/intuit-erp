/**
 * search-utils — shared logic for Resource Center search (issue #60).
 *
 * Split into two halves:
 *   1. Pure helpers (buildSearchUrl / getSearchQuery / isArticle /
 *      searchEntries) — no DOM, no network, unit-tested directly.
 *   2. Chrome enhancers (enhanceSecondaryNavSearch / wireFooterSearch) — called
 *      by blocks/header/header.js and blocks/footer/footer.js at the end of
 *      their own decorate(), so the search icon rides along with the secondary
 *      nav and the footer search rides along with the footer. Both are
 *      idempotent and no-op when their target markup is absent (e.g. the nav
 *      search does nothing until issue #59's .ies-secondary-nav exists).
 *
 * The results block (blocks/search/search.js) imports the pure helpers too.
 */

export const SEARCH_PAGE = '/blog/search';
export const SEARCH_PARAM = 'search-term';

// Blue magnifier, colored via currentColor by header.css.
const SEARCH_ICON = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.38 8.84l3.64 3.65a1 1 0 01-1.41 1.41l-3.65-3.64A5.5 5.5 0 118.5 3zm0 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
</svg>`;

/**
 * The search page URL for a query. Empty/whitespace query → the bare page
 * (no query string), so a cleared search lands on the empty state.
 * @param {string} query
 * @returns {string}
 */
export function buildSearchUrl(query) {
  const q = (query || '').trim();
  if (!q) return SEARCH_PAGE;
  return `${SEARCH_PAGE}?${SEARCH_PARAM}=${encodeURIComponent(q)}`;
}

/**
 * Read the current search term from a query string.
 * @param {string} [search] defaults to window.location.search
 * @returns {string} decoded, trimmed term ('' when absent)
 */
export function getSearchQuery(search = window.location.search) {
  return (new URLSearchParams(search).get(SEARCH_PARAM) || '').trim();
}

/**
 * True for Resource Center articles (/blog/<category>/<slug>, depth ≥ 3) and
 * false for the /blog home and the single-segment category landing pages —
 * "articles, not category pages".
 * @param {object} entry query-index row
 * @returns {boolean}
 */
export function isArticle(entry) {
  const segs = (entry.path || '').split('/').filter(Boolean);
  return segs.length >= 3 && segs[0] === 'blog';
}

/**
 * Filter/match/rank query-index entries for a search term. Pure.
 * Matches articles where every whitespace-separated token appears (AND) in
 * title + description + category + tags. Ranks title matches first, then by
 * date descending within each group.
 * @param {Array<object>} entries raw query-index `.data` rows
 * @param {string} query
 * @returns {Array<object>} ranked matching entries ([] for an empty query)
 */
export function searchEntries(entries, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const hasAll = (text) => {
    const h = (text || '').toLowerCase();
    return tokens.every((t) => h.includes(t));
  };
  const scored = (entries || [])
    .filter((e) => e.title && isArticle(e))
    .map((e) => {
      const haystack = `${e.title} ${e.description || ''} ${e.category || ''} ${e.tags || ''}`;
      if (!hasAll(haystack)) return null;
      return { entry: e, titleMatch: hasAll(e.title) };
    })
    .filter(Boolean);
  scored.sort((a, b) => {
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    return new Date(b.entry.date) - new Date(a.entry.date);
  });
  return scored.map((s) => s.entry);
}

/**
 * Add the expand-on-click search widget to issue #59's secondary Resource
 * Center nav, if present. No-op otherwise (so it's dormant on main until #59
 * lands, and absent on non-/blog pages afterward). Idempotent.
 * @param {Element} root the header block
 */
export function enhanceSecondaryNavSearch(root) {
  const container = root && root.querySelector('.ies-secondary-nav .container');
  if (!container || container.querySelector('.rc-search')) return;

  const widget = document.createElement('div');
  widget.className = 'rc-search';
  widget.innerHTML = `
    <button type="button" class="rc-search-toggle" aria-label="Search" aria-expanded="false">${SEARCH_ICON}</button>
    <form class="rc-search-form" role="search">
      <input type="search" class="rc-search-input" placeholder="Search on Intuit Resource Center" aria-label="Search on Intuit Resource Center">
      <button type="button" class="rc-search-clear" aria-label="Clear search">&times;</button>
    </form>`;
  container.append(widget);

  // The secondary nav's mobile handler toggles its accordion on any click in
  // the bar outside .secondary-nav-items (see header.js). Keep search clicks
  // from bubbling into it so tapping the icon/input doesn't also open the menu.
  widget.addEventListener('click', (e) => e.stopPropagation());

  const toggle = widget.querySelector('.rc-search-toggle');
  const form = widget.querySelector('.rc-search-form');
  const input = widget.querySelector('.rc-search-input');
  const clear = widget.querySelector('.rc-search-clear');
  // Reflected user input — set via property, never interpolated into innerHTML.
  input.value = getSearchQuery();

  // The nav gets `rc-search-active` so CSS can hide the nav items and let the
  // field fill their strip — the "Resource center" brand stays put.
  const nav = widget.closest('.ies-secondary-nav');
  const setOpen = (open) => {
    widget.classList.toggle('rc-search-open', open);
    if (nav) nav.classList.toggle('rc-search-active', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus();
  };
  toggle.addEventListener('click', () => setOpen(!widget.classList.contains('rc-search-open')));
  // × collapses the expanded search (and clears it), returning focus to the icon.
  clear.addEventListener('click', () => { input.value = ''; setOpen(false); toggle.focus(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.location.assign(buildSearchUrl(input.value));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

/**
 * Wire the footer "Search this site" input to submit to the search page.
 * No-op when the input is absent. Idempotent.
 * @param {Element} root the footer block
 */
export function wireFooterSearch(root) {
  const input = root && root.querySelector('.footer-search input');
  if (!input || input.dataset.searchWired) return;
  input.dataset.searchWired = 'true';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.location.assign(buildSearchUrl(input.value));
    }
  });
}
