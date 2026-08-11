/**
 * events — renders a single event detail from inline key-value content.
 *
 * Authored as a block with one row per field (key | value), matching the
 * DA structured-content `events` schema so that the same document that
 * defines an event detail page can also embed a promo anywhere on the site
 * without fetching /events/query-index.json.
 *
 * Expected fields (all optional):
 *   type, title, description, date, location, speakers, image, ctaLabel, ctaUrl
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

  // --- image ---
  if (item.image) {
    const imageWrap = document.createElement('div');
    imageWrap.className = 'event-image';
    imageWrap.append(createOptimizedPicture(item.image, item.title || '', false, [
      { width: '600' },
    ]));
    block.append(imageWrap);
  }

  // --- body ---
  const body = document.createElement('div');
  body.className = 'event-body';

  if (item.type) {
    const type = document.createElement('p');
    type.className = 'event-type';
    type.textContent = item.type;
    body.append(type);
  }

  if (item.title) {
    const title = document.createElement('h2');
    title.className = 'event-title';
    title.textContent = item.title;
    body.append(title);
  }

  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'event-description';
    desc.textContent = item.description;
    body.append(desc);
  }

  const fields = [
    item.location && { label: 'Location', value: item.location },
    item.date && { label: 'Date', value: formatDate(item.date) },
    item.speakers && { label: 'Speakers', value: item.speakers },
  ].filter(Boolean);

  if (fields.length) {
    const fieldList = document.createElement('div');
    fieldList.className = 'event-fields';
    fields.forEach(({ label, value }) => {
      const p = document.createElement('p');
      p.className = 'event-field';
      p.innerHTML = `<strong>${label}</strong>: ${value}`;
      fieldList.append(p);
    });
    body.append(fieldList);
  }

  if (item.ctaurl && item.ctalabel) {
    const cta = document.createElement('a');
    cta.className = 'button';
    cta.href = item.ctaurl;
    cta.textContent = item.ctalabel;
    if (/^https?:\/\//.test(item.ctaurl)) cta.target = '_blank';
    if (cta.target === '_blank') cta.rel = 'noopener';
    body.append(cta);
  }

  block.append(body);
}
