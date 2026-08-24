/**
 * cards — generic card grid, with shape variants:
 *   .carousel   plain photo cards in a single scrolling row (events,
 *               financial-services, professional-services)
 *   .boxed      white rounded card (photo + text) in a single scrolling row,
 *               centered when it doesn't fill the row (oa)
 *   .icons      small (56px) icon + optional eyebrow + heading + body,
 *               unboxed, fixed 3-up (account-management, compare,
 *               human-capital-management, migration, oa "One view...")
 *   .list       vertical stack of horizontal image+text rows, no heading —
 *               the link paragraph's own text is the title, an optional
 *               eyebrow paragraph doubles as a category label (blog rail
 *               "download" promos, e.g. fragments/right-rail)
 * .carousel/.boxed combine with the .accent/.dark tone classes (section
 * background) independently — see cards.css.
 *
 * The body cell is flowing text: an italic-only paragraph anywhere in it
 * becomes the eyebrow, an authored heading tag becomes the card title,
 * everything else stays as body copy untouched.
 *
 * CSS: blocks/cards/cards.css
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

  // content-card carousels (icons/editorial) page with dots; photo carousels
  // keep the "X of Y" counter + progress bar
  const useDots = block.classList.contains('editorial') || block.classList.contains('icons');

  const counter = document.createElement('p');
  counter.className = 'cards-counter';

  const barFill = document.createElement('div');
  barFill.className = 'cards-progress-fill';
  const barTrack = document.createElement('div');
  barTrack.className = 'cards-progress-track';
  barTrack.append(barFill);

  const dots = document.createElement('div');
  dots.className = 'cards-dots';

  const prevBtn = buildNavButton('prev', 'Previous cards');
  const nextBtn = buildNavButton('next', 'Next cards');
  const buttons = document.createElement('div');
  buttons.className = 'cards-nav-buttons';
  buttons.append(prevBtn, nextBtn);

  const controls = document.createElement('div');
  controls.className = 'cards-controls';
  if (useDots) controls.append(dots, buttons);
  else controls.append(counter, barTrack, buttons);

  block.append(viewport, controls);

  const update = () => {
    const { scrollWidth, clientWidth, scrollLeft } = viewport;
    const maxScroll = scrollWidth - clientWidth;
    const overflowing = maxScroll > 1;
    controls.hidden = !overflowing;
    if (!overflowing) return;
    const pages = Math.ceil(scrollWidth / clientWidth);
    const page = Math.min(pages, Math.round(scrollLeft / clientWidth) + 1);
    if (useDots) {
      if (dots.children.length !== pages) {
        dots.replaceChildren(...Array.from({ length: pages }, (_, i) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'cards-dot';
          dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
          dot.addEventListener('click', () => viewport.scrollTo({ left: i * clientWidth, behavior: 'smooth' }));
          return dot;
        }));
      }
      [...dots.children].forEach((dot, i) => dot.classList.toggle('is-active', i === page - 1));
    } else {
      counter.textContent = `${page} of ${pages}`;
      barFill.style.width = `${(scrollLeft / maxScroll) * 100}%`;
    }
    prevBtn.disabled = scrollLeft <= 0;
    nextBtn.disabled = scrollLeft >= maxScroll - 1;
  };

  prevBtn.addEventListener('click', () => viewport.scrollBy({ left: -viewport.clientWidth, behavior: 'smooth' }));
  nextBtn.addEventListener('click', () => viewport.scrollBy({ left: viewport.clientWidth, behavior: 'smooth' }));
  viewport.addEventListener('scroll', () => window.requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);

  // block.js's CSS loads in parallel with (not before) this decorate() call,
  // so the very first synchronous update() below can run against unstyled
  // (block-stacked, not flex-row) content and wrongly conclude nothing
  // overflows. A ResizeObserver re-checks the moment the real layout — from
  // the CSS finishing, images loading, fonts swapping, etc. — actually lands,
  // instead of leaving the controls stuck until the next manual scroll/resize.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(update).observe(track);
  }

  update();
}

// Shared singleton — one floating cursor element for every carousel on the page.
let focusCursorEl;

function getFocusCursor() {
  if (focusCursorEl) return focusCursorEl;
  const el = document.createElement('div');
  el.className = 'cards-focus-cursor';
  el.setAttribute('aria-hidden', 'true');
  const chevron = (side, points) => `<svg class="cards-cursor-chevron cards-cursor-chevron-${side}" viewBox="0 0 6 10" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  el.innerHTML = `${chevron('left', '4.5,1 1,5 4.5,9')}<span class="cards-cursor-dot"></span>${chevron('right', '1.5,1 5,5 1.5,9')}`;
  document.body.append(el);
  focusCursorEl = el;
  return el;
}

/**
 * Adds the erp.intuit.com "camera-focus" cursor over a carousel viewport. The
 * ring follows the pointer while it's inside the viewport, hiding the native
 * cursor. Fine pointers only — touch devices keep the default experience.
 * @param {Element} block The .cards.carousel block (post-enhanceScroll)
 */
