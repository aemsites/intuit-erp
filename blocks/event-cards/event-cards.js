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
 *
 * date/time/location/speakers are all optional and rendered as labelled rows
 * only when authored, so an evergreen webinar and a dated conference can share
 * the same grid.
 *
 * When a bucket has more events than fit in one row, the grid becomes a
 * one-row-per-page carousel (arrows + dots), same mechanics as
 * blocks/stat-band's carousel — paged by whole rows via a single
 * translateX(-100%) per page, no per-card scroll.
 * CSS: blocks/event-cards/event-cards.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex, formatDate } from '../../scripts/content-index.js';

const INDEX_PATH = '/events/query-index.json';

function eventsPerView() {
  return window.innerWidth <= 900 ? 1 : 3;
}

function buildCarousel(block, track) {
  const viewport = document.createElement('div');
  viewport.className = 'events-viewport';
  track.before(viewport);
  viewport.append(track);

  const dots = document.createElement('div');
  dots.className = 'events-dots';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'events-arrow prev';
  prevBtn.setAttribute('aria-label', 'Previous events');
  prevBtn.textContent = '‹';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'events-arrow next';
  nextBtn.setAttribute('aria-label', 'Next events');
  nextBtn.textContent = '›';
  const nav = document.createElement('div');
  nav.className = 'events-nav';
  nav.append(prevBtn, nextBtn);
  const controls = document.createElement('div');
  controls.className = 'events-controls';
  controls.append(dots, nav);
  block.append(controls);

  const cards = [...track.children];
  let perView = eventsPerView();
  let totalGroups = Math.ceil(cards.length / perView);
  let current = 0;

  function updateDots() {
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === current));
  }

  function updateButtons() {
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= totalGroups - 1;
  }

  // one page (perView cards + gaps) always spans exactly the track's own box
  // width, so translateX(-100%) per page is exact with no layout read.
  function applyTransform() {
    track.style.transform = `translateX(-${current * 100}%)`;
  }

  function goTo(idx) {
    current = Math.max(0, Math.min(idx, totalGroups - 1));
    applyTransform();
    updateDots();
    updateButtons();
  }

  function buildDots() {
    dots.innerHTML = '';
    for (let i = 0; i < totalGroups; i += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.setAttribute('aria-label', `Go to events group ${i + 1} of ${totalGroups}`);
      dot.addEventListener('click', () => goTo(i));
      dots.append(dot);
    }
    updateDots();
  }

  function syncLayout() {
    const next = eventsPerView();
    if (next !== perView) {
      perView = next;
      block.style.setProperty('--cards-per-view', perView);
      totalGroups = Math.ceil(cards.length / perView);
      if (current > totalGroups - 1) current = totalGroups - 1;
      buildDots();
      updateButtons();
    }
    applyTransform();
  }

  block.style.setProperty('--cards-per-view', perView);
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  window.addEventListener('resize', syncLayout);

  buildDots();
  updateButtons();
  requestAnimationFrame(applyTransform);
}

/** One "Label: value" detail row, matching the original's bold-label layout. */
function detailRow(label, value) {
  const p = document.createElement('p');
  p.className = 'event-card-detail';
  const strong = document.createElement('strong');
  strong.textContent = label;
  p.append(strong, `: ${value}`);
  return p;
}

function cardHTML(item) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const picWrap = document.createElement('div');
  picWrap.className = 'event-card-image';
  if (item.image) {
    picWrap.append(createOptimizedPicture(item.image, item.title, false, [{ width: '750' }]));
  }

  const body = document.createElement('div');
  body.className = 'event-card-body';

  if (item.type) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'event-card-type';
    eyebrow.textContent = item.type;
    body.append(eyebrow);
  }

  const title = document.createElement('h3');
  title.textContent = item.title;
  body.append(title);

  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'event-card-description';
    desc.textContent = item.description;
    body.append(desc);
  }

  // only the fields this event actually authored, in the original's order
  const details = [
    ['Date', item.date && formatDate(item.date)],
    ['Time', item.time],
    ['Location', item.location],
    ['Speaker', item.speakers],
  ].filter(([, value]) => value && String(value).trim());

  if (details.length) {
    const wrap = document.createElement('div');
    wrap.className = 'event-card-details';
    details.forEach(([label, value]) => wrap.append(detailRow(label, value)));
    body.append(wrap);
  }

  if (item.ctaUrl && item.ctaLabel) {
    const cta = document.createElement('a');
    cta.className = 'button secondary';
    cta.href = item.ctaUrl;
    cta.textContent = item.ctaLabel;
    if (/^https?:\/\//.test(item.ctaUrl)) {
      cta.target = '_blank';
      cta.rel = 'noopener';
    }
    body.append(cta);
  }

  card.append(picWrap, body);
  return card;
}

export default async function decorate(block) {
  const wantsOnDemand = block.classList.contains('on-demand');
  const status = wantsOnDemand ? 'on-demand' : 'upcoming';
  block.textContent = '';

  // an untitled row is not a real event (e.g. the /events listing page, which
  // the index glob picks up) — a status default would otherwise show it as blank
  const items = [...await loadIndex(INDEX_PATH)]
    .filter((item) => item.title && item.title.trim())
    .filter((item) => (item.status || 'upcoming').trim() === status)
    .sort((a, b) => (wantsOnDemand
      ? new Date(b.date) - new Date(a.date)
      : new Date(a.date) - new Date(b.date)));

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  items.forEach((item) => grid.append(cardHTML(item)));
  block.append(grid);

  if (items.length > eventsPerView()) {
    grid.classList.add('events-track');
    buildCarousel(block, grid);
  }
}
