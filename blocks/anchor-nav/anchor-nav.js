/**
 * anchor-nav — horizontal strip of in-page anchor links with a bottom-border
 * underline indicator that tracks whichever linked section is currently
 * closest to the top of the viewport.
 *
 * Authored structure: one row per link, each row a single standalone link
 * (`<a href="#section-id">Label</a>`).
 *
 * CSS: blocks/anchor-nav/anchor-nav.css
 */
export default function decorate(block) {
  const links = [...block.querySelectorAll('a[href*="#"]')];
  if (!links.length) return;

  const nav = document.createElement('div');
  nav.className = 'anchor-nav-list';

  const targets = [];
  links.forEach((link) => {
    link.classList.add('anchor-nav-link');
    const id = link.getAttribute('href').split('#')[1];
    const target = id ? document.getElementById(id) : null;
    if (target) targets.push({ link, target });
    nav.append(link);
  });

  block.textContent = '';
  block.append(nav);

  if (!targets.length || !('IntersectionObserver' in window)) return;

  const setActive = (link) => {
    links.forEach((l) => l.classList.toggle('is-active', l === link));
  };
  setActive(targets[0].link);

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting);
    if (!visible.length) return;
    const topMost = visible.reduce(
      (a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b),
    );
    const match = targets.find((t) => t.target === topMost.target);
    if (match) setActive(match.link);
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

  targets.forEach(({ target }) => observer.observe(target));
}
