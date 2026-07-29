/**
 * case-study-cards — auto-populated grid of case studies, driven entirely by
 * /blog/case-study/query-index.json (see helix-query.yaml). Authoring a new
 * page under /blog/case-study/ and publishing it is enough to make it appear here —
 * no block config, no authored rows.
 *
 * Variants:
 *   (default, index page)  all case studies, newest first; first 2 rendered
 *                          as larger "featured" cards, rest in a 3-col grid,
 *                          batched behind a "Load More" button. A row of
 *                          Industry filter pills (one per distinct value
 *                          present in the index, lightweight stand-in for
 *                          erp.intuit.com's "Resource Center" nav's
 *                          Industries menu — not a full rebuild of it)
 *                          filters this client-side; no page reload/index
 *                          re-fetch on click.
 *   .recommended           fixed set of 3, excludes the current page (used
 *                          on case-study detail pages).
 * CSS: blocks/case-study-cards/case-study-cards.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const INDEX_PATH = '/blog/case-study/query-index.json';
const PAGE_SIZE = 6;

// "PROFESSIONAL SERVICES" -> "Professional services", for pill labels —
// the underlying Industry metadata stays uppercase (matches this site's
// existing eyebrow/badge convention), this is display-only.
function toSentenceCase(value) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function cardHTML(item, featured) {
  const card = document.createElement('a');
  card.className = featured ? 'case-study-card featured' : 'case-study-card';
  card.href = item.path;
  const picWrap = document.createElement('div');
  picWrap.className = 'case-study-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title, false, [{ width: featured ? '750' : '400' }]));
  }
  const body = document.createElement('div');
  body.className = 'case-study-card-body';
  body.innerHTML = `
    <p class="eyebrow">Case study</p>
    <h3>${item.title}</h3>
    <p class="case-study-card-date">${formatDate(item.date)}</p>`;
  card.append(picWrap, body);
  return card;
}

export default async function decorate(block) {
  const recommended = block.classList.contains('recommended');
  block.textContent = '';

  const allItems = [...await loadIndex(INDEX_PATH)]
    .filter((item) => item.path !== window.location.pathname)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (recommended) {
    const grid = document.createElement('div');
    grid.className = 'case-study-grid';
    block.append(grid);
    allItems.slice(0, 3).forEach((item) => grid.append(cardHTML(item, false)));
    return;
  }

  const industries = [...new Set(allItems.map((item) => item.industry).filter(Boolean))].sort();
  let activeIndustry = 'All';

  const grid = document.createElement('div');
  grid.className = 'case-study-grid';

  const loadMoreWrap = document.createElement('div');
  loadMoreWrap.className = 'case-study-load-more';
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'button secondary';
  loadMoreBtn.textContent = 'Load More';
  loadMoreWrap.append(loadMoreBtn);

  let shown = 0;
  let filteredItems = allItems;
  const renderNext = () => {
    filteredItems.slice(shown, shown + PAGE_SIZE).forEach((item, i) => {
      grid.append(cardHTML(item, shown === 0 && i < 2));
    });
    shown += PAGE_SIZE;
    // hide the wrapper, not the button: button.button's specificity beats
    // the UA [hidden] rule, so a hidden button would still render visible
    loadMoreWrap.hidden = shown >= filteredItems.length;
  };
  const renderGrid = () => {
    grid.textContent = '';
    shown = 0;
    filteredItems = activeIndustry === 'All'
      ? allItems
      : allItems.filter((item) => item.industry === activeIndustry);
    renderNext();
  };
  loadMoreBtn.addEventListener('click', renderNext);

  if (industries.length > 1) {
    const filterBar = document.createElement('div');
    filterBar.className = 'case-study-filter';
    const makePill = (value, label) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'case-study-filter-pill';
      pill.textContent = label;
      pill.setAttribute('aria-pressed', value === activeIndustry ? 'true' : 'false');
      pill.addEventListener('click', () => {
        activeIndustry = value;
        [...filterBar.children].forEach((p) => p.setAttribute('aria-pressed', p === pill ? 'true' : 'false'));
        renderGrid();
      });
      return pill;
    };
    filterBar.append(makePill('All', 'All'));
    industries.forEach((industry) => {
      filterBar.append(makePill(industry, toSentenceCase(industry)));
    });
    block.append(filterBar);
  }

  block.append(grid, loadMoreWrap);
  renderGrid();
}
