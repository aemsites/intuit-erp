/* Sets --sgn-nav-top to the sticky promo banner's height plus the brand strip's visible
   height so the fixed nav sits under both */
export default function decorate() {
  let stripHeight = 0;
  let ticking = false;

  const header = () => document.querySelector('header .header');

  const update = () => {
    ticking = false;
    const el = header();
    if (!el) return;
    // body > .promo-banner-wrapper is sticky at top:0 with a higher z-index than the nav
    const promoBannerHeight = document.querySelector('body > .promo-banner-wrapper')?.offsetHeight || 0;
    el.style.setProperty('--sgn-nav-top', `${promoBannerHeight + Math.max(0, stripHeight - window.scrollY)}px`);
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
  window.addEventListener('promo-banner-resize', schedule);

  const observer = new MutationObserver(() => {
    if (!header()?.querySelector('.ies-nav')) return;
    observer.disconnect();
    measure();
  });
  observer.observe(document.querySelector('header') || document.body, { childList: true, subtree: true });
  measure();
}
