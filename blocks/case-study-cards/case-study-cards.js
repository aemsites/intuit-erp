/**
 * case-study-cards — auto-populated grid of case studies, driven entirely by
 * /case-studies/query-index.json (see helix-query.yaml). Authoring a new page
 * under /case-studies/ and publishing it is enough to make it appear here —
 * no block config, no authored rows.
 *
 * Variants:
 *   (default, index page)  all case studies, newest first; first 2 rendered
 *                          as larger "featured" cards, rest in a 3-col grid,
 *                          batched behind a "Load More" button.
 *   .recommended           fixed set of 3, excludes the current page (used
 *                          on case-study detail pages).
 * CSS: blocks/case-study-cards/case-study-cards.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

const INDEX_PATH = '/case-studies/query-index.json';
const PAGE_SIZE = 6;

let indexPromise;
function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_PATH)
      .then((resp) => (resp.ok ? resp.json() : { data: [] }))
      .then((json) => json.data || [])
      .catch(() => []);
  }
  return indexPromise;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function cardHTML(item, featured) {
  const article = document.createElement('article');
  article.className = featured ? 'case-study-card featured' : 'case-study-card';
  const picWrap = document.createElement('div');
  picWrap.className = 'case-study-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title, false, [{ width: featured ? '750' : '400' }]));
  }
  const body = document.createElement('div');
  body.className = 'case-study-card-body';
  body.innerHTML = `
    <p class="eyebrow">Case study</p>
    <h3><a href="${item.path}">${item.title}</a></h3>
    <p class="case-study-card-date">${formatDate(item.date)}</p>`;
  article.append(picWrap, body);
  return article;
}

export default async function decorate(block) {
  const recommended = block.classList.contains('recommended');
  block.textContent = '';

  const items = [...await loadIndex()]
    .filter((item) => item.path !== window.location.pathname)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const grid = document.createElement('div');
  grid.className = 'case-study-grid';
  block.append(grid);

  if (recommended) {
    items.slice(0, 3).forEach((item) => grid.append(cardHTML(item, false)));
    return;
  }

  let shown = 0;
  const renderNext = () => {
    items.slice(shown, shown + PAGE_SIZE).forEach((item, i) => {
      grid.append(cardHTML(item, shown === 0 && i < 2));
    });
    shown += PAGE_SIZE;
    loadMoreBtn.hidden = shown >= items.length;
  };

  const loadMoreWrap = document.createElement('div');
  loadMoreWrap.className = 'case-study-load-more';
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'button secondary';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.addEventListener('click', renderNext);
  loadMoreWrap.append(loadMoreBtn);
  block.append(loadMoreWrap);

  renderNext();
}
