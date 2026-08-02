/**
 * cards — generic card grid, with two additional shape variants:
 *   .carousel   plain photo cards in a single scrolling row (events,
 *               financial-services, professional-services)
 *   .boxed      white rounded card (photo + text) in a single scrolling row,
 *               centered when it doesn't fill the row (oa)
 * Both scroll variants combine with the .accent/.dark tone classes (section
 * background) independently — see cards.css.
 *
 * Used by OF1-generated content (blocks/of1), which emits plain `.cards > div`
 * rows rather than authoring this block directly. The default (grid) shape is
 * kept structurally as-is (no ul/li wrap, no scroll wrapper) to match the DOM
 * blocks/of1/of1.css already targets.
 * CSS: blocks/cards/cards.css (baseline) + blocks/of1/of1.css
 *      (.generated-section .cards, full styling)
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

const SCROLL_SHAPE_CLASSES = ['carousel', 'boxed'];

function buildNavButton(direction, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `cards-nav cards-nav-${direction}`;
  btn.setAttribute('aria-label', label);
  const points = direction === 'prev' ? '5.6,1 1.4,5 5.6,9' : '1.4,1 5.6,5 1.4,9';
  btn.innerHTML = `<svg viewBox="0 0 7 10" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return btn;
}

/**
 * Wraps already-decorated card rows in a native horizontally-scrolling
 * viewport (touch/trackpad swipe works for free) with a progress bar + "X of
 * Y" counter + prev/next buttons. The controls are only shown once the cards
 * actually overflow the viewport — a 3-card row that fits on one screen (oa)
 * gets no controls at all.
 * @param {Element} block The .cards block (already has .carousel or .boxed)
 */
function enhanceScroll(block) {
  const cards = [...block.children];

  const track = document.createElement('div');
  track.className = 'cards-track';
  track.append(...cards);

  const viewport = document.createElement('div');
  viewport.className = 'cards-viewport';
  viewport.append(track);

  const counter = document.createElement('p');
  counter.className = 'cards-counter';

  const barFill = document.createElement('div');
  barFill.className = 'cards-progress-fill';
  const barTrack = document.createElement('div');
  barTrack.className = 'cards-progress-track';
  barTrack.append(barFill);

  const prevBtn = buildNavButton('prev', 'Previous cards');
  const nextBtn = buildNavButton('next', 'Next cards');
  const buttons = document.createElement('div');
  buttons.className = 'cards-nav-buttons';
  buttons.append(prevBtn, nextBtn);

  const controls = document.createElement('div');
  controls.className = 'cards-controls';
  controls.append(counter, barTrack, buttons);

  block.append(viewport, controls);

  const update = () => {
    const { scrollWidth, clientWidth, scrollLeft } = viewport;
    const maxScroll = scrollWidth - clientWidth;
    const overflowing = maxScroll > 1;
    controls.hidden = !overflowing;
    if (!overflowing) return;
    const pages = Math.ceil(scrollWidth / clientWidth);
    const page = Math.min(pages, Math.round(scrollLeft / clientWidth) + 1);
    counter.textContent = `${page} of ${pages}`;
    barFill.style.width = `${(scrollLeft / maxScroll) * 100}%`;
    prevBtn.disabled = scrollLeft <= 0;
    nextBtn.disabled = scrollLeft >= maxScroll - 1;
  };

  prevBtn.addEventListener('click', () => viewport.scrollBy({ left: -viewport.clientWidth, behavior: 'smooth' }));
  nextBtn.addEventListener('click', () => viewport.scrollBy({ left: viewport.clientWidth, behavior: 'smooth' }));
  viewport.addEventListener('scroll', () => window.requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  update();
}

export default function decorate(block) {
  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => {
      const img = cell.querySelector('picture > img');
      if (img && cell.children.length === 1) {
        cell.classList.add('cards-card-image');
        const picture = img.closest('picture');
        picture.replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]));
      } else {
        cell.classList.add('cards-card-body');
      }
    });
  });

  if (SCROLL_SHAPE_CLASSES.some((c) => block.classList.contains(c))) {
    enhanceScroll(block);
  }
}
