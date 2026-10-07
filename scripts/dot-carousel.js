/**
 * dot-carousel — shared helper for blocks that collapse a card grid into a
 * horizontally scroll-snapped carousel with dot navigation on small screens
 * (Figma "02 - Dot Carousel (Mobile)"). Purely additive: the track is the
 * block's existing card container, so the desktop grid markup is untouched and
 * CSS decides at which width the carousel behavior applies.
 *
 * @param {Element} track scrollable element whose direct children are slides
 * @param {string} label accessible name for the dot navigation
 * @returns {Element} the dot navigation element (appended after the track)
 */
export default function buildDotCarousel(track, label = 'Carousel') {
  const slides = [...track.children];
  if (slides.length < 2) return null;

  const nav = document.createElement('div');
  nav.className = 'dot-carousel-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', label);

  const dots = slides.map((slide, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'dot-carousel-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Slide ${i + 1} of ${slides.length}`);
    dot.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    dot.addEventListener('click', () => {
      slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    nav.append(dot);
    return dot;
  });

  const setActive = (index) => {
    dots.forEach((dot, i) => dot.setAttribute('aria-selected', i === index ? 'true' : 'false'));
  };

  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      slides.forEach((slide, i) => {
        const mid = slide.offsetLeft + slide.offsetWidth / 2;
        const dist = Math.abs(mid - center);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setActive(best);
    });
  }, { passive: true });

  track.after(nav);
  return nav;
}
