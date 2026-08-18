/**
 * carousel — one-card-at-a-time slider with prev/next arrows, dots,
 * keyboard (Arrow keys), and pointer swipe.
 *
 * Content model: each `:scope > div` row is one slide (arbitrary rich cell
 * content — media <img>, heading, quote/body, optional CTA/video link).
 * Rows are reused in place as `.carousel-slide` elements inside a
 * `.carousel-track` — no content is copied, so authored markup (links,
 * embeds, etc.) survives untouched.
 *
 * Variants:
 *   .testimonial   quote + portrait card ("Trusted by firms"); see
 *                  normalizeTestimonial below
 *   .cards         customer-story/article cards (index/events/construction
 *                  card sliders)
 * CSS: blocks/carousel/carousel.css
 */

import { loadCSS } from '../../scripts/aem.js';
import { videoInfo } from '../video/video-info.js';

const SWIPE_THRESHOLD = 40; // px — minimum horizontal drag to change slides

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

const PLAY_ICON = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6.5l5 3.5-5 3.5z" fill="currentColor"/></svg>';

function buildArrow(direction, label, glyph) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `carousel-${direction}`;
  btn.setAttribute('aria-label', label);
  btn.textContent = glyph;
  return btn;
}

function buildDot(index) {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'carousel-dot';
  dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
  return dot;
}

/**
 * A navigation control that shows the slide's own customer photo as a circular
 * avatar (the `.spotlight` testimonial's thumbnail strip). Falls back to a plain
 * dot-style button when a slide has no image. `slide` is already normalised, so
 * its portrait lives at `.testi-media img`.
 * @param {Element} slide a normalised `.carousel-slide`
 * @param {number} index the slide's position
 */
function buildThumb(slide, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'carousel-thumb';
  btn.setAttribute('aria-label', `Go to slide ${index + 1}`);
  const src = slide.querySelector('img')?.getAttribute('src');
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img);
  }
  return btn;
}

/**
 * `.feature` slides author the pull-quote and its attribution as one string,
 * separated by an em dash: `“…quote…” — Name, Role, Company`. The source
 * styles those as two distinct blocks (40px quote, 16px attribution), so split
 * them into separate elements. Left alone if there's no dash to split on.
 * @param {Element} slide a `.carousel-slide`
 */
function splitFeatureQuote(slide) {
  const copyCell = [...slide.children].find((c) => !c.querySelector('picture, img'));
  const p = copyCell?.querySelector('p');
  if (!p) return;
  const raw = p.textContent;
  const dash = raw.lastIndexOf('—');
  if (dash === -1) return;
  const quote = raw.slice(0, dash).trim();
  const attribution = raw.slice(dash + 1).trim();
  if (!quote || !attribution) return;
  p.textContent = quote;
  p.className = 'carousel-quote';
  const cite = document.createElement('p');
  cite.className = 'carousel-attribution';
  cite.textContent = attribution;
  p.after(cite);
}

/**
 * Opens a video in a dismissible lightbox, reusing the `.video-modal-*` markup
 * and styles that blocks/video owns.
 * @param {string} embedUrl provider embed URL
 * @param {string} title accessible iframe title
 */
