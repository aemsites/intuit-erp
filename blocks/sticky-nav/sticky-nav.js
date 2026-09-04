function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
}

// Extends the scroll margin to also clear a preceding eyebrow paragraph, so
// the anchor doesn't land with the eyebrow hidden under the fixed nav bar.
// The extra breathing room below the eyebrow scales with its own line-height
// (2 lines' worth) instead of a fixed pixel guess, so it still looks right
// wherever this pattern is reused with a different eyebrow type scale.
function scrollMarginFor(target) {
  const prev = target.previousElementSibling;
  const coversEyebrow = prev && prev.tagName === 'P' && !prev.querySelector('a, img, picture');
  if (!coversEyebrow) return 0;
  const gap = target.getBoundingClientRect().top - prev.getBoundingClientRect().top;
  const computedLineHeight = parseFloat(getComputedStyle(prev).lineHeight);
  const lineHeight = computedLineHeight || prev.getBoundingClientRect().height;
  return gap + (lineHeight * 2);
}

export default function decorate(block) {
  const ul = block.querySelector('ul');
  if (!ul) return;
  block.replaceChildren(ul);

  const links = [...ul.querySelectorAll('a')];

  const setActive = (current) => links.forEach((a) => a.classList.toggle('active', a === current));

  links.forEach((a) => {
    const target = targetFor(a);
    a.addEventListener('click', (e) => {
      if (!target) return;
      e.preventDefault();
      setActive(a);
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

  if (links[0]) setActive(links[0]);

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
      // Match by element identity, not href: the nav links are authored as full
      // paths with a hash (e.g. `/path/to/page#section`), so comparing the raw
      // href against `#id` never matches and would clear every active state.
      entries.filter((en) => en.isIntersecting).forEach((en) => {
        setActive(links.find((a) => targetFor(a) === en.target));
      });
    }, { rootMargin: `-${navH}px 0px -70% 0px`, threshold: 0 });
    links.map(targetFor).filter(Boolean).forEach((t) => spy.observe(t));
  }));
}
