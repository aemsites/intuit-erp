/* Sets --sgn-nav-top to the brand strip's visible height so the fixed nav sits under it */
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

  const observer = new MutationObserver(() => {
    if (!header()?.querySelector('.ies-nav')) return;
    observer.disconnect();
    measure();
  });
  observer.observe(document.querySelector('header') || document.body, { childList: true, subtree: true });
  measure();
}
