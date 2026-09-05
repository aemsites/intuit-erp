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
 *   items     | <links>     (optional; curated set, in order — any articles)
 */

import { readBlockConfig } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';
import { orderRailItems } from '../../scripts/rail-select.js';

const INDEX_URL = '/blog/query-index.json';
const DEFAULT_LIMIT = 5;
const PAGE_SIZE = 3;

function buildCard({
  path, title, image, category, date,
}) {
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
  img.loading = 'lazy';

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

  // thumbnail + body wrappers (display:contents — no layout change) carry the
  // `image` / `qrc_content_card_content` trail slots so each fires its own beacon
  // (#769): a click on the thumbnail vs. the body text reports a distinct slot.
  const imageWrap = document.createElement('span');
  imageWrap.className = 'related-blogs-image';
  imageWrap.append(img);
  const contentSlot = document.createElement('span');
  contentSlot.className = 'related-blogs-content-slot';
  contentSlot.append(body);
  a.append(imageWrap, contentSlot);

  return a;
}

export default async function decorate(block) {
  const config = readBlockConfig(block);
  const category = (config.category || '').toLowerCase();
  const limit = parseInt(config.limit, 10) || DEFAULT_LIMIT;
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

  const valid = (data || []).filter((entry) => entry.image && entry.title && entry.path);
  const pool = valid.filter((entry) => !category || entry.category?.toLowerCase() === category);

  // Default: newest-first (unchanged). An authored `items` list curates the
  // exact articles to show, in order (any articles); see rail-select.js.
  const items = orderRailItems({ pool, all: valid, items: config.items }).slice(0, limit);

  if (!items.length) { block.remove(); return; }

  items.forEach((entry, i) => {
    const card = buildCard(entry);
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

  // Click tracking: card = qrc_content_card; thumbnail + body each fire their own
  // beacon (#769) — the thumbnail an `image` (no link_name, as prod), the body a
  // `qrc_content_card_content` slot (keeps link_name). "Load more" is skipped.
  trackAs('qrc_content_card_grid', block, {
    key: 'related-blogs',
    linkName: false,
    action: 'engaged',
    skip: '.related-blogs-load-more',
    items: {
      '.related-blogs-card': 'qrc_content_card',
      '.related-blogs-image': 'image',
      '.related-blogs-content-slot': 'qrc_content_card_content',
    },
    // the body slot keeps its link_name here (prod does on this rail — though prod
    // truncates it to ~47 chars; we emit the full, richer value).
    alsoTrack: {
      '.related-blogs-image img': 'button',
      '.related-blogs-body': { as: 'button', linkName: true },
    },
  });
}
