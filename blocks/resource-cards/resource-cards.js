/**
 * resource-cards — auto-populated grid of research guides/whitepapers,
 * driven entirely by /research/query-index.json (see helix-query.yaml).
 * Authoring a new page under /research/ and publishing it is enough to
 * make it appear here — no block config, no authored rows.
 *
 * Unlike case-study-cards, every card is the same size (the live
 * erp.intuit.com research grid has no "featured" treatment).
 *
 * Variants:
 *   (default, index page)  all guides, newest first, batched behind "Load More"
 *   .recommended           fixed set of 3, excludes the current page (used
 *                          on guide detail pages)
 * CSS: blocks/resource-cards/resource-cards.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const INDEX_PATH = '/research/query-index.json';
const PAGE_SIZE = 6;

function cardHTML(item) {
  const card = document.createElement('a');
  card.className = 'resource-card';
  card.href = item.path;
  const picWrap = document.createElement('div');
  picWrap.className = 'resource-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title, false, [{ width: '400' }]));
  }
  const body = document.createElement('div');
  body.className = 'resource-card-body';
  body.innerHTML = `
    <p class="eyebrow">Guide</p>
    <h3>${item.title}</h3>
    <p class="resource-card-date">${formatDate(item.date)}</p>`;
  card.append(picWrap, body);
  return card;
}

export default async function decorate(block) {
  const recommended = block.classList.contains('recommended');
  block.textContent = '';

  const items = [...await loadIndex(INDEX_PATH)]
    .filter((item) => item.path !== window.location.pathname)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const grid = document.createElement('div');
  grid.className = 'resource-grid';
  block.append(grid);

  if (recommended) {
    items.slice(0, 3).forEach((item) => grid.append(cardHTML(item)));
    return;
  }

  let shown = 0;
  const loadMoreWrap = document.createElement('div');
  loadMoreWrap.className = 'resource-load-more';
  const renderNext = () => {
    items.slice(shown, shown + PAGE_SIZE).forEach((item) => grid.append(cardHTML(item)));
    shown += PAGE_SIZE;
    loadMoreWrap.hidden = shown >= items.length;
  };

  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'button secondary';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.addEventListener('click', renderNext);
  loadMoreWrap.append(loadMoreBtn);
  block.append(loadMoreWrap);

  renderNext();
}
