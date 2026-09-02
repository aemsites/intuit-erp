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
 * A post whose hero is a video (`hero-video-url` in the index) renders a play
 * badge on its thumbnail and plays it in this block's own lightbox.
 *
 * CSS: blocks/blog-cards/blog-cards.css
 */
import { readBlockConfig, loadCSS, createOptimizedPicture } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';
import { loadIndex, formatDate, normalizePath } from '../../scripts/content-index.js';
import { videoInfo, posterFor } from '../video/video-info.js';

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

// /blog/<folder>/<slug> -> "<folder>"; listing pages (fewer segments) have none.
function folderSegment(path) {
  const segments = (path || '').split('/').filter(Boolean);
  return segments.length > 2 ? segments[1] : '';
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
    // A post's own folder counts as an implicit tag, so a landing page filtering
    // `tags: <folder>` lists its home posts without every one needing that tag.
    out = out.filter((entry) => {
      const own = toList(entry.tags).map(normalizeTag);
      const folder = normalizeTag(folderSegment(entry.path));
      if (folder) own.push(folder);
      return requestedTags.some((t) => own.includes(t));
    });
  }
  if (templates.length) {
    out = out.filter((entry) => templates.includes((entry.template || '').trim().toLowerCase()));
  }
  if (excludePath) {
    const exclude = normalizePath(excludePath);
    out = out.filter((entry) => normalizePath(entry.path) !== exclude);
  }
  out = [...out].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

// Eyebrow label: entry's own category, else the /blog/<category>/<slug> path segment.
export function categoryLabel(entry) {
  const primary = toList(entry.category)[0] || folderSegment(entry.path);
  return (primary || '').replace(/-/g, ' ');
}

/**
 * The listing player's URL. videoInfo's embedUrl already carries autoplay+rel;
 * the source listing adds modestbranding + enablejsapi, which are YouTube-only
 * params, so a Vimeo card keeps its own embed URL unchanged.
 * @param {{provider:string, embedUrl:string}} info videoInfo() result
 * @returns {string}
 */
function playerUrl(info) {
  if (info.provider !== 'youtube') return info.embedUrl;
  return `${info.embedUrl}&modestbranding=1&enablejsapi=1`;
}

/**
 * Opens a card's video in a dismissible lightbox (fixed, centered, dimmed page,
 * autoplay iframe), matching the source listing's modal. Escape and a click on
 * the backdrop close it; focus moves to the close button and returns to the
 * opener on dismiss.
 *
 * Deliberately block-local rather than imported from blocks/video: a block owns
 * its own behaviour *and* its stylesheet, and importing another block's module
 * does not load that block's CSS (the overlay rendered unstyled). The markup is
 * small, so blog-cards carries its own copy — same call as carousel.js makes.
 * @param {string} src provider embed URL (autoplay)
 * @param {string} title accessible iframe title
 */
