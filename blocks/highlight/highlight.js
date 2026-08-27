/**
 * highlight — colored-background rich-content callout.
 * Content model: single cell of rich content (heading + list/paragraphs).
 * Variant via block class (e.g. `highlight sky`); default light-blue.
 */
import { trackAs } from '../../scripts/tracking.js';

export default function decorate(block) {
  const cell = block.querySelector(':scope > div > div') || block;
  const inner = document.createElement('div');
  inner.className = 'highlight-inner';
  inner.append(...cell.childNodes);
  block.replaceChildren(inner);

  // Click tracking: prod's banner callout. The trail is variant-dependent — the `dark`
  // promo banner (e.g. /events "Register now"/"Schedule a demo") reports `rw_banner`; the
  // default/light callout (e.g. blog "Learn more") reports `product_banner`. Both map to
  // the `product_banner` sheet/opt-in key. (Live/real-render verified 2026-08-26.)
  return trackAs(block.classList.contains('dark') ? 'rw_banner' : 'product_banner', block, { key: 'product_banner' });
}
