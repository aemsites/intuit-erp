const TARGET_MARKER = /#target=(_blank|_self)$/;

/**
 * Applies a terminal authored target marker and restores any destination fragment before it.
 * @param {Element} root The container element
 */
export function decorateLinkTargets(root) {
  root.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    const marker = href.match(TARGET_MARKER);
    if (!marker) return;

    const [, target] = marker;
    link.setAttribute('href', href.slice(0, marker.index));
    link.target = target;
    if (target === '_blank') link.relList.add('noopener');
  });
}

/**
 * Applies authored targets, then opens unmarked off-site HTTP(S) links in a new tab.
 * @param {Element} main The fully decorated page content
 */
export function decorateExternalLinks(main) {
  decorateLinkTargets(main);
  main.querySelectorAll('a[href^="http"]').forEach((link) => {
    if (link.target) return;
    let url;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (url.host === window.location.host) return;
    link.target = '_blank';
    link.relList.add('noopener');
  });
}
