function targetFor(a) {
  const id = a.getAttribute('href')?.split('#')[1];
  return id ? document.getElementById(id) : null;
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
    if (target) target.style.scrollMarginTop = `${navH}px`;
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
