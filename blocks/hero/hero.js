import { loadFragment } from '../fragment/fragment.js';
import { trackAs } from '../../scripts/tracking.js';

const DEFAULT_FORM_FRAGMENT = '/fragments/schedule-call';
const DASHBOARD_LOTTIE_PATHS = ['/', '/index'];
const DASHBOARD_LOTTIE_JSON = '/blocks/hero/dashboard-animation.json';
const LOTTIE_PLAYER_URL = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm';
const DASHBOARD_LOTTIE_DELAY = 3000;
const YOUTUBE_URL_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/;
const VIMEO_URL_RE = /vimeo\.com\/(?:video\/)?(\d+)/;

/**
 * Resolves a YouTube/Vimeo CTA link to its provider/id/autoplay-embed-URL, or
 * null if the href isn't a recognized video link.
 * @param {string} href
 * @returns {{provider:string,id:string,embedUrl:string}|null}
 */
function parseVideoUrl(href) {
  const yt = href.match(YOUTUBE_URL_RE);
  if (yt) {
    return { provider: 'youtube', id: yt[1], embedUrl: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0` };
  }
  const vimeo = href.match(VIMEO_URL_RE);
  if (vimeo) {
    return { provider: 'vimeo', id: vimeo[1], embedUrl: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  }
  return null;
}

/**
 * Opens the video in a dismissible lightbox modal (autoplay iframe). Self-contained
 * (mirrors video.js/testimonial.js's own copy) so hero stays independent of the
 * video block; see hero.css for the shared `.video-modal-*` styles.
 * @param {string} embedUrl provider embed URL
 * @param {string} [title] accessible iframe title
 */
function openVideoModal(embedUrl, title) {
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  overlay.innerHTML = `
    <div class="video-modal">
      <button type="button" class="video-modal-close" aria-label="Close video">×</button>
      <div class="video-modal-frame">
        <iframe src="${embedUrl}" title="${title || 'Video'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>
    </div>`;

  function close() {
    overlay.remove();
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.video-modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

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
/*
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

  let videoSrc = null;
  ctaParas.forEach((p) => {
    const a = [...p.querySelectorAll('a')].find((x) => /\.mp4(?:$|\?)/i.test(x.getAttribute('href') || ''));
    if (!a) return;
    videoSrc = a.getAttribute('href');
    a.remove();
    if (!p.textContent.trim() && !p.querySelector('a, img, picture')) p.remove();
  });

  const ctas = ctaParas.filter((p) => p.querySelector('a'));

  if (ctas.length) {
    const actions = document.createElement('p');
    actions.className = 'button-wrapper hero-actions';
    ctas.forEach((p) => {
      p.querySelectorAll('a').forEach((a) => {
        const info = parseVideoUrl(a.href);
        if (info) {
          a.classList.add('icon-video');
          a.setAttribute('data-track-id', `hero:${info.provider}-${info.id}`);
          const originalHref = a.getAttribute('href');
          const neutralizeHref = () => {
            a.setAttribute('href', '#');
            setTimeout(() => a.setAttribute('href', originalHref), 0);
          };
          a.addEventListener('pointerdown', neutralizeHref);
          a.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') neutralizeHref();
          });
          a.addEventListener('click', (e) => {
            e.preventDefault();
            openVideoModal(info.embedUrl, a.textContent.trim());
          });
        }
        actions.append(a);
      });
    });
    ctas[0].replaceWith(actions);
    ctas.slice(1).forEach((p) => p.remove());
  }

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
  // Hero -> "rw2_hero" trail; sheet/opt-in key "hero".
  return trackAs('rw2_hero', block, { key: 'hero' });
}
