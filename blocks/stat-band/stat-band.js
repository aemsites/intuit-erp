/**
 * stat-band — band of stat figures (index carousel, pricing static grid,
 * case-study "Results at a glance" callout).
 *
 * Section head (h2/h3) is authored as default content before the block.
 * Block rows = one row per stat, one flowing cell:
 *   a bold-only line for the number (e.g. "50%"), then description
 *   paragraph(s), then optionally a second bold-only line for the company
 *   name and an italic-only line for the segment tag (e.g. "CONSTRUCTION") —
 *   each field is detected by its own formatting, not by position, so
 *   company/segment can be omitted entirely with no effect on the rest.
 * default (index): number/description + attribution — paged carousel
 * .stat-band.dark (pricing "Data-backed performance"): number/description +
 *   optional attribution — static grid
 * .stat-band.simple: number/description — the same static grid as .dark, but a
 *   single bordered white box on the page background, columns split by dividers.
 * .stat-band.plain (research guide stat trios): number/description —
 *   the same static grid as .dark, but light bordered boxes on the page
 *   background instead of a navy band.
 * .stat-band.glance (case study "Results at a glance"): number/description —
 *   rendered as a plain bulleted sentence per row ("{number} {description}"),
 *   matching erp.intuit.com's results box, not a number/caption grid.
 * .stat-band.cards (research "Findings at a glance" snackable slider): each row
 *   is an image card (stat graphic + caption) in a horizontal scroller; an
 *   image-less row is the lead title card.
 * An optional trailing paragraph (foot/disclaimer) is authored as default content.
 * CSS: blocks/stat-band/stat-band.css
 */

import { BP_TABLET, BP_DESKTOP, BP_WIDE } from '../../scripts/breakpoints.js';
import { trackAs } from '../../scripts/tracking.js';

const ARROW_SVG = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>',
};

// The outcomes carousel's paging arrows report prod's `scroll left`/`scroll right` detail (+
// matching link_name), not the derived button + aria-label. Golden confirms `scroll right`
// (next); `scroll left` (prev) is the symmetric pair (prod only captured the next click).
export function scrollArrowPayload(el) {
  if (!el.classList || !el.classList.contains('stats-arrow')) return null;
  let side = null;
  if (el.classList.contains('prev')) side = 'left';
  else if (el.classList.contains('next')) side = 'right';
  if (!side) return null;
  return {
    'ui-object-detail': `scroll ${side}`,
    'custom-properties': { link_name: `button-scroll-${side}` },
  };
}

function parseStatRow(cell) {
  let numberText = '';
  let companyText = '';
  let segmentText = '';
  const descParagraphs = [];
  if (cell) {
    [...cell.children].forEach((node) => {
      if (node.tagName !== 'P') return;
      const text = node.textContent.trim();
      if (!text) return;
      const only = node.children.length === 1 ? node.children[0] : null;
      if (only?.tagName === 'STRONG' && text === only.textContent.trim()) {
        if (!numberText) { numberText = text; return; }
        if (!companyText) { companyText = text; return; }
      }
      if (!segmentText && only?.tagName === 'EM' && text === only.textContent.trim()) {
        segmentText = text;
        return;
      }
      descParagraphs.push(node);
    });
  }
  return {
    numberText, descParagraphs, companyText, segmentText,
  };
}

function statText(row) {
  const [cell] = [...row.children];
  const {
    numberText, descParagraphs, companyText, segmentText,
  } = parseStatRow(cell);
  const parts = [
    numberText, ...descParagraphs.map((p) => p.textContent.trim()), companyText, segmentText,
  ];
  return parts.filter(Boolean).join(' ');
}

function cardsPerView() {
  const w = window.innerWidth;
  if (w < BP_TABLET) return 1;
  if (w < BP_DESKTOP) return 2;
  if (w < BP_WIDE) return 3;
  return 4;
}

