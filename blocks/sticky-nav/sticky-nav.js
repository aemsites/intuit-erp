function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
}

// Extra breathing room below the nav bar when a target has an eyebrow above it.
const EYEBROW_LANDING_GAP = 60;

// Extends the scroll margin to also clear a preceding eyebrow paragraph, so
// the anchor doesn't land with the eyebrow hidden under the fixed nav bar.
function scrollMarginFor(target) {
  const prev = target.previousElementSibling;
  const coversEyebrow = prev && prev.tagName === 'P' && !prev.querySelector('a, img, picture');
  if (!coversEyebrow) return 0;
  const gap = target.getBoundingClientRect().top - prev.getBoundingClientRect().top;
  return gap + EYEBROW_LANDING_GAP;
}

export default function decorate(block) {
  const ul = block.querySelector('ul');
  if (!ul) return;
  block.replaceChildren(ul);

  const links = [...ul.querySelectorAll('a')];

  links.forEach((a) => {
    const target = targetFor(a);
    a.addEventListener('click', (e) => {
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
      window.history.pushState(null, '', a.getAttribute('href'));
    });
  });

  // stick to top once scrolled past: sentinel toggles fixed state, spacer holds
  // the space it vacates, and the body class hides the global (also-fixed) header
  const sentinel = document.createElement('div');
  const spacer = document.createElement('div');
  spacer.className = 'sticky-nav-spacer';
  block.before(sentinel);
  block.before(spacer);

  new IntersectionObserver(([e]) => {
    const stuck = e.boundingClientRect.top < 0;
    block.classList.toggle('is-fixed', stuck);
    document.body.classList.toggle('sticky-nav-active', stuck);
  }, { threshold: 0 }).observe(sentinel);

  if (links[0]) links[0].classList.add('active');

  // defer past decorate()'s own CSS load so offsetHeight/getBoundingClientRect
  // reads reflect real, styled layout instead of 0
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const navH = block.offsetHeight;
    document.body.style.setProperty('--sticky-nav-h', `${navH}px`);

    links.forEach((a) => {
      const target = targetFor(a);
      if (target) target.style.scrollMarginTop = `${navH + scrollMarginFor(target)}px`;
    });

    // scrollspy: activate the link whose section is under the bar
    const spy = new IntersectionObserver((entries) => {
      entries.filter((en) => en.isIntersecting).forEach((en) => {
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
      });
    }, { rootMargin: `-${navH}px 0px -70% 0px`, threshold: 0 });
    links.map(targetFor).filter(Boolean).forEach((t) => spy.observe(t));
  }));
}