function openVideoLightbox(src, title) {
  // guard against a double-click stacking two overlays
  if (document.querySelector('.blog-card-video-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'blog-card-video-overlay';

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = title || 'Video';
  // the source player's permission set
  iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  const frame = document.createElement('div');
  frame.className = 'blog-card-video-frame';
  frame.append(iframe);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'blog-card-video-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';

  const modal = document.createElement('div');
  modal.className = 'blog-card-video-modal';
  modal.append(close, frame);
  overlay.append(modal);

  const opener = document.activeElement;
  function dismiss() {
    overlay.remove();
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('keydown', onKey);
    if (opener && opener.focus) opener.focus();
  }
  function onKey(e) { if (e.key === 'Escape') dismiss(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  close.focus();
}

// Card: image, category, title, date. Untrusted feed data — no innerHTML.
export function cardEl(entry, featured = false) {
  // Posts whose hero is a video carry `hero-video-url` in the query index
  // (indexed off the authored hero link): the thumbnail gets a play badge and
  // opens the video in a lightbox, matching the source listing.
  const info = videoInfo((entry['hero-video-url'] || '').trim());

  // A video card mirrors the source listing's structure: the thumbnail is the
  // play control and only the body links to the article, so the control is a
  // *sibling* of the link — a focusable control nested in an <a> is invalid and
  // unreachable by keyboard. A normal card stays one <a> around everything.
  const card = document.createElement(info ? 'div' : 'a');
  card.className = featured ? 'blog-card featured' : 'blog-card';
  if (info) card.classList.add('has-video');
  else card.href = entry.path || '#';

  const imageWrap = document.createElement('div');
  imageWrap.className = 'blog-card-image';
  // a video post with no authored image falls back to the provider thumbnail
  const poster = info ? posterFor(info, entry.image) : entry.image;
  if (poster) {
    imageWrap.append(createOptimizedPicture(poster, entry.title || '', false, [
      { width: featured ? '750' : '400' },
    ]));
  }

  if (info) {
    imageWrap.setAttribute('role', 'button');
    imageWrap.setAttribute('tabindex', '0');
    imageWrap.setAttribute('aria-label', entry.title ? `Play video: ${entry.title}` : 'Play video');
    const play = document.createElement('span');
    play.className = 'blog-card-play';
    play.setAttribute('aria-hidden', 'true');
    imageWrap.append(play);
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

  // body wrapper (display:contents — no layout change) carries the content-slot
  // trail so a click on the card body fires its own beacon, distinct from the
  // thumbnail (#769).
  const contentSlot = document.createElement('span');
  contentSlot.className = 'blog-card-content-slot';
  if (info) {
    // video card: the article link wraps the body only (the thumbnail plays the
    // video), so it takes the body's place in the card's flex layout.
    const link = document.createElement('a');
    link.className = 'blog-card-link';
    link.href = entry.path || '#';
    link.append(body);
    contentSlot.append(link);
  } else {
    contentSlot.append(body);
  }
  card.append(imageWrap, contentSlot);

  // The play control sits outside the article link, so opening the lightbox
  // needs neither preventDefault (there is no navigation to cancel) nor
  // stopPropagation — the click keeps bubbling to document, which is where the
  // injected click tracker listens (CLICK-TRACKING.md). Keyboard: Enter/Space on
  // the control plays; the card link still reaches the article.
  if (info) {
    const openPlayer = () => openVideoLightbox(playerUrl(info), entry.title || '');
    imageWrap.addEventListener('click', openPlayer);
    imageWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // Space would scroll the listing
        openPlayer();
      }
    });
  }
  return card;
}

/**
 * JIT tracking payload for a video card's play control: prod reports a play as
 * video/started (ui_object=video, empty ui_object_detail), not the generic
 * content/interacted a thumbnail derives, so the tracker emits `video:started`.
 * Null for every other CTA in the block, leaving ordinary cards pure-derive.
 * @param {Element} el the resolved CTA
 * @returns {Record<string, string>|null} sheet-shaped cfg (kebab keys), or null
 */
function blogCardPayload(el) {
  if (!el.matches('.blog-card.has-video .blog-card-image')) return null;
  return {
    object: 'video',
    action: 'started',
    'ui-object': 'video',
    'ui-object-detail': '',
    'ui-action': 'clicked',
  };
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
  // display:contents wrapper carries the `button` trail leaf so the access point
  // reads …|oisp_loadmore|button (the button's own data-tracking is the skipped
  // sacrificial anchor).
  const loadMoreBtnWrap = document.createElement('span');
  loadMoreBtnWrap.className = 'blog-cards-load-more-btn';
  loadMoreBtnWrap.append(loadMoreBtn);
  loadMoreWrap.append(loadMoreBtnWrap);

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
    // card = qrc_content_card; its thumbnail fires a distinct `image` beacon (no
    // link_name, as prod) and its body a `qrc_content_card_content` slot beacon
    // (keeps link_name) (#769).
    trackAs('dynamic_category_container', block, {
      key: 'dynamic_category_container',
      linkName: false,
      items: {
        '.blog-cards-grid, .carousel.cards': 'qrc_content_card_grid',
        '.blog-card': 'qrc_content_card',
        '.blog-card-image': 'image',
        '.blog-card-content-slot': 'qrc_content_card_content',
        '.blog-cards-load-more': 'oisp_loadmore',
        '.blog-cards-load-more-btn': 'button',
      },
      // both slots omit link_name here — prod does on the blog index grid (it
      // keeps a truncated one only on the related-blogs rail, see that block).
      // A video card's poster is deliberately NOT a part: payload derivers don't
      // run for parts, so the click must resolve to the role=button wrapper for
      // blogCardPayload to stamp video/started.
      alsoTrack: {
        '.blog-card:not(.has-video) .blog-card-image img': 'button',
        '.blog-card-body': 'button',
      },
      payload: blogCardPayload,
    });
  };

  if (config.filter) {
    const pillBar = buildPillBar(filtered, config.filter, renderEntries);
    if (pillBar) block.append(pillBar);
  }

  block.append(contentArea);
  await renderEntries(filtered);
}
