function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
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
      // Scroll the whole section into view, not just the heading: these
      // sections open with an image that sits well above their heading, and
      // aiming at the heading alone leaves that image clipped by the bar.
      (target.closest('.section') || target).scrollIntoView({ behavior: 'smooth' });
      // Push the fragment alone: these links are sometimes authored with a full
      // path (e.g. a leftover draft path) before the hash, and the address bar
      // should reflect the page the visitor is actually on.
      window.history.pushState(null, '', `#${target.id}`);
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
      if (target) target.classList.add('sticky-nav-target');
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
