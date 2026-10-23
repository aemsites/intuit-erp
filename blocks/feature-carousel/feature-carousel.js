/**
 * feature-carousel — auto-advancing slides: copy on one side, a Lottie
 * animation, a video or an image on the other. Neighbouring slides peek in at the
 * edges; the active dot fills as a progress bar, then the next slide shows.
 *
 * Rows:
 *   optional first row — a single cell holding only a heading becomes the
 *     section title (h2)
 *   one row per slide, 2 cells:
 *     1. content — an italic-only eyebrow, a heading (title), body
 *        paragraph(s), a bold link (button), then an optional stat paragraph
 *        and an optional plain link
 *     2. media — a link to a Lottie .json or an .mp4/.webm video, and/or an
 *        image; the image stands in for the animation on slides that aren't
 *        on show, while it loads, if it fails, and for reduced motion. Without
 *        an image, those slides hold a middle frame of the animation instead
 *     3. color — the slide's color: blueberry, white, superblue or bronze; or
 *        "bg: <color>, btn: <color>" to also set the button (otherwise it
 *        follows the slide color)
 *
 * Variants:
 *   .lottie-length  each slide stays up for its animation's (or video's) length
 *                   instead of the fixed SLIDE_DURATION
 *
 * Auto-advance pauses on hover, keyboard focus, a hidden tab, and while the
 * block is off screen; it is off entirely for prefers-reduced-motion.
 * Hovering the active slide pauses its animation; clicking the active dot
 * pauses or resumes the carousel (any slide change resumes it).
 * CSS: blocks/feature-carousel/feature-carousel.css
 */
import { toClassName } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';

const SLIDE_DURATION = 35000; // ms
const SWIPE_THRESHOLD = 40; // px
const TRACK_SETTLE = 700; // ms, a little over the track's slide transition
const WARM_MARGIN = '600px'; // how far ahead of the viewport the first animation is built
const LOTTIE_PLAYER_URL = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm';
const LOTTIE_RE = /\.json(?:$|\?)/i;
const VIDEO_RE = /\.(?:mp4|webm)(?:$|\?)/i;
const isMotion = (href) => LOTTIE_RE.test(href) || VIDEO_RE.test(href);

let playerPromise;
const loadPlayer = () => {
  playerPromise ??= import(/* webpackIgnore: true */ LOTTIE_PLAYER_URL).then((m) => m.default);
  return playerPromise;
};

// A leading row whose only cell holds just a heading becomes an h2 title.
function takeTitleRow(block) {
  const row = block.firstElementChild;
  const cells = row ? [...row.children] : [];
  if (cells.length !== 1) return null;
  const nodes = [...cells[0].children];
  if (nodes.length !== 1 || !/^H[1-6]$/.test(nodes[0].tagName)) return null;
  const title = document.createElement('h2');
  title.className = 'feature-carousel-title';
  title.innerHTML = nodes[0].innerHTML;
  row.remove();
  return title;
}

function decorateCopy(cell) {
  cell.className = 'feature-carousel-copy';
  let afterButton = false;
  [...cell.children].forEach((node) => {
    if (/^H[1-6]$/.test(node.tagName)) {
      node.classList.add('feature-carousel-heading');
      return;
    }
    if (node.tagName !== 'P') return;
    const only = node.children.length === 1 ? node.children[0] : null;
    const text = node.textContent.trim();
    if (only?.tagName === 'EM' && text === only.textContent.trim()) {
      node.classList.add('feature-carousel-eyebrow');
      return;
    }
    if (node.classList.contains('button-wrapper')) {
      afterButton = true;
      return;
    }
    if (!afterButton) {
      node.classList.add('feature-carousel-body');
    } else if (only?.tagName === 'A' && text === only.textContent.trim()) {
      node.classList.add('feature-carousel-link');
    } else {
      node.classList.add('feature-carousel-stat');
    }
  });
}

const COLOR_KEYS = {
  bg: 'bg', background: 'bg', btn: 'btn', button: 'btn',
};

// "blueberry" or "bg: blueberry, btn: white" → { bg: 'blueberry', btn: 'white' }
function parseColors(text) {
  const colors = {};
  text.split(/[,;]/).forEach((part) => {
    const [key, value] = part.includes(':') ? part.split(':') : ['bg', part];
    const name = toClassName(value || '');
    const which = COLOR_KEYS[toClassName(key)];
    if (name && which) colors[which] = name;
  });
  return colors;
}

