/**
 * hero — dark gradient lead band.
 *
 * Authoring: one flowing cell/row of copy — an optional short eyebrow
 * paragraph, the page's <h1>, an optional lede paragraph, and an optional
 * CTAs paragraph (<em><a> secondary, <strong><a> primary) — in that reading
 * order. Eyebrow vs. lede is told apart by position relative to the <h1>,
 * not by which row/cell it's in, so all of this can be one cell (as authored
 * on e.g. /beta) or split across several rows (as authored on most
 * pages) — either works identically.
 *
 * An optional image can go anywhere in that same flow — its own row, or
 * mixed into a text cell alongside other copy (e.g. an accolade/"powered by"
 * badge next to the CTAs, as on /accountant and /contact). Whichever image
 * is found becomes the media element; on .hero.form (no media column — the
 * lead card takes its place) it renders inline in the copy column instead,
 * at whatever size the authored image is.
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
  // .centered is a single-column hero (ai-agents): the media cell is a small
  // product lockup that belongs ABOVE the headline as a logo/eyebrow, not in a
  // right-hand media column.
  const isCentered = block.classList.contains('centered');
  const isGradient = block.classList.contains('gradient');
  const rows = [...block.children];

  if (isGradient) {
    block.closest('.section').classList.add('gradient');
  }

  const copy = document.createElement('div');
  copy.className = 'hero-copy';
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
    [...cell.childNodes].forEach((n) => copy.append(n));
  });

  const rawMedia = copy.querySelector('picture, img');
  let mediaEl = null;
  if (rawMedia) {
    mediaEl = rawMedia.closest('picture') || rawMedia;
    const host = mediaEl.parentElement;
    mediaEl.remove();
    if (host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) host.remove();
  }

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

  // A direct .mp4 link is an inline hero animation, not a CTA — upstream plays
  // it muted-and-looping below the copy with a pause control, rather than
  // linking out to the file. Pulled out before the CTA pass so it doesn't get
  // buttonized. (YouTube/Vimeo links stay CTAs; those open a player.)
  let videoSrc = null;
  ctaParas.forEach((p) => {
    const a = [...p.querySelectorAll('a')].find((x) => /\.mp4(?:$|\?)/i.test(x.getAttribute('href') || ''));
    if (!a) return;
    videoSrc = a.getAttribute('href');
    a.remove();
    // Drop the host paragraph once its link is gone. An empty <p> still carries
    // the global paragraph margins, which showed up as ~17px of dead space below
    // the CTA row and pushed the video's offset out.
    if (!p.textContent.trim() && !p.querySelector('a, img, picture')) p.remove();
  });
  // Keep only paragraphs that still hold a link. Deliberately NOT `isConnected`:
  // `copy` is still a detached subtree at this point, so every node in it would
  // read as disconnected and all CTAs would be dropped.
  const ctas = ctaParas.filter((p) => p.querySelector('a'));

  // Buttonize CTAs ourselves so it works whether or not the global decorator
  // fired (two links in one <p> is not buttonized by vanilla EDS). <strong> =>
  // primary, <em> => secondary; collect all CTAs into one .hero-actions row.
  if (ctas.length) {
    const actions = document.createElement('p');
    actions.className = 'button-wrapper hero-actions';
    ctas.forEach((p) => {
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
    ctas[0].replaceWith(actions);
    ctas.slice(1).forEach((p) => p.remove());
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
    if (mediaEl) copy.append(mediaEl);
  } else if (mediaEl && isCentered) {
    // logo lockup pinned above the headline instead of a media column
    const lockup = document.createElement('div');
    lockup.className = 'hero-lockup';
    lockup.append(mediaEl);
    copy.prepend(lockup);
  } else if (mediaEl) {
    const media = document.createElement('div');
    media.className = 'hero-media';
    media.append(mediaEl);
    grid.append(media);
    enhanceDashboardAnimation(media, mediaEl);
  }

  block.replaceChildren(grid);

  // Inline looping animation below the copy (see videoSrc above). Muted +
  // playsinline so mobile browsers allow autoplay, and paused up-front when the
  // reader prefers reduced motion — the pause button then reads "Play" so the
  // animation is still reachable.
  if (videoSrc) {
    const figure = document.createElement('div');
    figure.className = 'hero-video';

    const video = document.createElement('video');
    video.src = videoSrc;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', 'AI agents in your corner video');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    video.autoplay = !reduceMotion;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hero-video-toggle';
    const syncToggle = () => {
      const label = video.paused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-label', `${label} AI agents in your corner video`);
      toggle.dataset.state = video.paused ? 'paused' : 'playing';
    };
    toggle.addEventListener('click', () => {
      if (video.paused) video.play(); else video.pause();
    });
    video.addEventListener('play', syncToggle);
    video.addEventListener('pause', syncToggle);
    syncToggle();

    figure.append(video, toggle);
    block.append(figure);
  }
}