function attachFocusCursor(block) {
  const viewport = block.querySelector('.cards-viewport');
  if (!viewport) return;
  if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;

  let raf = 0;
  let x = 0;
  let y = 0;
  const render = () => {
    raf = 0;
    // center the 96px ring on the pointer
    getFocusCursor().style.transform = `translate(${x - 48}px, ${y - 48}px)`;
  };
  const isMouse = (e) => !e.pointerType || e.pointerType === 'mouse';

  viewport.addEventListener('pointermove', (e) => {
    if (!isMouse(e)) return;
    x = e.clientX;
    y = e.clientY;
    if (!raf) raf = window.requestAnimationFrame(render);
  }, { passive: true });

  viewport.addEventListener('pointerenter', (e) => {
    if (!isMouse(e)) return;
    x = e.clientX;
    y = e.clientY;
    render();
    getFocusCursor().classList.add('is-enabled');
    viewport.classList.add('cards-cursor-active');
  });

  viewport.addEventListener('pointerleave', () => {
    if (focusCursorEl) focusCursorEl.classList.remove('is-enabled');
    viewport.classList.remove('cards-cursor-active');
  });

  viewport.addEventListener('pointerdown', (e) => {
    if (isMouse(e) && focusCursorEl) focusCursorEl.classList.add('is-mouse-down');
  });
  window.addEventListener('pointerup', () => {
    if (focusCursorEl) focusCursorEl.classList.remove('is-mouse-down');
  });
}

export default function decorate(block) {
  const isIcons = block.classList.contains('icons');

  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => {
      const img = cell.querySelector('picture > img');
      if (img && cell.children.length === 1) {
        cell.classList.add('cards-card-image');
        const picture = img.closest('picture');
        const width = isIcons ? '150' : '750';
        picture.replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width }]));
      } else {
        cell.classList.add('cards-card-body');
        cell.querySelectorAll('p').forEach((p) => {
          const only = p.children.length === 1 ? p.children[0] : null;
          if (only?.tagName === 'EM' && p.textContent.trim() === only.textContent.trim()) {
            p.classList.add('eyebrow', 'cards-eyebrow');
            only.replaceWith(...only.childNodes);
          }
        });
      }
    });
  });

  // .icons: production lays the icon inline with the eyebrow label (icon left,
  // label right) and drops the title/body below that row. Group the icon +
  // eyebrow into a header row so CSS can render them side by side; the title
  // and body stay in .cards-card-body untouched.
  if (isIcons) {
    [...block.children].forEach((card) => {
      const icon = card.querySelector(':scope > .cards-card-image');
      const eyebrow = card.querySelector(':scope > .cards-card-body > .cards-eyebrow');
      if (!icon) return;
      const head = document.createElement('div');
      head.className = 'cards-card-head';
      head.append(icon);
      if (eyebrow) head.append(eyebrow);
      card.prepend(head);
    });
  }

  if (block.classList.contains('carousel')) {
    [...block.children].forEach((card) => {
      const links = card.querySelectorAll('.cards-card-body a');
      if (links.length !== 1) return;
      const [link] = links;
      const title = card.querySelector('.cards-card-body h3');
      link.classList.add('cards-card-link');
      if (title) link.setAttribute('aria-label', `${title.textContent.trim()}: ${link.textContent.trim()}`);
    });
  }

  if (block.classList.contains('minimal')) {
    [...block.children].forEach((card) => {
      const link = card.querySelector('a[href]');
      if (!link) return;
      link.classList.add('cards-card-link');
      const title = card.querySelector('.cards-card-body h3');
      if (title) link.setAttribute('aria-label', `${title.textContent.trim()}: ${link.textContent.trim()}`);
    });
  }

  if (SCROLL_SHAPE_CLASSES.some((c) => block.classList.contains(c))) {
    enhanceScroll(block);
  }

  // the camera-focus cursor is for photo carousels only, not content cards
  if (block.classList.contains('carousel')
    && !block.classList.contains('editorial')
    && !block.classList.contains('icons')) {
    attachFocusCursor(block);
  }
}
