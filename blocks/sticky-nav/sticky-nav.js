function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
}

export default function decorate(block) {
  const ul = block.querySelector('ul');
  if (!ul) return;
  block.replaceChildren(ul);

  const links = [...ul.querySelectorAll('a')];

  let pastStart = false;
  let pastEnd = false;
  let activeLink = links[0];

  const render = () => {
    const current = pastEnd ? null : activeLink;
    links.forEach((a) => a.classList.toggle('active', a === current));
  };

  const setActive = (a) => {
    if (a) activeLink = a;
    render();
  };

  links.forEach((a) => {
    const target = targetFor(a);
    a.addEventListener('click', (e) => {
      if (!target) return;
      e.preventDefault();
      setActive(a);
      (target.closest('.section') || target).scrollIntoView({ behavior: 'smooth' });
      window.history.pushState(null, '', `#${target.id}`);
    });
  });

  const sentinel = document.createElement('div');
  const spacer = document.createElement('div');
  spacer.className = 'sticky-nav-spacer';
  block.before(sentinel);
  block.before(spacer);

  const syncState = () => {
    block.classList.toggle('is-fixed', pastStart);
    block.classList.toggle('is-past', pastEnd);
    document.body.classList.toggle('sticky-nav-stuck', pastStart);
    document.body.classList.toggle('sticky-nav-active', pastStart && !pastEnd);
    render();
  };

  render();

  links.forEach((a) => {
    const target = targetFor(a);
    if (target) target.classList.add('sticky-nav-target');
  });

  const sections = links.map(targetFor).filter(Boolean).map((t) => t.closest('.section') || t);
  const lastSection = sections[sections.length - 1];

  let lastNavH = 0;
  const measure = () => {
    pastStart = sentinel.getBoundingClientRect().top < 0;
    pastEnd = !!lastSection && lastSection.getBoundingClientRect().bottom < lastNavH;
    syncState();
  };
  window.addEventListener('scroll', measure, { passive: true });

  let spy = null;
  const buildSpy = (navH) => {
    if (spy) spy.disconnect();
    spy = new IntersectionObserver((entries) => {
      entries.filter((en) => en.isIntersecting).forEach((en) => {
        setActive(links.find((a) => targetFor(a) === en.target));
      });
    }, { rootMargin: `-${navH}px 0px -70% 0px`, threshold: 0 });
    links.map(targetFor).filter(Boolean).forEach((t) => spy.observe(t));
  };

  const syncNavH = () => {
    const navH = block.offsetHeight;
    if (!navH || navH === lastNavH) return;
    lastNavH = navH;
    document.body.style.setProperty('--sticky-nav-h', `${navH}px`);
    buildSpy(navH);
    measure();
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncNavH).observe(block);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(syncNavH));
  }
  syncNavH();
}
