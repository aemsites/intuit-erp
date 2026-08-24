/**
 * blog-cards — card grid/carousel/pagination driven by a query-index feed.
 * Configured via key/value rows (readBlockConfig):
 *   source    query-index path (default /blog/query-index.json)
 *   category  match value(s), comma-separated, OR'd
 *   author    match value(s), comma-separated, OR'd
 *   tags      match value(s), comma-separated, OR'd against the entry's own
 *             comma-separated tags — for cross-category groupings (e.g. an
 *             "automation" tag spanning construction/operations/accounting)
 *   template  match value(s), comma-separated, e.g. "Case Study"
 *   limit     max cards; for variant=paginated, page size (default 6)
 *   variant   grid (default) | carousel | paginated
 *   exclude   "current" excludes this page, or a literal path
 *   filter    field name (e.g. "industry") to build client-side pills from
 *
 * `featured` block class: first 2 cards render bigger, re-evaluated against
 * whatever's currently active (full set or the selected pill).
 *
 * Listing pages (blog home/category/search/author) are dropped via
 * `template`, never by URL shape. Results are always newest-first.
 * .carousel delegates to blocks/carousel/carousel.js, CSS loaded on demand.
 *
 * CSS: blocks/blog-cards/blog-cards.css
 */
import { readBlockConfig, loadCSS, createOptimizedPicture } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const DEFAULT_SOURCE = '/blog/query-index.json';
const DEFAULT_PAGE_SIZE = 6;

// Non-content template values — always excluded, regardless of filters.
const LISTING_TEMPLATES = new Set(['blog home', 'category', 'search', 'author']);

function isListingPage(entry) {
  return LISTING_TEMPLATES.has((entry.template || '').trim().toLowerCase());
}