function openVideoModal(embedUrl, title) {
  // guard against a double-click or two different CTAs stacking overlays
  if (document.querySelector('.video-modal-overlay')) return;
  loadCSS(`${window.hlx.codeBasePath}/blocks/video/video.css`);
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  const frame = document.createElement('div');
  frame.className = 'video-modal-frame';
  const iframe = document.createElement('iframe');
  iframe.src = embedUrl;
  iframe.title = title || 'Video';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  frame.append(iframe);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'video-modal-close';
  close.setAttribute('aria-label', 'Close video');
  close.textContent = '×';
  const modal = document.createElement('div');
  modal.className = 'video-modal';
  modal.append(close, frame);
  overlay.append(modal);

  function dismiss() {
    overlay.remove();
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') dismiss(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

/**
 * Rewrites one `.testimonial` slide into `.testi-media` + `.testi-body`.
 *
 * Authors have produced three different shapes for this block — four cells
 * (`image | quote | attribution | link`), and two single-cell variants that
 * differ in whether they open with a heading. Rather than branch per shape,
 * every block-level part is collected in document order and classified by what
 * it holds, so all three read into the same model: the part with a picture is
 * the media, a heading is the title, a part with a link is the CTA, and the
 * remaining text is the quote followed by the attribution.
 *
 * A title is not decoration — upstream keys the whole treatment off it (no
 * title means a 40px quote against a flush image, a title means a 20px quote
 * beside an inset one), so it is surfaced as `.has-title` on the block.
 * @param {Element} slide a `.carousel-slide`
 * @returns {boolean} true when the slide has a title
 */
function normalizeTestimonial(slide) {
  const parts = [...slide.children].flatMap((cell) => {
    const kids = [...cell.children];
    return kids.length ? kids : [cell];
  });

  const media = parts.find((p) => p.matches('picture, img') || p.querySelector('picture, img'));
  const title = parts.find((p) => p !== media && p.matches(HEADINGS));
  // a link is only a CTA when it is the whole part — an inline link inside the
  // quote or attribution stays where it was authored
  const ctaPart = parts.find((p) => {
    if (p === media || p === title) return false;
    const a = p.matches('a[href]') ? p : p.querySelector('a[href]');
    return a && p.textContent.trim() === a.textContent.trim();
  });
  const text = parts.filter((p) => p !== media && p !== title && p !== ctaPart
    && p.textContent.trim());

  const body = document.createElement('div');
  body.className = 'testi-body';

  if (title) {
    const t = document.createElement('p');
    t.className = 'testi-title';
    t.append(...title.childNodes);
    body.append(t);
  }

  // the attribution is always last; anything before it belongs to the quote,
  // which may run to more than one paragraph
  const attr = text.length > 1 ? text.pop() : null;
  text.forEach((p) => {
    const q = document.createElement('p');
    q.className = 'testi-quote';
    q.append(...p.childNodes);
    body.append(q);
  });
  if (attr) {
    const a = document.createElement('p');
    a.className = 'testi-attr';
    a.append(...attr.childNodes);
    // authored as a bold name over a line break (`**Name**<br>Company`), which
    // renders as one run of unspaced text at this size — upstream sets it as a
    // single comma-separated line, so flatten it rather than ask every page to
    // be re-authored
    a.querySelectorAll('br').forEach((br) => br.replaceWith(', '));
    a.textContent = a.textContent.replace(/\s*,\s*/g, ', ').replace(/,\s*$/, '').trim();
    body.append(a);
  }

  const link = ctaPart && (ctaPart.matches('a[href]') ? ctaPart : ctaPart.querySelector('a[href]'));
  if (link) {
    const wrap = document.createElement('div');
    wrap.className = 'testi-cta';
    const info = videoInfo(link.getAttribute('href'));
    if (info) {
      // a video CTA plays in place rather than navigating off the page, which
      // is what upstream does and what every authored link here points at.
      // Preload the modal's styles now so the first click doesn't paint an
      // unstyled overlay while video.css is still fetching.
      loadCSS(`${window.hlx.codeBasePath}/blocks/video/video.css`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'testi-cta-button';
      btn.innerHTML = PLAY_ICON;
      const label = document.createElement('span');
      label.textContent = link.textContent.trim();
      btn.append(label);
      btn.addEventListener('click', () => openVideoModal(info.embedUrl, link.textContent.trim()));
      wrap.append(btn);
    } else {
      link.classList.add('testi-cta-button');
      wrap.append(link);
    }
    body.append(wrap);
  }

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'testi-media';
  // media is either the picture/img itself (four-cell shape) or a wrapper
  // around it (single-cell shapes) — querying inside an already-matched
  // picture would return its bare <img> and drop its <source> variants
  if (media) mediaWrap.append(media.matches('picture, img') ? media : (media.querySelector('picture, img') || media));

  slide.replaceChildren(mediaWrap, body);
  return !!title;
}

export default function decorate(block) {
  const slides = [...block.querySelectorAll(':scope > div')];
  if (!slides.length) return;

  const isFeature = block.classList.contains('feature');
  const isTestimonial = block.classList.contains('testimonial');
  // .spotlight swaps the dot strip for a row of customer-photo thumbnails plus
  // an "N of N" counter, matching erp.intuit.com's C14 testimonial controls
  const isSpotlight = isTestimonial && block.classList.contains('spotlight');
  let hasTitle = false;

  slides.forEach((slide, i) => {
    slide.className = 'carousel-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `Slide ${i + 1} of ${slides.length}`);
    if (isFeature) splitFeatureQuote(slide);
    if (isTestimonial && normalizeTestimonial(slide)) hasTitle = true;
  });

  if (hasTitle) block.classList.add('has-title');

  const track = document.createElement('div');
  track.className = 'carousel-track';
  track.append(...slides);

  const viewport = document.createElement('div');
  viewport.className = 'carousel-viewport';
  viewport.append(track);

  const prevBtn = buildArrow('prev', 'Previous slide', '‹');
  const nextBtn = buildArrow('next', 'Next slide', '›');

  // .spotlight navigates with photo thumbnails + a counter; every other variant
  // uses the dot strip. Only one set is built, so goTo below updates whichever
  // exists (the other stays an empty array / null).
  const dotsWrap = document.createElement('div');
  dotsWrap.className = isSpotlight ? 'carousel-thumbs' : 'carousel-dots';
  const dots = isSpotlight
    ? slides.map((slide, i) => buildThumb(slide, i))
    : slides.map((_, i) => buildDot(i));
  dotsWrap.append(...dots);

  const counter = isSpotlight ? document.createElement('p') : null;
  if (counter) counter.className = 'carousel-counter';

  const controls = document.createElement('div');
  controls.className = 'carousel-controls';
  controls.append(prevBtn, dotsWrap, ...(counter ? [counter] : []), nextBtn);

  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  block.replaceChildren(viewport, controls);

  let current = 0;

  // Slides may show several-per-view (the .cards variant, sized via the
  // --carousel-cards-per-view custom property in CSS breakpoints), but
  // navigation always moves exactly one slide at a time. A flat
  // translateX(-100%) would jump a whole viewport-width (i.e. several
  // cards) per step, so the offset is measured in real pixels from the
  // slide's own rendered width instead of assumed from the index alone.
  function applyOffset() {
    // .spotlight stacks its slides and cross-fades between them (see CSS), so
    // there's no horizontal track to translate
    if (isSpotlight) return;
    const first = slides[0];
    if (!first) return;
    const { width } = first.getBoundingClientRect();
    const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
    track.style.transform = `translateX(-${(width + gap) * current}px)`;
  }

  function goTo(index) {
    // .spotlight loops (past the last slide wraps to the first, and vice versa);
    // every other variant clamps at the ends
    const clamped = isSpotlight
      ? (index + slides.length) % slides.length
      : Math.max(0, Math.min(index, slides.length - 1));
    current = clamped;
    slides.forEach((slide, i) => {
      const active = i === clamped;
      slide.classList.toggle('is-active', active);
      // .spotlight peeks the neighbouring customer photos behind the active
      // card; mark them so CSS can offset each one (with wrap-around)
      if (isSpotlight) {
        const prevIdx = (clamped - 1 + slides.length) % slides.length;
        const nextIdx = (clamped + 1) % slides.length;
        slide.classList.toggle('is-prev', i === prevIdx);
        slide.classList.toggle('is-next', i === nextIdx);
      }
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      // keep focusable content inside off-screen slides out of the tab
      // order (aria-hidden alone doesn't stop keyboard focus)
      slide.inert = !active;
    });
    dots.forEach((dot, i) => {
      const active = i === clamped;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });
    if (counter) counter.textContent = `${clamped + 1} of ${slides.length}`;
    applyOffset();
    // spotlight loops, so its arrows never disable
    prevBtn.disabled = !isSpotlight && clamped === 0;
    nextBtn.disabled = !isSpotlight && clamped === slides.length - 1;
  }

  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  block.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(current + 1);
    }
  });

  // Pointer swipe — guarded so a lack of real PointerEvent geometry (e.g.
  // under jsdom in unit tests) never throws; only real pointer events with
  // clientX drive navigation.
  let pointerStartX = null;
  track.addEventListener('pointerdown', (e) => {
    pointerStartX = typeof e.clientX === 'number' ? e.clientX : null;
  });
  track.addEventListener('pointerup', (e) => {
    if (pointerStartX === null || typeof e.clientX !== 'number') {
      pointerStartX = null;
      return;
    }
    const delta = e.clientX - pointerStartX;
    pointerStartX = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    if (delta < 0) goTo(current + 1);
    else goTo(current - 1);
  });
  track.addEventListener('pointercancel', () => { pointerStartX = null; });

  window.addEventListener('resize', applyOffset);

  goTo(0);
}
