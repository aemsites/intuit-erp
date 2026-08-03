/**
 * blog-cards — dynamic card grid/carousel driven by a blog query-index JSON
 * feed (see Task 10's /blog/query-index.json and helix-query.yaml). Serves
 * the 33 category + 24 author blog listing pages, plus fixed-size
 * "recommended" grids on post detail pages — one reusable block, configured
 * per instance via authored key/value rows instead of one block per bucket.
 *
 * Authoring: each `:scope > div` row is a `key | value` config cell, parsed
 * with the shared readBlockConfig() convention (see scripts/aem.js):
 *   source    query-index path (default /blog/query-index.json)
 *   category  include entries whose `category` matches — one value or a
 *             comma-separated list, e.g. "erp, financials" (optional)
 *   author    include entries whose `author` matches — one value or a
 *             comma-separated list (optional)
 *   template  include entries whose `template` matches — one value or a
 *             comma-separated list, e.g. "Case Study" or "Research". Lets one
 *             blog index stand in for the old per-collection feeds: prefer
 *             `template: Case Study` over `source: /blog/case-study/…` (optional)
 *   limit     max number of cards to show (optional)
 *   variant   "grid" (default) or "carousel"
 *   exclude   for recommended grids — "current" (or any non-path value)
 *             excludes window.location.pathname; a value starting with "/"
 *             is used as a literal path to exclude instead
 *
 * Within category (or author) the listed values are OR'd; across the two fields
 * they are AND'd. Listing/index pages (blog home, category, search) are always
 * dropped via their `template` metadata, never by URL shape. Results are always
 * sorted newest-first.
 *
 * .carousel variant: rather than reimplement slide/dot/arrow mechanics,
 * this delegates to Task 4's blocks/carousel/carousel.js — cards are wrapped
 * in the raw `<div>` slides that block expects, its `.cards` look is reused,
 * and its stylesheet is loaded on demand (this block's own CSS file is the
 * one auto-loaded for "blog-cards", so carousel.css never arrives unless
 * asked for). Same on-demand-import pattern as blocks/download-form.js
 * reusing blocks/form/form.js.
 *
 * CSS: blocks/blog-cards/blog-cards.css
 */
import { readBlockConfig, loadCSS } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const DEFAULT_SOURCE = '/blog/query-index.json';

/**
 * The `template` values that mark a feed row as a listing/index page rather than
 * a piece of content: the blog home, the per-category pages, the search page,
 * and author pages. Article/case-study pages carry a content template instead
 * ("Blog Article", "Case Study", …). Compared case-insensitively — `template`
 * is the EDS-native page classifier (see decorateTemplateAndTheme in
 * scripts/aem.js, which slugifies it onto the <body> class).
 */
const LISTING_TEMPLATES = new Set(['blog home', 'category', 'search', 'author']);

/**
 * True for the blog home and the per-category/section/search listing pages,
 * which must never render as cards. The signal is page metadata (`template`,
 * surfaced into the feed by the `blog` index in helix-query.yaml) — not the URL
 * shape — so a page's classification travels with its content, and re-homing an
 * article to a different path depth can't silently turn a listing into a card
 * (or vice versa).
 * @param {object} entry one query-index row
 * @returns {boolean}
 */
function isListingPage(entry) {
  return LISTING_TEMPLATES.has((entry.template || '').trim().toLowerCase());
}

/**
 * Normalises a filter value that authors may supply as a single token or a
 * comma-separated list ("erp" or "erp, financials, hr") into a trimmed array.
 * Already-array values (from JS callers) pass through. Empty in → empty out.
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
function toList(value) {
  if (Array.isArray(value)) return value.map((v) => `${v}`.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Pure filter/sort/limit over query-index entries. No network, no DOM.
 * Listing pages (blog home, category/section roots) are always excluded — they
 * are navigation, never cards — regardless of the category/author filters.
 *
 * `category`, `author` and `template` each accept a single value or a
 * comma-separated list; an entry matches when its value is any of the requested
 * ones (OR within a field, AND across fields). `template` is matched
 * case-insensitively. Results are always newest-first.
 * @param {Array<object>} entries raw query-index `.data` rows
 * @param {object} opts category/author/template (string|string[]), limit, excludePath
 * @returns {Array<object>} matching entries, newest date first
 */