function decorateMedia(cell) {
  cell.className = 'feature-carousel-media';
  const link = [...cell.querySelectorAll('a[href]')].find((a) => isMotion(a.getAttribute('href')));
  const text = cell.textContent.trim();
  const src = link?.href || (isMotion(text) && !cell.querySelector('picture, img') ? text : '');
  const picture = cell.querySelector('picture, img');
  cell.replaceChildren(...(picture ? [picture.closest('picture') || picture] : []));
  return src;
}

export default async function decorate(block) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const useLottieLength = block.classList.contains('lottie-length');
  const title = takeTitleRow(block);
  const rows = [...block.children];
  if (!rows.length) return block;

  const track = document.createElement('div');
  track.className = 'feature-carousel-track';
  const dots = document.createElement('div');
  dots.className = 'feature-carousel-dots';

  const slides = rows.map((row, i) => {
    const [copyCell, mediaCell, colorCell] = [...row.children];
    const { bg, btn } = parseColors(colorCell?.textContent.trim() || '');
    colorCell?.remove();
    row.className = 'feature-carousel-slide';
    if (bg) row.classList.add(`feature-carousel-${bg}`);
    if (btn) row.classList.add(`feature-carousel-btn-${btn}`);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-roledescription', 'slide');
    row.setAttribute('aria-label', `${i + 1} of ${rows.length}`);
    if (copyCell) decorateCopy(copyCell);
    const mediaSrc = mediaCell ? decorateMedia(mediaCell) : '';
    const poster = !!mediaCell?.querySelector('picture, img');
    track.append(row);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'feature-carousel-dot';
    dot.setAttribute('aria-label', `Show slide ${i + 1}`);
    dot.innerHTML = '<span class="feature-carousel-dot-fill"></span>';
    dots.append(dot);

    return {
      row, media: mediaCell, dot, mediaSrc, poster, animation: null, ready: null,
    };
  });

  // copies of the last and first slides sit at either end so every slide has a neighbour
  const looped = slides.length > 1 && !reduceMotion;
  if (looped) {
    [[slides[slides.length - 1], 'prepend'], [slides[0], 'append']].forEach(([slide, where]) => {
      const copy = slide.row.cloneNode(true);
      copy.classList.add('is-clone');
      ['role', 'aria-roledescription', 'aria-label'].forEach((attr) => copy.removeAttribute(attr));
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      track[where](copy);
      slide.copyMedia = copy.querySelector('.feature-carousel-media');
    });
  }

  const viewport = document.createElement('div');
  viewport.className = 'feature-carousel-viewport';
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-roledescription', 'carousel');
  if (title) viewport.setAttribute('aria-label', title.textContent.trim());
  viewport.append(track);
  block.replaceChildren(...(title ? [title] : []), viewport, dots);

  let index = 0;
  let current = slides[0].row; // the track element on show: a slide or an edge copy

  // Each slide's animation (Lottie or video) is built once, while the browser
  // is idle, and then kept. Only the slide on show plays; the rest are paused behind
  // their image or, with no image to stand in, held on a middle frame.
  let live = null; // the slide whose animation is on show
  let activation = 0; // bumped by every goTo so stale async steps bail out

  const whenIdle = (fn) => (window.requestIdleCallback
    ? window.requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 200));

  const middleFrame = (animation) => Math.floor(animation.totalFrames / 2);

  // fades a media tile's animation in over its image, or back out
  const show = (media) => {
    if (media.classList.contains('has-motion')) return;
    // eslint-disable-next-line no-void -- force a reflow so the fade runs
    void media.offsetWidth;
    media.classList.add('has-motion');
  };
  const hide = (media) => media.classList.remove('has-motion');

  const createAnimation = async (media, animationData) => {
    const lottie = await loadPlayer();
    const holder = document.createElement('div');
    holder.className = 'feature-carousel-motion';
    holder.setAttribute('aria-hidden', 'true');
    media.append(holder);
    const animation = lottie.loadAnimation({
      container: holder, renderer: 'svg', loop: false, autoplay: false, animationData,
    });
    // draw only the file's own frames, not one per screen refresh
    animation.setSubframe(false);
    if (!animation.isLoaded) {
      await new Promise((resolve) => {
        animation.addEventListener('DOMLoaded', resolve, { once: true });
      });
    }
    return animation;
  };

  // a muted inline video behind the same calls the Lottie player takes
  // (its "frames" are seconds)
  const createVideo = async (media, src) => {
    const video = document.createElement('video');
    video.className = 'feature-carousel-motion';
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.playsInline = true;
    video.disablePictureInPicture = true;
    video.preload = 'auto';
    video.src = src;
    media.append(video);
    try {
      await new Promise((resolve, reject) => {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
      });
    } catch (error) {
      video.remove();
      throw error;
    }
    const play = () => video.play().catch(() => {});
    return {
      totalFrames: video.duration,
      getDuration: () => video.duration,
      play,
      pause: () => video.pause(),
      goToAndPlay: (time) => {
        video.currentTime = time;
        play();
      },
      goToAndStop: (time) => {
        video.currentTime = time;
        video.pause();
      },
    };
  };

  // resolves to the slide's animation, building it the first time, or null
  const ensureAnimation = (slide) => {
    if (!slide.mediaSrc || !slide.media) return Promise.resolve(null);
    slide.ready ??= (async () => {
      try {
        let build;
        if (VIDEO_RE.test(slide.mediaSrc)) {
          build = (media) => createVideo(media, slide.mediaSrc);
        } else {
          const res = await fetch(slide.mediaSrc);
          if (!res.ok) return null;
          const animationData = await res.json();
          build = (media) => createAnimation(media, animationData);
        }
        const animation = await build(slide.media);
        slide.animation = animation;
        if (!slide.poster) {
          // nothing to stand in for it: hold a middle frame, and give the
          // edge copy a still of its own
          animation.goToAndStop(middleFrame(animation), true);
          show(slide.media);
          if (slide.copyMedia) {
            const still = await build(slide.copyMedia);
            still.goToAndStop(middleFrame(still), true);
            show(slide.copyMedia);
          }
        }
        return animation;
      } catch {
        return null; // the image (if any) stays visible
      }
    })();
    return slide.ready;
  };

  const prepare = (slide) => whenIdle(() => ensureAnimation(slide));

  // takes a slide off show: its image (or a middle frame) stands in again
  const park = (slide) => {
    if (live === slide) live = null;
    const { animation } = slide;
    if (!animation) return;
    if (slide.poster) {
      animation.pause();
      hide(slide.media);
    } else {
      animation.goToAndStop(middleFrame(animation), true);
    }
  };

  // resolves once the track has finished sliding
  const settled = () => new Promise((resolve) => {
    let timer;
    const onEnd = (e) => {
      if (e.target !== track) return;
      clearTimeout(timer);
      track.removeEventListener('transitionend', onEnd);
      resolve();
    };
    timer = setTimeout(() => {
      track.removeEventListener('transitionend', onEnd);
      resolve();
    }, TRACK_SETTLE);
    track.addEventListener('transitionend', onEnd);
  });

  const durationFor = (slide) => {
    const seconds = useLottieLength ? slide.animation?.getDuration() : 0;
    return seconds ? seconds * 1000 : SLIDE_DURATION;
  };

  // centre `current` on the block (the viewport bleeds past it to show
  // neighbours); returns whether the track moves
  const center = (animate = true) => {
    const blockBox = block.getBoundingClientRect();
    const mid = blockBox.left + blockBox.width / 2 - viewport.getBoundingClientRect().left;
    const transform = `translateX(${mid - (current.offsetLeft + current.offsetWidth / 2)}px)`;
    const moved = track.style.transform !== transform;
    if (!animate) track.style.transition = 'none';
    track.style.transform = transform;
    if (!animate) {
      // eslint-disable-next-line no-void -- apply the jump before transitions come back
      void track.offsetWidth;
      track.style.transition = '';
    }
    return moved;
  };

  // after sliding onto an edge copy, jump to the real slide it stands for
  track.addEventListener('transitionend', (e) => {
    if (e.target !== track || !current.classList.contains('is-clone')) return;
    current = slides[index].row;
    center(false);
  });

  // pause reasons are tracked separately so one ending doesn't resume another;
  // hover and focus only hold the auto-advance, the animation keeps playing
  const pauses = new Set();
  const ANIMATION_PAUSES = ['offscreen', 'hidden', 'card', 'user'];
  const animationPaused = () => ANIMATION_PAUSES.some((reason) => pauses.has(reason));

  const labelDots = () => slides.forEach((s, i) => {
    let label = `Show slide ${i + 1}`;
    if (i === index && !reduceMotion) label = pauses.has('user') ? 'Resume carousel' : 'Pause carousel';
    s.dot.setAttribute('aria-label', label);
  });

  const goTo = async (next) => {
    activation += 1;
    const token = activation;
    index = (next + slides.length) % slides.length;
    const slide = slides[index];
    slides.forEach((s) => { if (s !== slide) park(s); });
    if (looped && next >= slides.length) current = track.lastElementChild;
    else if (looped && next < 0) current = track.firstElementChild;
    else current = slide.row;

    slides.forEach((s, i) => {
      const active = i === index;
      s.row.classList.toggle('is-active', active);
      s.row.inert = !active;
      s.dot.classList.toggle('is-active', active);
      if (active) s.dot.setAttribute('aria-current', 'true');
      else s.dot.removeAttribute('aria-current');
    });
    pauses.delete('card');
    pauses.delete('user');
    block.classList.toggle('is-paused', pauses.size > 0);
    labelDots();
    const moved = center();

    // restart the progress fill; its animationend advances the carousel
    slide.dot.style.setProperty('--feature-carousel-duration', `${durationFor(slide)}ms`);
    slide.dot.classList.remove('is-active');
    // eslint-disable-next-line no-void -- force a reflow so the fill animation restarts
    void slide.dot.offsetWidth;
    slide.dot.classList.add('is-active');

    // with reduced motion the image is enough
    if (reduceMotion && slide.poster) return;
    // keep the slide transition smooth: don't build an animation while the
    // track moves, and when arriving on an edge copy, fade in on the real
    // slide the track jumps back to
    if (moved && (!slide.ready || current.classList.contains('is-clone'))) {
      await settled();
      if (token !== activation) return;
    }
    const animation = await ensureAnimation(slide);
    if (!animation || token !== activation) return;
    if (useLottieLength) {
      slide.dot.style.setProperty('--feature-carousel-duration', `${durationFor(slide)}ms`);
    }
    if (reduceMotion) animation.goToAndStop(middleFrame(animation), true);
    else if (animationPaused()) animation.goToAndStop(0, true);
    else animation.goToAndPlay(0, true);
    show(slide.media);
    live = slide;
    if (!reduceMotion) prepare(slides[(index + 1) % slides.length]);
  };

  const setPaused = (reason, on) => {
    if (on) pauses.add(reason); else pauses.delete(reason);
    block.classList.toggle('is-paused', pauses.size > 0);
    if (!live || reduceMotion) return;
    if (animationPaused()) live.animation.pause(); else live.animation.play();
  };
  if (reduceMotion) block.classList.add('no-autoplay');

  dots.addEventListener('animationend', (e) => {
    if (e.target.classList.contains('feature-carousel-dot-fill')) goTo(index + 1);
  });
  slides.forEach((s, i) => {
    s.dot.addEventListener('click', () => {
      if (i !== index || reduceMotion) {
        goTo(i);
        return;
      }
      setPaused('user', !pauses.has('user'));
      labelDots();
    });
    s.row.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') setPaused('card', true);
    });
    s.row.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') setPaused('card', false);
    });
  });

  block.addEventListener('pointerenter', () => setPaused('hover', true));
  block.addEventListener('pointerleave', () => setPaused('hover', false));
  // keyboard focus only: a mouse click on a dot also focuses it
  block.addEventListener('focusin', (e) => {
    if (e.target.matches(':focus-visible')) setPaused('focus', true);
  });
  block.addEventListener('focusout', (e) => {
    if (!block.contains(e.relatedTarget)) setPaused('focus', false);
  });
  document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden));

  block.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goTo(index + 1);
    else if (e.key === 'ArrowLeft') goTo(index - 1);
  });

  let startX = null;
  viewport.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  viewport.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD) goTo(index + (dx < 0 ? 1 : -1));
  });
  viewport.addEventListener('pointercancel', () => { startX = null; });

  window.addEventListener('resize', () => center(false));

  // start once the block is on screen; pause while it is off screen
  setPaused('offscreen', true);
  if (window.IntersectionObserver) {
    // build the first animation shortly before the block scrolls into view
    if (!(reduceMotion && slides[0].poster)) {
      const warm = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        warm.disconnect();
        prepare(slides[0]);
      }, { rootMargin: `${WARM_MARGIN} 0px` });
      warm.observe(block);
    }
    let started = false;
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started) {
        started = true;
        goTo(0);
      }
      setPaused('offscreen', !entry.isIntersecting);
    }, { threshold: 0.3 }).observe(block);
  } else {
    setPaused('offscreen', false);
    goTo(0);
  }
  // position before the first slide is activated so the layout doesn't jump
  slides[0].row.classList.add('is-active');
  requestAnimationFrame(() => center(false));

  return trackAs('rw_feature_carousel', block, {
    key: 'feature-carousel',
    items: { '.feature-carousel-slide:not(.is-clone)': (i) => `rw_slide_${i}` },
  });
}
