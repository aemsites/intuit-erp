/* Publishes the brand strip's visible height as --sgn-nav-top on the header so the
   widget CSS can keep the fixed global nav under the strip until it scrolls away. */
export default function decorate() {
  let stripHeight = 0;
  let ticking = false;

  const header = () => document.querySelector('header .header');

  const update = () => {
    ticking = false;
    const el = header();
    if (!el) return;
    el.style.setProperty('--sgn-nav-top', `${Math.max(0, stripHeight - window.scrollY)}px`);
  };

  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  const measure = () => {
    const strip = header()?.querySelector('.ies-topstrip');
    stripHeight = strip ? strip.offsetHeight : 0;
    schedule();
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });

  // The widget runs while the nav fragment is still loading, before the header
  // chrome exists, so measure once the chrome has been rendered.
  const observer = new MutationObserver(() => {
    if (!header()?.querySelector('.ies-nav')) return;
    observer.disconnect();
    measure();
  });
  observer.observe(document.querySelector('header') || document.body, { childList: true, subtree: true });
  measure();
}
