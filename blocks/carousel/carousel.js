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
 *   .testimonial   dark band, quote + photo/video ("Trusted by firms")
 *   .cards         customer-story/article cards (index/events/construction
 *                  card sliders)
 * CSS: blocks/carousel/carousel.css
 */

const SWIPE_THRESHOLD = 40; // px — minimum horizontal drag to change slides

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

export default function decorate(block) {
  const slides = [...block.querySelectorAll(':scope > div')];
  if (!slides.length) return;

  slides.forEach((slide, i) => {
    slide.className = 'carousel-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `Slide ${i + 1} of ${slides.length}`);
  });

  const track = document.createElement('div');
  track.className = 'carousel-track';
  track.append(...slides);

  const viewport = document.createElement('div');
  viewport.className = 'carousel-viewport';
  viewport.append(track);

  const prevBtn = buildArrow('prev', 'Previous slide', '‹');
  const nextBtn = buildArrow('next', 'Next slide', '›');

  const dotsWrap = document.createElement('div');
  dotsWrap.className = 'carousel-dots';
  const dots = slides.map((_, i) => buildDot(i));
  dotsWrap.append(...dots);

  const controls = document.createElement('div');
  controls.className = 'carousel-controls';
  controls.append(prevBtn, dotsWrap, nextBtn);

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
    const first = slides[0];
    if (!first) return;
    const { width } = first.getBoundingClientRect();
    const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
    track.style.transform = `translateX(-${(width + gap) * current}px)`;
  }

  function goTo(index) {
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    current = clamped;
    slides.forEach((slide, i) => {
      const active = i === clamped;
      slide.classList.toggle('is-active', active);
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
    applyOffset();
    prevBtn.disabled = clamped === 0;
    nextBtn.disabled = clamped === slides.length - 1;
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
