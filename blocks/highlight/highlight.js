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

  // Quick-answer callouts author the lightbulb icon inline at the start of a
  // paragraph. Lift it out so it sits beside the copy as icon | body, and keep
  // every paragraph in normal flow inside the body — inline links and bold stay
  // inline instead of each run becoming its own flex column.
  const iconPara = [...inner.children].find((el) => el.matches('p')
    && el.firstElementChild?.matches('.icon[class*="icon-quick-answer"]'));
  if (iconPara) {
    const icon = iconPara.firstElementChild;
    const body = document.createElement('div');
    body.className = 'highlight-body';
    body.append(...inner.childNodes);
    icon.remove();
    inner.replaceChildren(icon, body);
  }

  // Click tracking: prod's banner callout. The trail is variant-dependent — the `dark`
  // promo banner (e.g. /events "Register now"/"Schedule a demo") reports `rw_banner`; the
  // default/light callout (e.g. blog "Learn more") reports `product_banner`. Both map to
  // the `product_banner` sheet/opt-in key. (Live/real-render verified 2026-08-26.)
  return trackAs(block.classList.contains('dark') ? 'rw_banner' : 'product_banner', block, { key: 'product_banner' });
}
