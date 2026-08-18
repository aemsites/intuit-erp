/**
 * Related Blogs
 * Fetches from /blog/query-index.json, filters by category, and renders cards.
 *
 * Mobile: 3-column grid with large image, label, title, date + "Load more" (3 at a time).
 * Desktop (≥ 900px, narrow rail): compact thumbnail-left + title-right list.
 *
 * Authored config (key | value rows):
 *   category  | financials
 *   limit     | 5          (optional, defaults to 5)
 */

import { readBlockConfig } from '../../scripts/aem.js';

const INDEX_URL = '/blog/query-index.json';
const DEFAULT_LIMIT = 5;
const PAGE_SIZE = 3;

function parseDate(str) {
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// eager only for the first card — matches the "first item eager, rest lazy"
// fix applied to blog-cards.js/blog-rail-case-study.js/event-cards.js for the
// same query-index-driven card pattern (issue #518): a hardcoded 'lazy'
// unconditionally defers even a card that ends up being the LCP candidate.
function buildCard({
  path, title, image, category, date,
}, eager = false) {
  const a = document.createElement('a');
  a.href = path;
  a.className = 'related-blogs-card';

  const src = new URL(image, window.location.origin);
  src.searchParams.set('width', '400');
  src.searchParams.set('format', 'webp');
  src.searchParams.set('optimize', 'medium');
  const img = document.createElement('img');
  img.src = src.toString();
  img.alt = title;
  img.loading = eager ? 'eager' : 'lazy';

  const label = document.createElement('span');
  label.className = 'related-blogs-label';
  label.textContent = category
    ? category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  const titleEl = document.createElement('span');
  titleEl.className = 'related-blogs-title';
  titleEl.textContent = title;

  const body = document.createElement('div');
  body.className = 'related-blogs-body';
  body.append(label, titleEl);

  if (date) {
    const dateEl = document.createElement('span');
    dateEl.className = 'related-blogs-date';
    dateEl.textContent = date;
    body.append(dateEl);
  }

  a.append(img, body);

  return a;
}

export default async function decorate(block) {
  const config = readBlockConfig(block);
  const category = (config.category || '').toLowerCase();
  const limit = parseInt(config.limit, 10) || DEFAULT_LIMIT;
  // If a page ever stacks more than one instance, only the very first one's
  // first card can possibly be the LCP candidate (issue #518).
  const isFirstOnPage = document.querySelector('.related-blogs') === block;
  block.innerHTML = '';

  let data;
  try {
    const resp = await fetch(INDEX_URL);
    if (!resp.ok) throw new Error(resp.status);
    ({ data } = await resp.json());
  } catch {
    block.remove();
    return;
  }

  const items = (data || [])
    .filter((entry) => !category || entry.category?.toLowerCase() === category)
    .filter((entry) => entry.image && entry.title && entry.path)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date))
    .slice(0, limit);

  if (!items.length) { block.remove(); return; }

  items.forEach((entry, i) => {
    const card = buildCard(entry, isFirstOnPage && i === 0);
    if (i >= PAGE_SIZE) card.classList.add('is-hidden');
    block.append(card);
  });

  if (items.length > PAGE_SIZE) {
    const btn = document.createElement('button');
    btn.className = 'related-blogs-load-more';
    btn.textContent = 'Load more';

    btn.addEventListener('click', () => {
      const hidden = [...block.querySelectorAll('.related-blogs-card.is-hidden')];
      hidden.slice(0, PAGE_SIZE).forEach((c) => c.classList.remove('is-hidden'));
      if (!block.querySelector('.related-blogs-card.is-hidden')) btn.remove();
    });

    block.append(btn);
  }
}
