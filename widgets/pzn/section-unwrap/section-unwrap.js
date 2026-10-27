/* Authored inside a section-scoped PZN/IXP fragment: once the swap drops the fragment's
   section into the page section, lift its children up a level so the page never ends up with
   a section inside a section (which re-paints section-scoped backgrounds like the hero arcs). */
// The other blocks in the fragment (e.g. a hero video) finish loading before the swap inserts it.
const MAX_FRAMES = 600;

// Mirrors the hero's extendArcsBackground: it ran while the fragment was detached (no next
// section to measure), so re-measure the logo band now that the hero sits in the page section.
function extendArcsTail(section) {
  if (!section.querySelector('.hero.ies.arcs')) return;
  const tail = section.nextElementSibling;
  if (!tail?.querySelector('.logo-band.marquee:not(.light)') || !window.ResizeObserver) return;
  new ResizeObserver(() => {
    section.style.setProperty('--hero-arcs-tail', `${tail.offsetHeight}px`);
  }).observe(tail);
}

function unwrap(widget) {
  const inner = widget.closest('.section');
  const outer = inner?.parentElement?.closest('.section');
  (widget.closest('.section-unwrap-wrapper') || widget).remove();
  if (!inner || !outer || inner.parentElement !== outer) return;
  inner.replaceWith(...inner.childNodes);
  extendArcsTail(outer);
}

export default function decorate(widget) {
  // The fragment is decorated detached; wait until the swap inserts it, then unwrap before paint.
  let frames = 0;
  const tick = () => {
    if (widget.isConnected) unwrap(widget);
    else if (frames < MAX_FRAMES) {
      frames += 1;
      requestAnimationFrame(tick);
    }
  };
  tick();
}
