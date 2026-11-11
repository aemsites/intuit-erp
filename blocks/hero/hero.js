import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import { trackAs } from '../../scripts/tracking.js';

const DEFAULT_FORM_FRAGMENT = '/fragments/schedule-call';
const DASHBOARD_LOTTIE_PATHS = ['/', '/index'];
const DASHBOARD_LOTTIE_JSON = '/blocks/hero/dashboard-animation.json';
const LOTTIE_PLAYER_URL = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm';
const DASHBOARD_LOTTIE_ROOT_MARGIN = '500px 0px';
const DASHBOARD_LOTTIE_FALLBACK_DELAY = 3000;
const DASHBOARD_LOTTIE_DESKTOP_THRESHOLD = 0.1;
const DASHBOARD_LOTTIE_MOBILE_THRESHOLD = 0.8;
const TEASER_SECONDS = 5;
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
 * Plain (unformatted) links render as media; bold/italic ones are buttonized CTAs.
 * @param {HTMLAnchorElement} a
 * @returns {boolean}
 */
function isPlainLink(a) {
  return !a.closest('strong, em') && !a.classList.contains('button');
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

/**
 * Builds the video text link; a trailing "(m:ss)" is split off as the duration.
 * @param {HTMLAnchorElement} a authored video link
 * @param {{provider:string,id:string,embedUrl:string}} info parsed video URL
 * @returns {HTMLDivElement}
 */
function buildVideoLink(a, info) {
  const [, text, duration] = a.textContent.trim().match(/^(.*?)\s*(\(\d{1,2}:\d{2}(?::\d{2})?\))?$/);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hero-video-link';
  btn.setAttribute('data-track-id', `hero:${info.provider}-${info.id}`);
  btn.setAttribute('data-video-src', a.getAttribute('href'));

  const label = document.createElement('span');
  label.className = 'hero-video-link-text';
  label.textContent = text;
  btn.append(label);
  if (duration) {
    const time = document.createElement('span');
    time.className = 'hero-video-link-duration';
    time.textContent = duration;
    btn.append(time);
  }
  btn.addEventListener('click', () => openVideoModal(info.embedUrl, text));

  const wrap = document.createElement('div');
  wrap.className = 'hero-video-link-wrapper';
  wrap.append(btn);
  return wrap;
}

function buildTeaserVideo(srcs, posters, loop = false) {
  const media = document.createElement('div');
  media.className = 'hero-media hero-media-video';

  const video = document.createElement('video');
  const compact = window.matchMedia('(width < 1024px)').matches;
  video.src = (compact && srcs[1]) || srcs[0];
  const poster = (compact && posters[1]) || posters[0];
  if (poster) video.poster = poster;
  video.muted = true;
  video.playsInline = true;
  video.loop = loop;
  video.preload = 'metadata';
  video.setAttribute('aria-label', 'Product video');

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'hero-video-play';
  play.setAttribute('aria-label', 'Play video');
  play.hidden = true;

  const playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let teasing = playing && !loop;
  const showPlay = () => { play.hidden = false; };

  video.addEventListener('timeupdate', () => {
    if (teasing && video.currentTime >= TEASER_SECONDS) {
      teasing = false;
      video.pause();
      showPlay();
    }
  });
  video.addEventListener('ended', showPlay);
  play.addEventListener('click', () => {
    teasing = false;
    play.hidden = true;
    video.currentTime = 0;
    video.muted = false;
    video.controls = true;
    video.play().catch(showPlay);
  });

  if (playing) {
    video.autoplay = true;
    video.play().catch(() => { teasing = false; showPlay(); });
  } else {
    showPlay();
  }

  media.append(video, play);
  return media;
}

/**
 * Click-to-play YouTube tile: poster + play button; the iframe loads only on click.
 * @param {{provider:string,id:string,embedUrl:string}} info parsed video URL
 * @param {string} href authored link
 * @param {Element[]} posterEls authored posters (desktop, then < 1024px)
 * @param {string} title accessible video title
 * @returns {HTMLDivElement}
 */
function buildYouTubeTile(info, href, posterEls, title) {
  const media = document.createElement('div');
  media.className = 'hero-media hero-media-video hero-media-youtube';

  const compact = window.matchMedia('(width < 1024px)').matches;
  let poster = (compact && posterEls[1]) || posterEls[0];
  if (poster) {
    const img = poster.querySelector('img') || poster;
    img.loading = 'eager';
  } else {
    poster = document.createElement('img');
    poster.src = `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
    poster.alt = '';
    poster.loading = 'eager';
  }

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'hero-video-play';
  play.setAttribute('aria-label', `Play video: ${title}`);
  play.setAttribute('data-track-id', `hero:youtube-${info.id}`);
  play.setAttribute('data-video-src', href);
  play.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = info.embedUrl;
    iframe.title = title;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    media.replaceChildren(iframe);
    iframe.focus();
  });

  media.append(poster, play);
  return media;
}

// jsdom and some browsers return undefined or throw from play() instead of a promise
function tryPlay(video) {
  try {
    return Promise.resolve(video.play());
  } catch (e) {
    return Promise.reject(e);
  }
}

/**
 * Full-bleed looping background video for `.video-bg`, layered over the authored
 * static fallback. Reduced motion, a missing source, blocked autoplay and load
 * errors all leave the fallback showing.
 * @param {string[]} srcs mp4 sources (desktop, then < 1024px)
 * @param {Element[]} fallbacks authored pictures (desktop, then < 1024px)
 * @returns {{bg: HTMLDivElement, toggle: HTMLButtonElement|null, start: Function}}
 */
function buildBackgroundVideo(srcs, fallbacks) {
  const compact = window.matchMedia('(width < 1024px)').matches;
  const bg = document.createElement('div');
  bg.className = 'hero-bg';
  bg.setAttribute('aria-hidden', 'true');

  const fallback = (compact && fallbacks[1]) || fallbacks[0];
  if (fallback) {
    fallback.classList.add('hero-bg-fallback');
    bg.append(fallback);
  }

  const src = (compact && srcs[1]) || srcs[0];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!src || reduceMotion) {
    bg.classList.add('is-fallback');
    return { bg, toggle: null, start: () => {} };
  }

  const video = document.createElement('video');
  video.className = 'hero-bg-video';
  video.muted = true;
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.loop = true;
  video.autoplay = true;
  video.preload = 'auto';
  video.tabIndex = -1;
  video.src = src;
  bg.append(video);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'hero-bg-toggle';
  const syncToggle = () => {
    toggle.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} background video`);
    toggle.dataset.state = video.paused ? 'paused' : 'playing';
  };
  const play = () => tryPlay(video).catch((e) => {
    // eslint-disable-next-line no-console
    console.debug('hero: background video playback blocked', e);
    bg.classList.add('is-fallback');
    syncToggle();
  });

  toggle.addEventListener('click', () => {
    if (video.paused) play(); else video.pause();
  });
  video.addEventListener('play', syncToggle);
  video.addEventListener('pause', syncToggle);
  video.addEventListener('playing', () => bg.classList.remove('is-fallback'));
  video.addEventListener('error', () => {
    // eslint-disable-next-line no-console
    console.warn('hero: background video failed to load', src);
    bg.classList.add('is-fallback');
    video.remove();
    toggle.remove();
  });
  syncToggle();

  return { bg, toggle, start: play };
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
function yieldToMain() {
  if (window.scheduler?.yield) return window.scheduler.yield();
  return new Promise((resolve) => { window.setTimeout(resolve, 0); });
}

function scheduleWhenIdle(callback) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(callback);
  } else {
    window.setTimeout(callback, DASHBOARD_LOTTIE_FALLBACK_DELAY);
  }
}

