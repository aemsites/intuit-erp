/**
 * Blog Rail Case Study
 * Fetches articles from a query-index JSON endpoint and renders cards.
 *
 * Mobile: 3-column grid with large image, label, title, date + "Load more" (3 at a time).
 * Desktop (≥ 900px, narrow rail): compact thumbnail-left + title-right list.
 *
 * Authored config (key | value rows):
 *   index  | /blog/case-study/query-index.json  (optional)
 *   limit  | 5                                   (optional, defaults to 5)
 */

import { readBlockConfig } from '../../scripts/aem.js';

const DEFAULT_INDEX = '/blog/case-study/query-index.json';
const DEFAULT_LIMIT = 5;
const PAGE_SIZE = 3;

function parseDate(str) {
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
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

  const items = (data || [])
    .filter((entry) => entry.image && entry.title && entry.path)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date))
    .slice(0, limit);

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
