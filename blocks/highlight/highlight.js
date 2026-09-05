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

  // Quick-answer callouts author a leading lightbulb icon inline in a paragraph.
  // Both layouts place that icon beside the copy — the base block floats it, and
  // blog-template lays the paragraph out as an icon|body flex row (matching prod's
  // TipBox). In a flex row every inline run (text, links, bold) would become its
  // own flex item and stack into columns, so wrap all content after the icon in a
  // single span, keeping the copy as one flowing item with its inline markup intact.
  inner.querySelectorAll(':scope > p').forEach((p) => {
    const icon = p.querySelector(':scope > span.icon[class*="icon-quick-answer"]');
    if (!icon) return;
    const answer = document.createElement('span');
    answer.className = 'highlight-answer';
    for (let node = icon.nextSibling; node;) {
      const next = node.nextSibling;
      answer.append(node);
      node = next;
    }
    p.append(answer);
  });

  // Click tracking: prod's banner callout. The trail is variant-dependent — the `dark`
  // promo banner (e.g. /events "Register now"/"Schedule a demo") reports `rw_banner`; the
  // default/light callout (e.g. blog "Learn more") reports `product_banner`. Both map to
  // the `product_banner` sheet/opt-in key. (Live/real-render verified 2026-08-26.)
  return trackAs(block.classList.contains('dark') ? 'rw_banner' : 'product_banner', block, { key: 'product_banner' });
}
