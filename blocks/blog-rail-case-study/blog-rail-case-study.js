/**
 * Blog Rail Case Study
 * Fetches articles from a query-index JSON endpoint and renders cards.
 *
 * Mobile: 3-column grid with large image, label, title, date + "Load more" (3 at a time).
 * Desktop (≥ 900px, narrow rail): compact thumbnail-left + title-right list.
 *
 * Authored config (key | value rows):
 *   index     | /blog/case-study/query-index.json  (optional)
 *   limit     | 5                                   (optional, defaults to 5)
 *   randomize | true                                (optional; random subset vs newest-first)
 *   items     | <links to specific case studies>   (optional; curated set, in order)
 */

import { readBlockConfig } from '../../scripts/aem.js';
import { isTruthy, orderRailItems } from '../../scripts/rail-select.js';

// The blog query-index (all articles); case studies are selected by the
// `category` metadata below. A dedicated /blog/case-study/query-index.json is
// not published, so pointing at it left the block empty (fetch 404 →
// self-remove) and the rail's "Customer stories" section disappeared. An
// authored `index` config still overrides this.
const DEFAULT_INDEX = '/blog/query-index.json';
const CASE_STUDY_CATEGORY = 'case-study';
const DEFAULT_LIMIT = 5;
const PAGE_SIZE = 3;

// `category` may hold several comma-separated values (e.g. "case-study,
// food-service"), so test for membership rather than an exact match.
function hasCategory(entry, category) {
  return (entry.category || '')
    .toLowerCase()
    .split(',')
    .some((c) => c.trim() === category);
}

function categoryFromPath(path) {
  const parts = (path || '').split('/').filter(Boolean);
  const idx = parts.indexOf('blog');
  const seg = idx >= 0 ? parts[idx + 1] : '';
  return seg ? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

function buildCard({
  path, title, image, date,
}) {
  const a = document.createElement('a');
  a.href = path;
  a.className = 'blog-rail-case-study-card';

  const src = new URL(image, window.location.origin);
  src.searchParams.set('width', '400');
  src.searchParams.set('format', 'webp');
  src.searchParams.set('optimize', 'medium');
  const img = document.createElement('img');
  img.src = src.toString();
  img.alt = title;
  img.loading = 'lazy';

  const label = document.createElement('span');
  label.className = 'blog-rail-case-study-label';
  label.textContent = categoryFromPath(path);

  const titleEl = document.createElement('span');
  titleEl.className = 'blog-rail-case-study-title';
  titleEl.textContent = title;

  const body = document.createElement('div');
  body.className = 'blog-rail-case-study-body';
  body.append(label, titleEl);

  if (date) {
    const dateEl = document.createElement('span');
    dateEl.className = 'blog-rail-case-study-date';
    dateEl.textContent = date;
    body.append(dateEl);
  }

  a.append(img, body);

  return a;
}

export default async function decorate(block) {
  const config = readBlockConfig(block);
  const indexUrl = config.index || DEFAULT_INDEX;
  const limit = parseInt(config.limit, 10) || DEFAULT_LIMIT;
  const randomize = isTruthy(config.randomize);
  block.innerHTML = '';

  let data;
  try {
    const resp = await fetch(indexUrl);
    if (!resp.ok) throw new Error(resp.status);
    ({ data } = await resp.json());
  } catch {
    block.remove();
    return;
  }

  const valid = (data || []).filter((entry) => entry.image && entry.title && entry.path);
  const pool = valid.filter((entry) => hasCategory(entry, CASE_STUDY_CATEGORY));

  // Default: newest-first (unchanged). Authors may opt into a curated `items`
  // list (any articles, in order) or a `randomize` subset; see rail-select.js.
  const items = orderRailItems({
    pool, all: valid, items: config.items, randomize,
  }).slice(0, limit);

  if (!items.length) { block.remove(); return; }

  items.forEach((entry, i) => {
    const card = buildCard(entry);
    if (i >= PAGE_SIZE) card.classList.add('is-hidden');
    block.append(card);
  });

  if (items.length > PAGE_SIZE) {
    const btn = document.createElement('button');
    btn.className = 'blog-rail-case-study-load-more';
    btn.textContent = 'Load more';

    btn.addEventListener('click', () => {
      const hidden = [...block.querySelectorAll('.blog-rail-case-study-card.is-hidden')];
      hidden.slice(0, PAGE_SIZE).forEach((c) => c.classList.remove('is-hidden'));
      if (!block.querySelector('.blog-rail-case-study-card.is-hidden')) btn.remove();
    });

    block.append(btn);
  }
}
