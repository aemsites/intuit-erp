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

  // Quick-answer callouts author the icon as the leading inline child of the
  // first paragraph. Split it into its own column so desktop/mobile layout
  // can use flex instead of float — float only affects lines that overlap
  // its height, so any copy taller than the icon lost its indent past that
  // point once wrapped.
  const first = inner.querySelector(':scope > p:first-child');
  const icon = first && first.querySelector(':scope > .icon[class*="icon-quick-answer"]:first-child');
  if (icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'highlight-icon';
    iconWrap.append(icon);
    const body = document.createElement('div');
    body.className = 'highlight-body';
    body.append(...inner.childNodes);
    inner.append(iconWrap, body);
  }

  // Click tracking: prod's banner callout. The trail is variant-dependent — the `dark`
  // promo banner (e.g. /events "Register now"/"Schedule a demo") reports `rw_banner`; the
  // default/light callout (e.g. blog "Learn more") reports `product_banner`. Both map to
  // the `product_banner` sheet/opt-in key. (Live/real-render verified 2026-08-26.)
  return trackAs(block.classList.contains('dark') ? 'rw_banner' : 'product_banner', block, { key: 'product_banner' });
}
