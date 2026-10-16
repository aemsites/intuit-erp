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
  // active tab = the last section whose top has reached its scroll landing
  // position (scroll-margin-top, which already clears the bar)
  const pairs = links.map((a) => ({ a, section: targetFor(a)?.closest('.section') })).filter((p) => p.section);
  const pickActive = () => {
    let current = null;
    pairs.forEach(({ a, section }) => {
      const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || lastNavH;
      if (section.getBoundingClientRect().top <= margin + 1) current = a;
    });
    if (current) setActive(current);
  };

  const measure = () => {
    pastStart = sentinel.getBoundingClientRect().top < 0;
    pastEnd = !!lastSection && lastSection.getBoundingClientRect().bottom < lastNavH;
    pickActive();
    syncState();
  };
  window.addEventListener('scroll', measure, { passive: true });

  const syncNavH = () => {
    const navH = block.offsetHeight;
    if (!navH || navH === lastNavH) return;
    lastNavH = navH;
    document.body.style.setProperty('--sticky-nav-h', `${navH}px`);
    measure();
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncNavH).observe(block);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(syncNavH));
  }
  syncNavH();
}
