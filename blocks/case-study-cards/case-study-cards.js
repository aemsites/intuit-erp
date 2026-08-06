/**
 * Case Study Cards
 * Fetches from a query-index JSON endpoint and renders a card grid with an
 * optional heading + "See all" CTA button in the block header.
 *
 * Authored config (key | value rows):
 *   heading  | Hear from our customers        (optional)
 *   link     | <a href="/blog/case-study">See all</a>  (optional)
 *   index    | /blog/case-study/query-index.json       (optional)
 *   limit    | 3                                       (optional, defaults to 5)
 */

import { readBlockConfig } from '../../scripts/aem.js';

const DEFAULT_INDEX = '/blog/case-study/query-index.json';
const DEFAULT_LIMIT = 5;

function parseDate(str) {
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function buildCard({
  path, title, image, date,
}) {
  const card = document.createElement('a');
  card.className = 'case-study-card';
  card.href = path;

  const imageWrap = document.createElement('div');
  imageWrap.className = 'case-study-card-image';
  if (image) {
    const src = new URL(image, window.location.origin);
    src.searchParams.set('width', '600');
    src.searchParams.set('format', 'webp');
    src.searchParams.set('optimize', 'medium');
    const img = document.createElement('img');
    img.src = src.toString();
    img.alt = title;
    img.loading = 'lazy';
    imageWrap.append(img);
  }

  const body = document.createElement('div');
  body.className = 'case-study-card-body';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'case-study-card-eyebrow';
  eyebrow.textContent = 'Case Study';
  body.append(eyebrow);

  const titleEl = document.createElement('h3');
  titleEl.className = 'case-study-card-title';
  titleEl.textContent = title;
  body.append(titleEl);

  if (date) {
    const dateEl = document.createElement('p');
    dateEl.className = 'case-study-card-date';
    dateEl.textContent = date;
    body.append(dateEl);
  }

  card.append(imageWrap, body);
  return card;
}

export default async function decorate(block) {
  // Extract the authored link element before readBlockConfig drops the DOM
  const linkEl = block.querySelector(':scope > div > div:last-child a');
  const linkHref = linkEl?.href;
  const linkText = linkEl?.textContent?.trim() || 'See all';

  const config = readBlockConfig(block);
  const indexUrl = config.index || DEFAULT_INDEX;
  const limit = parseInt(config.limit, 10) || DEFAULT_LIMIT;
  block.textContent = '';

  // Header row — heading + optional CTA button
  if (config.heading || linkHref) {
    const header = document.createElement('div');
    header.className = 'case-study-cards-header';

    if (config.heading) {
      const h2 = document.createElement('h2');
      h2.className = 'case-study-cards-heading';
      h2.textContent = config.heading;
      header.append(h2);
    }

    if (linkHref) {
      const btn = document.createElement('a');
      btn.className = 'case-study-cards-cta';
      btn.href = linkHref;
      btn.textContent = linkText;
      header.append(btn);
    }

    block.append(header);
  }

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

  const grid = document.createElement('div');
  grid.className = 'case-study-cards-grid';
  items.forEach((entry) => grid.append(buildCard(entry)));
  block.append(grid);
}