export function filterEntries(entries, {
  category, author, template, limit, excludePath,
} = {}) {
  const categories = toList(category);
  const authors = toList(author);
  const templates = toList(template).map((t) => t.toLowerCase());
  let out = entries.filter((entry) => entry.title && !isListingPage(entry));
  if (categories.length) out = out.filter((entry) => categories.includes(entry.category));
  if (authors.length) out = out.filter((entry) => authors.includes(entry.author));
  if (templates.length) {
    out = out.filter((entry) => templates.includes((entry.template || '').trim().toLowerCase()));
  }
  if (excludePath) out = out.filter((entry) => entry.path !== excludePath);
  out = [...out].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

/**
 * The card's eyebrow label. Prefers the entry's own `category`, falling back to
 * the category segment of `/blog/<category>/<slug>` paths — the per-collection
 * indices (e.g. /blog/case-study/query-index.json) carry no `category` column,
 * but the source site still shows an eyebrow on those cards ("CASE STUDY").
 *
 * Display-only: hyphens become spaces so slugs like "product-update" read as
 * "PRODUCT UPDATE" once CSS uppercases them (same treatment, and reason, as
 * buildEyebrow in blocks/blog-template/blog-template.js). The underlying
 * category value is untouched, so filterEntries' matching is unaffected.
 * @param {object} entry one query-index row
 * @returns {string} label, or '' when the entry has no category to show
 */
export function categoryLabel(entry) {
  const segments = (entry.path || '').split('/').filter(Boolean);
  // /blog/<category>/<slug> — anything shallower (a listing page) has no category
  const fromPath = segments.length > 2 ? segments[1] : '';
  return (entry.category || fromPath).replace(/-/g, ' ');
}

/**
 * Pure DOM builder for one card. Mirrors the source's threegrids "small" card:
 * image, then a body of category (uppercase) → title → date. No description or
 * author. Feed values are untrusted, so every field is written via
 * textContent/attribute assignment — never innerHTML.
 * @param {object} entry one query-index row (path, title, date, image, category, ...)
 * @returns {HTMLAnchorElement} `<a class="blog-card">`
 */
export function cardEl(entry) {
  const card = document.createElement('a');
  card.className = 'blog-card';
  card.href = entry.path || '#';

  const imageWrap = document.createElement('div');
  imageWrap.className = 'blog-card-image';
  if (entry.image) {
    const img = document.createElement('img');
    img.src = entry.image;
    img.alt = entry.title || '';
    img.loading = 'lazy';
    imageWrap.append(img);
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

/**
 * Wraps cards in the raw slide markup blocks/carousel/carousel.js expects
 * (each direct child `<div>` becomes one `.carousel-slide`), loads that
 * block's stylesheet on demand, and hands off interactivity to its decorate().
 */
async function renderCarousel(block, cards) {
  loadCSS(`${window.hlx.codeBasePath}/blocks/carousel/carousel.css`);
  const { default: carouselDecorate } = await import('../carousel/carousel.js');

  const wrapper = document.createElement('div');
  wrapper.className = 'carousel cards';
  cards.forEach((card) => {
    const slide = document.createElement('div');
    slide.append(card);
    wrapper.append(slide);
  });
  block.append(wrapper);
  carouselDecorate(wrapper);
}

function renderGrid(block, cards) {
  const grid = document.createElement('div');
  grid.className = 'blog-cards-grid';
  grid.append(...cards);
  block.append(grid);
}

/**
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const config = readBlockConfig(block);
  block.textContent = '';

  const source = config.source || DEFAULT_SOURCE;
  const limit = config.limit ? parseInt(config.limit, 10) : undefined;
  const excludePath = resolveExcludePath(config.exclude);

  const entries = await loadIndex(source);
  const filtered = filterEntries(entries, {
    category: config.category || undefined,
    author: config.author || undefined,
    template: config.template || undefined,
    limit,
    excludePath,
  });

  if (!filtered.length) {
    block.append(emptyStateEl());
    return;
  }

  const cards = filtered.map((entry) => cardEl(entry));

  if (config.variant === 'carousel') {
    await renderCarousel(block, cards);
  } else {
    renderGrid(block, cards);
  }
}