// "a, b, c" or ["a", "b"] -> ["a", "b", "c"]; anything else -> []
function toList(value) {
  if (Array.isArray(value)) return value.map((v) => `${v}`.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function normalizeTag(value) {
  return value.toLowerCase().replace(/-/g, ' ').trim();
}

/**
 * Pure filter/sort/limit over query-index entries. category/author/tags/
 * template are OR'd within a field, AND'd across fields, matched
 * case-insensitively for tags and template (tags also ignore hyphen vs.
 * space). Always drops listing pages, sorts newest-first.
 */
export function filterEntries(entries, {
  category, author, tags, template, limit, excludePath,
} = {}) {
  const categories = toList(category);
  const authors = toList(author);
  const requestedTags = toList(tags).map(normalizeTag);
  const templates = toList(template).map((t) => t.toLowerCase());
  let out = entries.filter((entry) => entry.title && !isListingPage(entry));
  if (categories.length) {
    out = out.filter((entry) => toList(entry.category).some((c) => categories.includes(c)));
  }
  if (authors.length) out = out.filter((entry) => authors.includes(entry.author));
  if (requestedTags.length) {
    out = out.filter((entry) => toList(entry.tags)
      .some((t) => requestedTags.includes(normalizeTag(t))));
  }
  if (templates.length) {
    out = out.filter((entry) => templates.includes((entry.template || '').trim().toLowerCase()));
  }
  if (excludePath) out = out.filter((entry) => entry.path !== excludePath);
  out = [...out].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

// Eyebrow label: entry's own category, else the /blog/<category>/<slug> path segment.
export function categoryLabel(entry) {
  const segments = (entry.path || '').split('/').filter(Boolean);
  const fromPath = segments.length > 2 ? segments[1] : '';
  const primary = toList(entry.category)[0] || fromPath;
  return (primary || '').replace(/-/g, ' ');
}

// Card: image, category, title, date. Untrusted feed data — no innerHTML.
export function cardEl(entry, featured = false) {
  const card = document.createElement('a');
  card.className = featured ? 'blog-card featured' : 'blog-card';
  card.href = entry.path || '#';

  const imageWrap = document.createElement('div');
  imageWrap.className = 'blog-card-image';
  if (entry.image) {
    imageWrap.append(createOptimizedPicture(entry.image, entry.title || '', false, [
      { width: featured ? '750' : '400' },
    ]));
  }

  const body = document.createElement('div');
  body.className = 'blog-card-body';

  const categoryText = categoryLabel(entry);
  if (categoryText) {
    const category = document.createElement('p');
    category.className = 'blog-card-category';
    category.textContent = categoryText;
    body.append(category);
  }

  const title = document.createElement('h3');
  title.className = 'blog-card-title';
  title.textContent = entry.title || '';
  body.append(title);

  const dateText = formatDate(entry.date);
  if (dateText) {
    const date = document.createElement('p');
    date.className = 'blog-card-date';
    date.textContent = dateText;
    body.append(date);
  }

  card.append(imageWrap, body);
  return card;
}

function emptyStateEl() {
  const p = document.createElement('p');
  p.className = 'blog-cards-empty';
  p.textContent = 'No articles found.';
  return p;
}

function resolveExcludePath(value) {
  if (!value) return undefined;
  return value.startsWith('/') ? value : window.location.pathname;
}

// Sorted, deduped, non-empty values of `field` across entries.
export function distinctValues(entries, field) {
  return [...new Set(entries.map((entry) => entry[field]).filter(Boolean))].sort();
}

// Wraps cards as carousel slides; loads carousel.js/css on demand.
async function renderCarousel(container, cards) {
  container.textContent = '';
  loadCSS(`${window.hlx.codeBasePath}/blocks/carousel/carousel.css`);
  const { default: carouselDecorate } = await import('../carousel/carousel.js');

  const wrapper = document.createElement('div');
  wrapper.className = 'carousel cards';
  cards.forEach((card) => {
    const slide = document.createElement('div');
    slide.append(card);
    wrapper.append(slide);
  });
  container.append(wrapper);
  carouselDecorate(wrapper);
}

function renderGrid(container, cards) {
  container.textContent = '';
  const grid = document.createElement('div');
  grid.className = 'blog-cards-grid';
  grid.append(...cards);
  container.append(grid);
}

// Grid + "Load More", revealing pageSize pre-built cards per click.
function renderPaginatedGrid(container, cards, pageSize) {
  container.textContent = '';
  const grid = document.createElement('div');
  grid.className = 'blog-cards-grid';

  const loadMoreWrap = document.createElement('div');
  loadMoreWrap.className = 'blog-cards-load-more';
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'button secondary';
  loadMoreBtn.textContent = 'Load More';
  loadMoreWrap.append(loadMoreBtn);

  let shown = 0;
  const renderNext = () => {
    cards.slice(shown, shown + pageSize).forEach((card) => grid.append(card));
    shown += pageSize;
    loadMoreWrap.hidden = shown >= cards.length;
  };
  loadMoreBtn.addEventListener('click', renderNext);

  container.append(grid, loadMoreWrap);
  renderNext();
}

// "product-update" -> "Product Update" — display only, matching doesn't change.
function pillLabel(value) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// "All" + one pill per distinct value; click re-renders client-side, no re-fetch.
function buildPillBar(entries, field, onChange) {
  const values = distinctValues(entries, field);
  if (values.length < 2) return null;

  const bar = document.createElement('div');
  bar.className = 'blog-cards-filter';
  let active = 'All';

  const makePill = (value, label) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'blog-cards-filter-pill';
    pill.textContent = label;
    pill.setAttribute('aria-pressed', value === active ? 'true' : 'false');
    pill.addEventListener('click', () => {
      active = value;
      [...bar.children].forEach((p) => p.setAttribute('aria-pressed', p === pill ? 'true' : 'false'));
      onChange(value === 'All' ? entries : entries.filter((entry) => entry[field] === value));
    });
    return pill;
  };

  bar.append(makePill('All', 'All'));
  values.forEach((value) => bar.append(makePill(value, pillLabel(value))));
  return bar;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const config = readBlockConfig(block);
  const isPaginated = config.variant === 'paginated';
  const isFeatured = block.classList.contains('featured');
  block.textContent = '';

  const source = config.source || DEFAULT_SOURCE;
  const limit = config.limit ? parseInt(config.limit, 10) : undefined;
  const excludePath = resolveExcludePath(config.exclude);

  const entries = await loadIndex(source);
  // paginated: keep the full matching set, limit becomes page size below
  const filtered = filterEntries(entries, {
    category: config.category || undefined,
    author: config.author || undefined,
    tags: config.tags || undefined,
    template: config.template || undefined,
    limit: isPaginated ? undefined : limit,
    excludePath,
  });

  if (!filtered.length) {
    block.append(emptyStateEl());
    return;
  }

  const contentArea = document.createElement('div');
  contentArea.className = 'blog-cards-content';

  const renderEntries = async (activeEntries) => {
    const cards = activeEntries.map((entry, i) => cardEl(entry, isFeatured && i < 2));
    if (config.variant === 'carousel') {
      await renderCarousel(contentArea, cards);
    } else if (isPaginated) {
      renderPaginatedGrid(contentArea, cards, limit || DEFAULT_PAGE_SIZE);
    } else {
      renderGrid(contentArea, cards);
    }
    // (re)stamp on the freshly rendered cards (survives filter re-renders): the
    // card = qrc_content_card, its thumbnail = a distinct `image` beacon (#769).
    trackAs('dynamic_category_container', block, {
      key: 'dynamic_category_container',
      linkName: false,
      items: {
        '.blog-cards-grid, .carousel.cards': 'qrc_content_card_grid',
        '.blog-card': 'qrc_content_card',
        '.blog-card-image': 'image',
      },
      alsoTrack: { '.blog-card-image img': 'button' },
    });
  };

  if (config.filter) {
    const pillBar = buildPillBar(filtered, config.filter, renderEntries);
    if (pillBar) block.append(pillBar);
  }

  block.append(contentArea);
  await renderEntries(filtered);
}
