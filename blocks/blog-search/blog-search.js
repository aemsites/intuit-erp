/**
 * search — Resource Center search results page (issue #60), rendered on
 * /blog/search. Reads the `search-term` query param, searches the Resource
 * Center articles in /blog/query-index.json, and lists matches as
 * thumbnail + title + date rows, 6 at a time behind a "Load More" button that
 * disappears at the end of the list (same batching as resource-cards).
 *
 * The page carries its own editable search field (the large underlined input,
 * matching erp.intuit.com's search page) — submitting it re-runs the search
 * in place via history.pushState (no reload), and the × clears back to the
 * empty state. The secondary-nav and footer search boxes navigate here with a
 * full page load; this block reads the param on initial decorate. See
 * blocks/search/search-utils.js for the shared, unit-tested query logic.
 *
 * CSS: blocks/blog-search/blog-search.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';
import {
  getSearchQuery, buildSearchUrl, searchEntries,
} from './search-utils.js';

const INDEX_PATH = '/blog/query-index.json';
const PAGE_SIZE = 6;
const DEBOUNCE_MS = 400;

function resultRow(item) {
  const row = document.createElement('a');
  row.className = 'search-result';
  row.href = item.path;

  const pic = document.createElement('div');
  pic.className = 'search-result-image';
  if (item.image) {
    pic.append(createOptimizedPicture(item.image, item.title, false, [{ width: '400' }]));
  }

  const body = document.createElement('div');
  body.className = 'search-result-body';
  const heading = document.createElement('h3');
  heading.textContent = item.title;
  const date = document.createElement('p');
  date.className = 'search-result-date';
  date.textContent = formatDate(item.date);
  body.append(heading, date);

  row.append(pic, body);
  return row;
}

export default async function decorate(block) {
  block.textContent = '';

  // Editable search field (doubles as the page's visual header). A visually
  // hidden h1 keeps the heading hierarchy intact for a11y/SEO.
  const h1 = document.createElement('h1');
  h1.className = 'search-title';
  h1.textContent = 'Search the Resource Center';

  const form = document.createElement('form');
  form.className = 'search-form';
  form.setAttribute('role', 'search');
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'search-input';
  input.placeholder = 'Search on Intuit Resource Center';
  input.setAttribute('aria-label', 'Search on Intuit Resource Center');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = '&times;';
  form.append(input, clear);

  const count = document.createElement('p');
  count.className = 'search-count';
  const list = document.createElement('div');
  list.className = 'search-results';
  const loadMoreWrap = document.createElement('div');
  loadMoreWrap.className = 'search-load-more';
  loadMoreWrap.hidden = true;
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'button secondary';
  loadMoreBtn.textContent = 'Load More';
  loadMoreWrap.append(loadMoreBtn);

  block.append(h1, form, count, list, loadMoreWrap);

  let entries = null;
  let results = [];
  let shown = 0;

  const renderBatch = () => {
    results.slice(shown, shown + PAGE_SIZE).forEach((item) => list.append(resultRow(item)));
    shown += PAGE_SIZE;
    loadMoreWrap.hidden = shown >= results.length;
  };

  const render = async (query) => {
    input.value = query;
    list.textContent = '';
    shown = 0;
    block.classList.toggle('has-query', !!query);
    if (!query) {
      count.textContent = '';
      loadMoreWrap.hidden = true;
      return;
    }
    if (!entries) entries = await loadIndex(INDEX_PATH);
    results = searchEntries(entries, query);
    count.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
    renderBatch();
  };

  // Run a search and reflect it in the URL. Explicit actions (submit, clear)
  // push a history entry; the debounced as-you-type search replaces the current
  // one so typing doesn't flood the back button.
  const runSearch = (query, push = true) => {
    window.history[push ? 'pushState' : 'replaceState']({}, '', buildSearchUrl(query));
    render(query);
  };

  // Auto-search once the user pauses typing (or pastes) — no Enter needed. This
  // lives only on the search page's own field, not the header/footer inputs.
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(input.value.trim(), false), DEBOUNCE_MS);
  });

  loadMoreBtn.addEventListener('click', renderBatch);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounce);
    runSearch(input.value.trim(), true);
  });
  clear.addEventListener('click', () => {
    clearTimeout(debounce);
    runSearch('', true);
    input.focus();
  });
  window.addEventListener('popstate', () => render(getSearchQuery()));

  await render(getSearchQuery());
}
