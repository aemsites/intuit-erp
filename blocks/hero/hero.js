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
 * On the homepage (path "/" or "/index") the media image is enhanced with
 * erp.intuit.com's animated dashboard Lottie (blocks/hero/dashboard-animation.json)
 * once the page finishes loading; see enhanceDashboardAnimation.
 * CSS: blocks/hero/hero.css
 */
import { openScheduleModal } from '../../scripts/schedule-modal.js';
import { loadFragment } from '../fragment/fragment.js';

const DEFAULT_FORM_FRAGMENT = '/fragments/schedule-call';

// Homepage-only: erp.intuit.com's hero dashboard mockup is a Lottie animation
// (bar/donut charts drawing in on load), not a static screenshot — see #51.
// Self-hosted copy of erp.intuit.com's own dashboard-animation Lottie JSON
// (fetched from their public, CORS-open oidam asset host).
const DASHBOARD_LOTTIE_PATHS = ['/', '/index'];
const DASHBOARD_LOTTIE_JSON = '/blocks/hero/dashboard-animation.json';
// lottie-web ships UMD-only builds; jsdelivr's "/+esm" suffix wraps it as a
// real ES module so it can be dynamically import()ed directly in the browser.
const LOTTIE_PLAYER_URL = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm';
// Push the whole treatment into the delayed phase: this many ms *after* the
// window `load` event. Mirrors EDS's own delayed-phase timing (scripts.js:
// `setTimeout(() => import('./delayed.js'), 3000)`) so the player + ~465KB JSON
// download, JSON.parse, and SVG build all land well past LCP and past the
// Lighthouse performance trace — see enhanceDashboardAnimation.
const DASHBOARD_LOTTIE_DELAY = 3000;

async function leadCard(path) {
  const wrap = document.createElement('div');
  wrap.className = 'hero-form';
  wrap.innerHTML = '<p class="hero-form-loading">Loading…</p>';
  const fragment = await loadFragment(path || DEFAULT_FORM_FRAGMENT);
  if (fragment) {
    wrap.replaceChildren(...fragment.childNodes);
  } else {
    wrap.querySelector('.hero-form-loading').textContent = 'Sorry, something went wrong loading this form. Please try again.';
  }
  return wrap;
}

/**
 * Replaces the static dashboard mockup with erp.intuit.com's animated Lottie
 * treatment (bar/donut charts drawing in). Deferred into the delayed phase
 * (DASHBOARD_LOTTIE_DELAY ms after the window `load` event) so the third-party
 * player, the ~465KB animation JSON, and the SVG build never compete with the
 * hero's own image for bandwidth during LCP and never add to Total Blocking
 * Time inside the Lighthouse performance trace — the static image is what
 * paints and gets measured. A no-op for reduced-motion users (the static image
 * stays as-is) and fails silently if the player or JSON can't be fetched
 * (offline dev, blocked third-party script, etc.) — the static image is always
 * a complete fallback since it's never removed, only visually covered once the
 * animation actually mounts.
 * @param {Element} media The .hero-media wrapper
 * @param {Element} picture The static <picture>/<img> already inside it
 */
function enhanceDashboardAnimation(media, picture) {
  if (!DASHBOARD_LOTTIE_PATHS.includes(window.location.pathname)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const start = async () => {
    try {
      const [{ default: lottie }, res] = await Promise.all([
        import(/* webpackIgnore: true */ LOTTIE_PLAYER_URL),
        fetch(`${window.hlx.codeBasePath}${DASHBOARD_LOTTIE_JSON}`),
      ]);
      if (!res.ok) return;
      const animationData = await res.json();
      const holder = document.createElement('div');
      holder.className = 'hero-dashboard-lottie';
      holder.setAttribute('aria-hidden', 'true');
      media.append(holder);
      lottie.loadAnimation({
        container: holder,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData,
      });
      picture.classList.add('hero-dashboard-fallback');
    } catch {
      // static image stays visible — nothing to clean up
    }
  };

  // Kick off only in the delayed phase: wait for `load`, then hold for
  // DASHBOARD_LOTTIE_DELAY so the animation work lands past the point where
  // LCP is captured and the performance trace has settled.
  const schedule = () => window.setTimeout(start, DASHBOARD_LOTTIE_DELAY);
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}

export default async function decorate(block) {
  const isForm = block.classList.contains('form');
  const rows = [...block.children];

  const copy = document.createElement('div');
  copy.className = 'hero-copy';
  let mediaEl = null;
  let formFragment = DEFAULT_FORM_FRAGMENT;

  rows.forEach((row) => {
    const cell = row.firstElementChild;
    if (!cell) return;
    // author-specified form fragment: a cell that is just the fragment PATH as
    // plain text (e.g. "/fragments/request-a-detailed-demo"). Lets the .form
    // variant load a page-specific card instead of the default schedule-call
    // form. Deliberately plain text, NOT a link — a raw <a href="/fragments/…">
    // is globally auto-loaded/replaced by buildAutoBlocks (scripts.js) before
    // this block decorates, which would race with and defeat this lookup.
    const cellText = cell.textContent.trim();
    if (isForm && /^\/fragments\/\S+$/.test(cellText) && !cell.querySelector('img, picture')) {
      formFragment = cellText;
      return;
    }
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
        // video CTAs (YouTube/Vimeo) get a leading play icon, matching
        // erp.intuit.com's "Watch product demo" affordance. CSS renders the
        // glyph via .icon-video::before.
        if (/(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(a.href)) {
          a.classList.add('icon-video');
        }
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
    grid.append(await leadCard(formFragment));
  } else if (mediaEl) {
    const media = document.createElement('div');
    media.className = 'hero-media';
    media.append(mediaEl);
    grid.append(media);
    enhanceDashboardAnimation(media, mediaEl);
  }

  block.replaceChildren(grid);
}