/*
 * @param {Element} media The .hero-media wrapper
 * @param {Element} picture The static <picture>/<img> already inside it
 * @param {Object} dependencies Overridable resource loaders for tests
 */
export function enhanceDashboardAnimation(media, picture, {
  fetchAnimation = (url) => fetch(url),
  loadPlayer = () => import(/* webpackIgnore: true */ LOTTIE_PLAYER_URL),
} = {}) {
  if (!DASHBOARD_LOTTIE_PATHS.includes(window.location.pathname)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // A personalization/experiment page swap (see experience.js#swapMain) replaces <main>
  // without changing the URL, so the path check above can't tell a variant's own hero
  // image apart from the default homepage dashboard screenshot. Skip the animation
  // rather than paint it over content it doesn't belong to.
  // NOTE: check document.querySelector('main') rather than media.closest('main') — at
  // this point in decorate(), media only lives inside the in-memory `grid` fragment;
  // grid isn't attached to `block` (and so not to the document's <main>) until
  // block.replaceChildren(grid) runs afterward, so media.closest('main') would always
  // return null here.
  if (document.querySelector('main')?.dataset.pageSwapped === 'true') return;

  const visibilityThreshold = window.matchMedia('(width < 768px)').matches
    ? DASHBOARD_LOTTIE_MOBILE_THRESHOLD
    : DASHBOARD_LOTTIE_DESKTOP_THRESHOLD;
  let responsePromise;
  let started = false;

  const warmResources = () => {
    if (!document.head.querySelector('link[data-hero-dashboard-lottie]')) {
      const preload = document.createElement('link');
      preload.rel = 'modulepreload';
      preload.href = LOTTIE_PLAYER_URL;
      preload.crossOrigin = 'anonymous';
      preload.nonce = 'aem';
      preload.dataset.heroDashboardLottie = '';
      document.head.append(preload);
    }

    if (!responsePromise) {
      const url = `${window.hlx?.codeBasePath || ''}${DASHBOARD_LOTTIE_JSON}`;
      try {
        responsePromise = Promise.resolve(fetchAnimation(url)).catch(() => null);
      } catch {
        responsePromise = Promise.resolve(null);
      }
    }
    return responsePromise;
  };

  const start = async () => {
    let holder;
    try {
      const [{ default: lottie }, res] = await Promise.all([loadPlayer(), warmResources()]);
      if (!res?.ok) return;
      await yieldToMain();
      const animationData = await res.json();
      await yieldToMain();

      holder = document.createElement('div');
      holder.className = 'hero-dashboard-lottie is-loading';
      holder.setAttribute('aria-hidden', 'true');
      media.append(holder);
      const animation = lottie.loadAnimation({
        container: holder,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData,
      });
      animation.addEventListener('DOMLoaded', () => {
        holder.classList.remove('is-loading');
        picture.classList.add('hero-dashboard-fallback');
        animation.play();
      });
      animation.addEventListener('data_failed', () => holder.remove());
    } catch {
      holder?.remove();
      // static image stays visible
    }
  };

  const initialize = async () => {
    if (started) return;
    started = true;
    const image = picture.matches('img') ? picture : picture.querySelector('img');
    if (image?.decode) await image.decode().catch(() => {});
    scheduleWhenIdle(start);
  };

  if (!window.IntersectionObserver) {
    scheduleWhenIdle(warmResources);
    initialize();
    return;
  }

  const warmObserver = new IntersectionObserver((entries) => {
    if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
    warmObserver.disconnect();
    scheduleWhenIdle(warmResources);
  }, { rootMargin: DASHBOARD_LOTTIE_ROOT_MARGIN });

  const visibleObserver = new IntersectionObserver((entries) => {
    const visible = entries.some(({ isIntersecting, intersectionRatio }) => (
      isIntersecting && intersectionRatio >= visibilityThreshold
    ));
    if (!visible) return;
    visibleObserver.disconnect();
    initialize();
  }, { threshold: visibilityThreshold });

  warmObserver.observe(media);
  visibleObserver.observe(media);
}

/**
 * Motion layer for the `ies-gradient` media slot. The authored image stays in
 * flow as the sizing box and fallback. An mp4 behaves like the homepage teaser:
 * it autoplays muted for TEASER_SECONDS, then pauses and shows a play button
 * that restarts it with sound and controls. A Lottie JSON loops over the image.
 * Reduced motion shows the play button straight away; load errors leave the image.
 * @param {Element} media The .hero-media wrapper (already holds the image)
 * @param {{video?: string, lottie?: string}} motion authored motion sources
 */
function addMotion(media, { video: videoSrc, lottie: lottieSrc, loop = false }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (videoSrc) {
    media.classList.add('hero-media-motion');
    const video = document.createElement('video');
    video.className = 'hero-motion';
    video.muted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = loop;
    video.preload = reduceMotion ? 'metadata' : 'auto';
    video.setAttribute('aria-label', 'Product video');
    video.src = videoSrc;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'hero-video-play';
    play.setAttribute('aria-label', 'Play video');
    play.hidden = true;

    let teasing = !reduceMotion && !loop;
    const showPlay = () => { play.hidden = false; };

    video.addEventListener('playing', () => media.classList.add('is-playing'));
    video.addEventListener('timeupdate', () => {
      if (teasing && video.currentTime >= TEASER_SECONDS) {
        teasing = false;
        video.pause();
        showPlay();
      }
    });
    video.addEventListener('ended', showPlay);
    video.addEventListener('error', () => {
      // eslint-disable-next-line no-console
      console.warn('hero: video failed to load', videoSrc);
      media.classList.remove('is-playing');
      video.remove();
      play.remove();
    });
    play.addEventListener('click', () => {
      teasing = false;
      play.hidden = true;
      video.currentTime = 0;
      video.muted = false;
      video.controls = true;
      tryPlay(video).catch(showPlay);
    });

    media.append(video, play);
    if (!reduceMotion) {
      tryPlay(video).catch((e) => {
        // eslint-disable-next-line no-console
        console.debug('hero: video playback blocked', e);
        teasing = false;
        showPlay();
      });
    } else {
      showPlay();
    }
    return;
  }

  if (reduceMotion) return;
  media.classList.add('hero-media-motion');

  if (lottieSrc) {
    const holder = document.createElement('div');
    holder.className = 'hero-motion hero-motion-lottie';
    holder.setAttribute('aria-hidden', 'true');
    scheduleWhenIdle(async () => {
      try {
        const [{ default: lottie }, res] = await Promise.all([
          import(/* webpackIgnore: true */ LOTTIE_PLAYER_URL),
          fetch(lottieSrc),
        ]);
        if (!res.ok) return;
        const animationData = await res.json();
        media.append(holder);
        const animation = lottie.loadAnimation({
          container: holder,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
        });
        animation.addEventListener('DOMLoaded', () => media.classList.add('is-playing'));
        animation.addEventListener('data_failed', () => holder.remove());
      } catch {
        holder.remove();
      }
    });
  }
}

function extendArcsBackground(block) {
  const section = block.closest('.section');
  const tail = section?.nextElementSibling;
  if (!tail?.querySelector('.logo-band.marquee:not(.light)') || !window.ResizeObserver) return;
  new ResizeObserver(() => {
    section.style.setProperty('--hero-arcs-tail', `${tail.offsetHeight}px`);
  }).observe(tail);
}

function detachMedia(el, copy) {
  const media = el.closest('picture') || el;
  const host = media.parentElement;
  media.remove();
  if (host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) host.remove();
  return media;
}

export default async function decorate(block) {
  const isIesGradient = block.classList.contains('ies-gradient');
  if (isIesGradient) block.classList.add('ies');
  const isForm = block.classList.contains('form');
  // .centered is a single-column hero (ai-agents): the media cell is a small
  // product lockup that belongs ABOVE the headline as a logo/eyebrow, not in a
  // right-hand media column.
  const isCentered = block.classList.contains('centered');
  const isGradient = block.classList.contains('gradient');
  const isVideoLink = block.classList.contains('video-link');
  const isIesVideo = block.classList.contains('ies') && block.classList.contains('video');
  const isVideoBg = block.classList.contains('video-bg');
  const loopVideo = block.classList.contains('loop');
  const rows = [...block.children];

  if (block.classList.contains('ies') && block.classList.contains('arcs')) extendArcsBackground(block);

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
    if (isIesGradient) {
      const cellHeading = cell.querySelector('h1, h2, h3');
      if (cellHeading) {
        cell.querySelectorAll('img').forEach((img) => {
          // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
          if (img.compareDocumentPosition(cellHeading) & Node.DOCUMENT_POSITION_FOLLOWING) img.dataset.lockup = '';
        });
      }
    }
    [...cell.childNodes].forEach((n) => copy.append(n));
  });

  // .ies.video: authored images are the video posters (desktop, then < 1024px)
  const posterSrcs = [];
  const posterEls = [];
  if (isIesVideo) {
    copy.querySelectorAll('img').forEach((img) => {
      posterSrcs.push(img.src);
      const el = img.closest('picture') || img;
      const host = el.parentElement;
      el.remove();
      posterEls.push(el);
      if (host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) host.remove();
    });
  }

  // .video-bg: authored images are the static fallbacks (desktop, then < 1024px)
  const fallbackEls = [];
  if (isVideoBg) {
    copy.querySelectorAll('img').forEach((img) => {
      const el = img.closest('picture') || img;
      const host = el.parentElement;
      el.remove();
      fallbackEls.push(el);
      if (host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) host.remove();
    });
  }

  let lockupEl = null;
  if (isIesGradient) {
    const lockupImg = copy.querySelector('img[data-lockup]');
    if (lockupImg && copy.querySelectorAll('img').length > 1) {
      delete lockupImg.dataset.lockup;
      lockupEl = detachMedia(lockupImg, copy);
    }
  }

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
  let lottieSrc = null;
  const videoSrcs = [];
  ctaParas.forEach((p) => {
    const links = [...p.querySelectorAll('a')].filter((x) => {
      const href = x.getAttribute('href') || '';
      return /\.mp4(?:$|\?)/i.test(href) || (isIesGradient && /\.json(?:$|\?)/i.test(href));
    });
    if (!links.length) return;
    links.forEach((a) => {
      const href = a.getAttribute('href');
      if (/\.json(?:$|\?)/i.test(href)) {
        lottieSrc = lottieSrc || href;
      } else {
        videoSrc = videoSrc || href;
        videoSrcs.push(href);
      }
      a.remove();
    });
    if (!p.textContent.trim() && !p.querySelector('a, img, picture')) p.remove();
  });

  // .ies.video without an .mp4: the first plain YouTube link becomes the media tile
  let youtube = null;
  if (isIesVideo && !videoSrc) {
    ctaParas.some((p) => [...p.querySelectorAll('a')].some((a) => {
      const href = a.getAttribute('href') || '';
      const info = parseVideoUrl(href);
      if (info?.provider !== 'youtube' || !isPlainLink(a)) return false;
      const text = a.textContent.trim();
      const bareUrl = !text || text === href || /^https?:\/\//i.test(text);
      youtube = { info, href, label: bareUrl ? '' : text };
      a.remove();
      if (!p.textContent.trim() && !p.querySelector('a, img, picture')) p.remove();
      return true;
    }));
  }

  const ctas = ctaParas.filter((p) => p.querySelector('a'));

  if (ctas.length) {
    const actions = document.createElement('p');
    actions.className = 'button-wrapper hero-actions';
    let videoLink = null;
    ctas.forEach((p) => {
      p.querySelectorAll('a').forEach((a) => {
        const info = parseVideoUrl(a.href);
        if (info && isVideoLink && !videoLink) {
          videoLink = buildVideoLink(a, info);
        } else if (info) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = a.className; // carries `button primary` from decorateButtons
          btn.classList.add('icon-video');
          btn.textContent = a.textContent.trim();
          btn.setAttribute('data-track-id', `hero:${info.provider}-${info.id}`);
          btn.setAttribute('data-video-src', a.getAttribute('href'));
          btn.addEventListener('click', () => openVideoModal(info.embedUrl, btn.textContent));
          actions.append(btn);
        } else {
          actions.append(a);
        }
      });
    });
    if (actions.children.length) {
      ctas[0].replaceWith(actions);
      if (videoLink) actions.after(videoLink);
    } else {
      ctas[0].replaceWith(videoLink);
    }
    ctas.slice(1).forEach((p) => p.remove());
  }

  if (lockupEl) {
    const lockup = document.createElement('div');
    lockup.className = 'hero-lockup';
    lockup.append(lockupEl);
    copy.prepend(lockup);
  }

  const grid = document.createElement('div');
  grid.className = 'hero-grid';
  grid.append(copy);

  if (isForm) {
    grid.append(await leadCard(formFragment));
    if (mediaEl) {
      copy.append(mediaEl);
    } else {
      // Art-directed backdrop: when the section carries an image background (the
      // desktop composite) but no image was authored in the hero copy, mirror
      // that background as a contained copy image. hero.css shows the section
      // background on desktop and this image below 1024, where the stacked
      // layout renders the whole image with the form beneath it — the
      // background alone would cover-crop the subject at narrow widths.
      const bg = block.closest('.section')?.dataset.background || '';
      if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(bg)) {
        copy.append(createOptimizedPicture(new URL(bg, window.location.href).pathname));
      }
    }
  } else if (mediaEl && isCentered) {
    // logo lockup pinned above the headline instead of a media column
    const lockup = document.createElement('div');
    lockup.className = 'hero-lockup';
    lockup.append(mediaEl);
    copy.prepend(lockup);
  } else if (isIesVideo && videoSrc) {
    grid.append(buildTeaserVideo(videoSrcs, posterSrcs, loopVideo));
  } else if (isIesVideo && youtube) {
    const headline = heading?.textContent.trim();
    const title = youtube.label
      || posterEls[0]?.querySelector('img')?.alt
      || posterEls[0]?.alt
      || (headline ? `${headline} video` : 'Video');
    grid.append(buildYouTubeTile(youtube.info, youtube.href, posterEls, title));
  } else if (mediaEl) {
    const media = document.createElement('div');
    media.className = 'hero-media';
    media.append(mediaEl);
    grid.append(media);
    if (isIesGradient && (videoSrc || lottieSrc)) {
      addMotion(media, { video: videoSrc, lottie: lottieSrc, loop: loopVideo });
    } else {
      enhanceDashboardAnimation(media, mediaEl);
    }
  }

  block.replaceChildren(grid);

  if (isVideoBg) {
    const { bg, toggle, start } = buildBackgroundVideo(videoSrcs, fallbackEls);
    block.prepend(bg);
    if (toggle) block.append(toggle);
    start();
  } else if (videoSrc && !isIesVideo && !isIesGradient) {
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
