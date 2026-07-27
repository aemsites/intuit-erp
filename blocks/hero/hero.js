/**
 * hero — dark gradient lead band (all 5 pages).
 *
 * Authoring rows (each row = one cell):
 *   1. eyebrow text            (optional — short kicker, e.g. "THE AI-NATIVE ERP")
 *   2. <h1> headline           (the page's single <h1>)
 *   3. lede paragraph          (optional)
 *   4. CTAs paragraph          (optional — <em><a> secondary, <strong><a> primary)
 *   5. media <img>             (optional; omitted on the .hero.form variant)
 *
 * Variant .hero.form (pricing) loads the shared "Let's connect" fragment
 * (content/fragments/schedule-call.html) into a card on the right instead of
 * the media image.
 * A CTA linking to "#schedule" (index page) opens the shared "Schedule a
 * call" modal (scripts/schedule-modal.js) instead of navigating.
 * CSS: blocks/hero/hero.css
 */
import { openScheduleModal } from '../../scripts/schedule-modal.js';
import { loadFragment } from '../fragment/fragment.js';

const SCHEDULE_CALL_FRAGMENT = '/fragments/schedule-call';

async function leadCard() {
  const wrap = document.createElement('div');
  wrap.className = 'hero-form';
  wrap.innerHTML = '<p class="hero-form-loading">Loading…</p>';
  const fragment = await loadFragment(SCHEDULE_CALL_FRAGMENT);
  if (fragment) {
    wrap.replaceChildren(...fragment.childNodes);
  } else {
    wrap.querySelector('.hero-form-loading').textContent = 'Sorry, something went wrong loading this form. Please try again.';
  }
  return wrap;
}

export default async function decorate(block) {
  const isForm = block.classList.contains('form');
  const rows = [...block.children];

  const copy = document.createElement('div');
  copy.className = 'hero-copy';
  let mediaEl = null;

  rows.forEach((row) => {
    const cell = row.firstElementChild;
    if (!cell) return;
    const pic = cell.querySelector('picture, img');
    if (pic && cell.textContent.trim() === '') {
      mediaEl = cell.querySelector('picture') || pic;
      return;
    }
    [...cell.childNodes].forEach((n) => copy.append(n));
  });

  // classify copy children
  const heading = copy.querySelector('h1, h2, h3');
  const ctaParas = [];
  copy.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('a')) { ctaParas.push(p); return; }
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) {
      p.classList.add('eyebrow', 'hero-eyebrow');
    } else {
      p.classList.add('hero-lede');
    }
  });

  // Buttonize CTAs ourselves so it works whether or not the global decorator
  // fired (two links in one <p> is not buttonized by vanilla EDS). <strong> =>
  // primary, <em> => secondary; collect all CTAs into one .hero-actions row.
  if (ctaParas.length) {
    const actions = document.createElement('p');
    actions.className = 'button-wrapper hero-actions';
    ctaParas.forEach((p) => {
      p.querySelectorAll('a').forEach((a) => {
        const wrap = a.closest('strong, em') || a.querySelector('strong, em');
        const variant = wrap && wrap.tagName === 'EM' ? 'secondary' : 'primary';
        a.classList.add('button', variant);
        actions.append(a);
      });
    });
    ctaParas[0].replaceWith(actions);
    ctaParas.slice(1).forEach((p) => p.remove());
  }

  copy.querySelectorAll('a[href="#schedule"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openScheduleModal();
    });
  });

  const grid = document.createElement('div');
  grid.className = 'hero-grid';
  grid.append(copy);

  if (isForm) {
    grid.append(await leadCard());
  } else if (mediaEl) {
    const media = document.createElement('div');
    media.className = 'hero-media';
    media.append(mediaEl);
    grid.append(media);
  }

  block.replaceChildren(grid);
}
