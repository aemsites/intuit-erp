/**
 * event-spotlight — a single, personalized event detail, driven entirely by
 * /events/query-index.json (same source/fields as blocks/event-cards). No
 * authored rows, no block config.
 *
 * Personalization: to enable it, author ALL THREE on the SECTION (never the
 * block — an AEM block's content schema may strip arbitrary attributes):
 * data-pzn="<access-point-name>", data-pzn-block="event-spotlight" (scopes
 * the slot to this block), and data-pzn-block-type="content-personalisation"
 * (the generic marker scripts/experience.js's collectSlots/applyPznSlot look
 * for). With all three present, the experience layer stamps
 * data-pzn-resolved-id — a query-index `path`, not a content fragment — onto
 * this block instead of swapping its DOM. Without data-pzn authored at all,
 * this block is never queried and simply falls back to the soonest upcoming
 * event — personalization is opt-in per page, not automatic.
 *
 * Layout matches blocks/events (image + body), field mapping matches
 * blocks/event-cards (query-index camelCase fields incl. `time`).
 * CSS: blocks/event-spotlight/event-spotlight.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';
import { trackAs } from '../../scripts/tracking.js';

const INDEX_PATH = '/events/query-index.json';

function detailRow(label, value) {
  const p = document.createElement('p');
  p.className = 'event-spotlight-field';
  const strong = document.createElement('strong');
  strong.textContent = label;
  p.append(strong, `: ${value}`);
  return p;
}

function renderEvent(block, item) {
  block.textContent = '';

  if (item.image) {
    const imageWrap = document.createElement('div');
    imageWrap.className = 'event-spotlight-image';
    imageWrap.append(createOptimizedPicture(item.image, item.title || '', false, [{ width: '600' }]));
    block.append(imageWrap);
  }

  const body = document.createElement('div');
  body.className = 'event-spotlight-body';

  if (item.type) {
    const type = document.createElement('p');
    type.className = 'event-spotlight-type';
    type.textContent = item.type;
    body.append(type);
  }

  if (item.title) {
    const title = document.createElement('h2');
    title.className = 'event-spotlight-title';
    title.textContent = item.title;
    body.append(title);
  }

  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'event-spotlight-description';
    desc.textContent = item.description;
    body.append(desc);
  }

  // only the fields this event actually authored, matching event-cards' field order
  const fields = [
    ['Date', item.date && formatDate(item.date)],
    ['Time', item.time],
    ['Location', item.location],
    ['Speaker', item.speakers],
  ].filter(([, value]) => value && String(value).trim());

  if (fields.length) {
    const fieldList = document.createElement('div');
    fieldList.className = 'event-spotlight-fields';
    fields.forEach(([label, value]) => fieldList.append(detailRow(label, value)));
    body.append(fieldList);
  }

  if (item.ctaUrl && item.ctaLabel) {
    const cta = document.createElement('a');
    cta.className = 'button';
    cta.href = item.ctaUrl;
    cta.textContent = item.ctaLabel;
    if (/^https?:\/\//.test(item.ctaUrl)) {
      cta.target = '_blank';
      cta.rel = 'noopener';
    }
    body.append(cta);
  }

  block.append(body);
}

// Soonest upcoming event (by date; undated evergreen items sort last), matching
// event-cards' default (non on-demand) bucket/sort logic.
function soonestUpcoming(items) {
  const upcoming = items
    .filter((item) => item.title && item.title.trim())
    .filter((item) => (item.status || 'upcoming').trim() === 'upcoming')
    .filter((item) => {
      if (!item.date || !String(item.date).trim()) return true;
      const when = new Date(item.date);
      if (Number.isNaN(when.getTime())) return true;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return when >= startOfToday;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return upcoming[0];
}

export default async function decorate(block) {
  const resolvedId = block.dataset.pznResolvedId;
  const items = [...await loadIndex(INDEX_PATH)];

  const chosen = (resolvedId && items.find((item) => item.path === resolvedId))
    || soonestUpcoming(items);

  if (!chosen) {
    block.remove();
    return undefined;
  }

  renderEvent(block, chosen);

  return trackAs('event-spotlight', block, { key: 'event-spotlight' });
}
