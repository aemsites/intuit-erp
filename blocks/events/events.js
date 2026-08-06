/**
 * events — renders a single event card from inline key-value content.
 *
 * Authored as a block with one row per field (key | value), matching the
 * DA structured-content `events` schema so that the same document that
 * defines an event detail page can also embed a card anywhere on the site
 * without fetching /events/query-index.json.
 *
 * Expected fields (all optional):
 *   type, status, title, description, date, time, location,
 *   speakers, image, ctaLabel, ctaUrl
 *
 * CSS: blocks/events/events.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { formatDate } from '../../scripts/content-index.js';

function parseBlock(block) {
  const item = {};
  [...block.children].forEach((row) => {
    const [keyCell, valueCell] = row.children;
    if (!keyCell || !valueCell) return;
    // key is the text of the heading or the cell itself
    const key = (keyCell.querySelector('h1,h2,h3,h4,h5,h6') || keyCell)
      .textContent.trim().toLowerCase();
    const value = valueCell.textContent.trim();
    if (key && value) item[key] = value;
  });
  return item;
}

export default function decorate(block) {
  const item = parseBlock(block);
  block.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'event-card';

  // --- image + badge ---
  const picWrap = document.createElement('div');
  picWrap.className = 'event-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title || '', false, [{ width: '800' }]));
  }
  if (item.type) {
    const badge = document.createElement('span');
    badge.className = 'event-card-badge';
    badge.textContent = item.type;
    picWrap.append(badge);
  }

  // --- body ---
  const body = document.createElement('div');
  body.className = 'event-card-body';

  const meta = [item.date && formatDate(item.date), item.time, item.location]
    .filter(Boolean)
    .join(' · ');

  body.innerHTML = `
    ${item.title ? `<h3>${item.title}</h3>` : ''}
    ${meta ? `<p class="event-card-meta">${meta}</p>` : ''}
    ${item.description ? `<p class="event-card-description">${item.description}</p>` : ''}
    ${item.speakers ? `<p class="event-card-speakers">${item.speakers}</p>` : ''}`;

  if (item.ctaurl && item.ctalabel) {
    const cta = document.createElement('a');
    cta.className = 'button secondary';
    cta.href = item.ctaurl;
    cta.textContent = item.ctalabel;
    if (/^https?:\/\//.test(item.ctaurl)) cta.target = '_blank';
    if (cta.target === '_blank') cta.rel = 'noopener';
    body.append(cta);
  }

  card.append(picWrap, body);
  block.append(card);
}
