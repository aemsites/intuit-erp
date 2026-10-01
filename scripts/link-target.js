const TARGET_MARKER = /#target=(_blank|_self)$/;

export function hasAuthoredTargetMarker(href) {
  return TARGET_MARKER.test(href);
}

/**
 * Applies a terminal authored target marker and restores any destination fragment before it.
 * @param {Element} root The container element
 */
export default function decorateLinkTargets(root) {
  root.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    const marker = href.match(TARGET_MARKER);
    if (!marker) return;

    const [, target] = marker;
    link.setAttribute('href', href.slice(0, marker.index));
    if (!link.hasAttribute('target')) link.target = target;
    if (link.target === '_blank') link.relList.add('noopener');
  });
}
