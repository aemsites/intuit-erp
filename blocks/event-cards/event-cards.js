/**
 * event-cards — auto-populated grid of events, driven entirely by
 * /events/query-index.json (see helix-query.yaml). Each event is authored as
 * a DA structured-content document under /events/ (see
 * docs.da.live/developers/guides/structured-content) — publishing one is
 * enough to make it appear here, no block config, no authored rows.
 *
 * Variants (status field on the structured-content doc selects the bucket):
 *   .upcoming    events with status "upcoming", soonest first
 *   .on-demand   events with status "on-demand", newest first
 * CSS: blocks/event-cards/event-cards.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const INDEX_PATH = '/events/query-index.json';

function cardHTML(item) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const picWrap = document.createElement('div');
  picWrap.className = 'event-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title, false, [{ width: '400' }]));
  }
  if (item.type) {
    const badge = document.createElement('span');
    badge.className = 'event-card-badge';
    badge.textContent = item.type;
    picWrap.append(badge);
  }

  const body = document.createElement('div');
  body.className = 'event-card-body';

  const meta = [item.date && formatDate(item.date), item.time, item.location]
    .filter(Boolean)
    .join(' · ');

  body.innerHTML = `
    <h3>${item.title}</h3>
    ${meta ? `<p class="event-card-meta">${meta}</p>` : ''}
    ${item.description ? `<p class="event-card-description">${item.description}</p>` : ''}
    ${item.speakers ? `<p class="event-card-speakers">${item.speakers}</p>` : ''}`;

  if (item.ctaUrl && item.ctaLabel) {
    const cta = document.createElement('a');
    cta.className = 'button secondary';
    cta.href = item.ctaUrl;
    cta.textContent = item.ctaLabel;
    if (/^https?:\/\//.test(item.ctaUrl)) cta.target = '_blank';
    if (cta.target === '_blank') cta.rel = 'noopener';
    body.append(cta);
  }

  card.append(picWrap, body);
  return card;
}

export default async function decorate(block) {
  const wantsOnDemand = block.classList.contains('on-demand');
  const status = wantsOnDemand ? 'on-demand' : 'upcoming';
  block.textContent = '';

  const items = [...await loadIndex(INDEX_PATH)]
    .filter((item) => (item.status || 'upcoming').trim() === status)
    .sort((a, b) => (wantsOnDemand
      ? new Date(b.date) - new Date(a.date)
      : new Date(a.date) - new Date(b.date)));

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  items.forEach((item) => grid.append(cardHTML(item)));
  block.append(grid);
}