function buildCarousel(block, track) {
  const viewport = document.createElement('div');
  viewport.className = 'stats-viewport';
  track.before(viewport);
  viewport.append(track);

  const dots = document.createElement('div');
  dots.className = 'stats-dots';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'stats-arrow prev';
  prevBtn.setAttribute('aria-label', 'Previous outcomes');
  prevBtn.innerHTML = ARROW_SVG.prev;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'stats-arrow next';
  nextBtn.setAttribute('aria-label', 'Next outcomes');
  nextBtn.innerHTML = ARROW_SVG.next;
  const nav = document.createElement('div');
  nav.className = 'stats-nav';
  nav.append(prevBtn, nextBtn);
  const controls = document.createElement('div');
  controls.className = 'stats-controls';
  controls.append(dots, nav);

  // upstream orders the disclaimer above the paging controls, but EDS authors it
  // as a default-content sibling after the block — pull it in when present
  const foot = block.parentElement?.nextElementSibling?.querySelector(':scope > p');
  if (foot) {
    const wrapper = foot.closest('.default-content-wrapper');
    foot.classList.add('stats-foot');
    block.append(foot);
    if (wrapper && !wrapper.children.length) wrapper.remove();
  }
  block.append(controls);

  const cards = [...track.children];
  let perView = cardsPerView();
  let totalGroups = Math.ceil(cards.length / perView);
  let current = 0;

  function updateDots() {
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === current));
  }

  function updateButtons() {
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= totalGroups - 1;
  }

  function applyTransform() {
    // One "page" (perView cards + gaps) always spans exactly the track's own
    // box width — that's what the .stat flex-basis calc() is built to do —
    // so translateX(-100%) per page is exact with no layout read needed
    // (measuring via getBoundingClientRect/getComputedStyle here was forcing
    // a synchronous reflow right after the DOM/style writes above it).
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
      dot.setAttribute('aria-label', `Go to outcomes group ${i + 1} of ${totalGroups}`);
      dot.addEventListener('click', () => goTo(i));
      dots.append(dot);
    }
    updateDots();
  }

  function syncLayout() {
    const next = cardsPerView();
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

  // Click tracking: the paging arrows report prod's `scroll left`/`scroll right`; the outcomes
  // stats aren't CTAs. No trail — prod emits ui_access_point=page on these controls.
  trackAs(null, block, { key: 'stat-band', payload: scrollArrowPayload });
}

export default function decorate(block) {
  const rows = [...block.children];

  if (block.classList.contains('glance')) {
    const list = document.createElement('ul');
    list.className = 'glance-list';
    rows.forEach((row) => {
      if (!row.children.length) return;
      const li = document.createElement('li');
      li.textContent = statText(row);
      list.append(li);
    });
    block.replaceChildren(list);
    return;
  }

  if (block.classList.contains('cards')) {
    // horizontal-scroll image cards (research "Findings at a glance" snackable
    // slider): each row's cell holds a stat graphic + a caption; an image-less
    // cell is the lead title card.
    const track = document.createElement('div');
    track.className = 'stats-cards';
    rows.forEach((row) => {
      const [cell] = [...row.children];
      if (!cell) return;
      const card = document.createElement('div');
      card.className = 'stat-card';
      const pic = cell.querySelector('picture, img');
      if (pic) {
        const media = document.createElement('div');
        media.className = 'stat-card-media';
        media.append(pic.closest('picture') || pic);
        card.append(media);
      } else {
        card.classList.add('stat-card-title');
      }
      const copy = document.createElement('div');
      copy.className = 'stat-card-copy';
      const paras = [...cell.querySelectorAll('p')].filter((p) => p.textContent.trim());
      if (paras.length) paras.forEach((p) => copy.append(p));
      else if (!pic && cell.textContent.trim()) {
        const t = document.createElement('p');
        t.textContent = cell.textContent.trim();
        copy.append(t);
      }
      if (copy.children.length) card.append(copy);
      track.append(card);
    });
    block.replaceChildren(track);
    return;
  }

  if (block.classList.contains('plain')) {
    const box = document.createElement('div');
    box.className = 'stats-box';
    rows.forEach((row) => {
      if (!row.children.length) return;
      const line = document.createElement('p');
      line.className = 'stat-line';
      line.textContent = statText(row);
      box.append(line);
    });
    block.replaceChildren(box);
    return;
  }

  const staticGrid = block.classList.contains('dark') || block.classList.contains('simple');
  const track = document.createElement('div');
  track.className = staticGrid ? 'stats-grid' : 'stats-track';

  rows.forEach((row) => {
    const [cell] = [...row.children];
    if (!cell) return;
    const {
      numberText, descParagraphs, companyText, segmentText,
    } = parseStatRow(cell);

    const stat = document.createElement('div');
    stat.className = 'stat';
    // number+desc and company+segment are grouped so the card's flex gap falls
    // between the two blocks, as upstream (.os-card-header / .os-card-footer)
    const head = document.createElement('div');
    head.className = 'stat-head';
    const num = document.createElement('div');
    num.className = 'stat-num';
    num.textContent = numberText;
    head.append(num);
    descParagraphs.forEach((p) => {
      const desc = document.createElement('p');
      desc.className = 'stat-desc';
      desc.innerHTML = p.innerHTML;
      head.append(desc);
    });
    stat.append(head);

    const footer = document.createElement('div');
    footer.className = 'stat-foot';
    if (companyText) {
      const co = document.createElement('p');
      co.className = 'stat-co';
      co.textContent = companyText;
      footer.append(co);
    }
    if (segmentText) {
      const seg = document.createElement('p');
      seg.className = 'stat-seg';
      seg.textContent = segmentText;
      footer.append(seg);
    }
    if (footer.children.length) stat.append(footer);
    track.append(stat);
  });

  block.replaceChildren(track);

  if (!staticGrid) buildCarousel(block, track);
}
