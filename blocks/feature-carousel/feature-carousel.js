/**
 * feature-carousel — auto-advancing slides: copy on one side, a Lottie
 * animation (or an image) on the other. Neighbouring slides peek in at the
 * edges; the active dot fills as a progress bar, then the next slide shows.
 *
 * Rows:
 *   optional first row — a single cell holding only a heading becomes the
 *     section title (h2)
 *   one row per slide, 2 cells:
 *     1. content — an italic-only eyebrow, a heading (title), body
 *        paragraph(s), a bold link (button), then an optional stat paragraph
 *        and an optional plain link
 *     2. media — a link to a Lottie .json and/or an image; the image shows
 *        while the animation loads, if it fails, and for reduced motion
 *     3. color — the slide's color: blueberry, white, superblue or bronze
 *
 * Variants:
 *   .lottie-length  each slide stays up for its animation's length instead of
 *                   the fixed SLIDE_DURATION
 *
 * Auto-advance pauses on hover, keyboard focus, a hidden tab, and while the
 * block is off screen; it is off entirely for prefers-reduced-motion.
 * CSS: blocks/feature-carousel/feature-carousel.css
 */
import { toClassName } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';

const SLIDE_DURATION = 10000; // ms
const SWIPE_THRESHOLD = 40; // px
const LOTTIE_PLAYER_URL = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm';
const LOTTIE_RE = /\.json(?:$|\?)/i;

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

function decorateMedia(cell) {
  cell.className = 'feature-carousel-media';
  const link = [...cell.querySelectorAll('a[href]')].find((a) => LOTTIE_RE.test(a.getAttribute('href')));
  const text = cell.textContent.trim();
  const src = link?.href || (LOTTIE_RE.test(text) && !cell.querySelector('picture, img') ? text : '');
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
    const color = toClassName(colorCell?.textContent.trim() || '');
    colorCell?.remove();
    row.className = 'feature-carousel-slide';
    if (color) row.classList.add(`feature-carousel-${color}`);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-roledescription', 'slide');
    row.setAttribute('aria-label', `${i + 1} of ${rows.length}`);
    if (copyCell) decorateCopy(copyCell);
    const lottieSrc = mediaCell ? decorateMedia(mediaCell) : '';
    track.append(row);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'feature-carousel-dot';
    dot.setAttribute('aria-label', `Show slide ${i + 1}`);
    dot.innerHTML = '<span class="feature-carousel-dot-fill"></span>';
    dots.append(dot);

    return {
      row, media: mediaCell, dot, lottieSrc, animation: null, loading: null,
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

  // Loads a slide's animation once; resolves to the Lottie instance or null.
  const loadAnimation = (slide) => {
    if (!slide.lottieSrc || !slide.media) return Promise.resolve(null);
    slide.loading ??= (async () => {
      try {
        const [lottie, res] = await Promise.all([loadPlayer(), fetch(slide.lottieSrc)]);
        if (!res.ok) return null;
        const animationData = await res.json();
        const holder = document.createElement('div');
        holder.className = 'feature-carousel-lottie';
        holder.setAttribute('aria-hidden', 'true');
        slide.media.append(holder);
        const animation = lottie.loadAnimation({
          container: holder, renderer: 'svg', loop: false, autoplay: false, animationData,
        });
        if (!animation.isLoaded) {
          await new Promise((resolve) => { animation.addEventListener('DOMLoaded', resolve); });
        }
        slide.media.classList.add('has-lottie');
        slide.animation = animation;
        // the edge copy shows the first frame
        if (slide.copyMedia) {
          const copyHolder = holder.cloneNode(false);
          slide.copyMedia.append(copyHolder);
          const still = lottie.loadAnimation({
            container: copyHolder, renderer: 'svg', loop: false, autoplay: false, animationData,
          });
          const showStill = () => {
            still.goToAndStop(0, true);
            slide.copyMedia.classList.add('has-lottie');
          };
          if (still.isLoaded) showStill();
          else still.addEventListener('DOMLoaded', showStill);
        }
        return animation;
      } catch {
        return null; // the image (if any) stays visible
      }
    })();
    return slide.loading;
  };

  const durationFor = (slide) => {
    const seconds = useLottieLength ? slide.animation?.getDuration() : 0;
    return seconds ? seconds * 1000 : SLIDE_DURATION;
  };

  // centre `current` on the block (the viewport bleeds past it to show neighbours)
  const center = (animate = true) => {
    const blockBox = block.getBoundingClientRect();
    const mid = blockBox.left + blockBox.width / 2 - viewport.getBoundingClientRect().left;
    if (!animate) track.style.transition = 'none';
    track.style.transform = `translateX(${mid - (current.offsetLeft + current.offsetWidth / 2)}px)`;
    if (!animate) {
      // eslint-disable-next-line no-void -- apply the jump before transitions come back
      void track.offsetWidth;
      track.style.transition = '';
    }
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
  const animationPaused = () => pauses.has('offscreen') || pauses.has('hidden');

  const goTo = async (next) => {
    const prev = slides[index];
    prev.animation?.stop();
    index = (next + slides.length) % slides.length;
    const slide = slides[index];
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
    center();

    // restart the progress fill; its animationend advances the carousel
    slide.dot.style.setProperty('--feature-carousel-duration', `${durationFor(slide)}ms`);
    slide.dot.classList.remove('is-active');
    // eslint-disable-next-line no-void -- force a reflow so the fill animation restarts
    void slide.dot.offsetWidth;
    slide.dot.classList.add('is-active');

    const animation = await loadAnimation(slide);
    if (!animation || slide !== slides[index]) return;
    if (useLottieLength) {
      slide.dot.style.setProperty('--feature-carousel-duration', `${durationFor(slide)}ms`);
    }
    if (reduceMotion || animationPaused()) animation.goToAndStop(0, true);
    else animation.goToAndPlay(0, true);
    // warm the next slide's animation so it is ready when it shows
    loadAnimation(slides[(index + 1) % slides.length]);
  };

  const setPaused = (reason, on) => {
    if (on) pauses.add(reason); else pauses.delete(reason);
    block.classList.toggle('is-paused', pauses.size > 0);
    const { animation } = slides[index];
    if (!animation || reduceMotion) return;
    if (animationPaused()) animation.pause(); else animation.play();
  };
  if (reduceMotion) block.classList.add('no-autoplay');

  dots.addEventListener('animationend', (e) => {
    if (e.target.classList.contains('feature-carousel-dot-fill')) goTo(index + 1);
  });
  slides.forEach((s, i) => s.dot.addEventListener('click', () => goTo(i)));

  block.addEventListener('pointerenter', () => setPaused('hover', true));
  block.addEventListener('pointerleave', () => setPaused('hover', false));
  block.addEventListener('focusin', () => setPaused('focus', true));
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
