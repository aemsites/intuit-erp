function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
}

// Only headings get an auto-generated id (see decorateMain), so a target is
// always a heading — but that heading isn't always the first visible thing in
// its section. An eyebrow paragraph authored immediately before it (e.g. the
// media-text content model: eyebrow, then h2) sits above the heading and
// would be scrolled past if the heading's own top were the landing point.
// Extend the scroll margin to also clear any such immediately-preceding
// sibling, so the anchor lands at the section's true visual top either way.
function scrollMarginFor(target) {
  const prev = target.previousElementSibling;
  const coversEyebrow = prev && prev.tagName === 'P' && !prev.querySelector('a, img, picture');
  return coversEyebrow ? prev.getBoundingClientRect().height : 0;
}

export default function decorate(block) {
  const ul = block.querySelector('ul');
  if (!ul) return;
  block.replaceChildren(ul);

  const links = [...ul.querySelectorAll('a')];
  const navH = block.offsetHeight;
  document.body.style.setProperty('--sticky-nav-h', `${navH}px`);

  links.forEach((a) => {
    const target = targetFor(a);
    if (target) target.style.scrollMarginTop = `${navH + scrollMarginFor(target)}px`;
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

  // scrollspy: activate the link whose section is under the bar
  if (links[0]) links[0].classList.add('active');
  const spy = new IntersectionObserver((entries) => {
    entries.filter((en) => en.isIntersecting).forEach((en) => {
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: `-${navH}px 0px -70% 0px`, threshold: 0 });
  links.map(targetFor).filter(Boolean).forEach((t) => spy.observe(t));
}
