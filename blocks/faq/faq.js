/**
 * faq — accordion of question/answer pairs (index, compare, erp-solutions).
 * Section head (h2) authored as default content.
 * One row per Q/A: cell 1 = question, cell 2 = answer (may contain rich HTML).
 * All items open by default — except inside a blog article or the .cmp
 * variant, where all items start collapsed (matching the source). Multiple
 * items may be open at once, and re-clicking an open item collapses it.
 * Variant .faq.cmp = light band.
 * Open/close is animated in CSS (height via grid-template-rows + opacity fade,
 * matching the source's ~0.24s height / opacity transition), driven by the
 * button's [aria-expanded] state rather than native <details>.
 * CSS: blocks/faq/faq.css
 */
import { trackAs, slug } from '../../scripts/tracking.js';

const CHEVRON = '<path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" '
  + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * JIT payload deriver for a faq toggle: prod's structured accordion beacon —
 * `accordion_item_N` / `faq|question_N` by DOM order, `displayed` on expand / `dismissed` on
 * collapse (from the pre-click aria-expanded), and `link_name`. object_detail is scored
 * index-tolerant (prod's N is authored + scrambled). Non-toggles return null → normal derive.
 * Exported so the offline parity harness (parity-gate `oursPayload`) derives it identically.
 * @param {Element} el clicked element
 * @param {Element} block the faq block (for DOM-order index)
 * @returns {Record<string, unknown>|null}
 */
export function faqTogglePayload(el, block) {
  if (!el.matches || !el.matches('.faq-toggle')) return null;
  const item = el.closest('.faq-item');
  const n = item ? [...block.querySelectorAll('.faq-item')].indexOf(item) + 1 : 0;
  if (n < 1) return null;
  const q = (el.querySelector('.faq-question')?.textContent || '').trim();
  const willOpen = el.getAttribute('aria-expanded') !== 'true'; // pointerdown precedes the toggle
  return {
    'ui-object': `accordion_item_${n}`,
    'object-detail': `faq|question_${n}`,
    'ui-action': willOpen ? 'displayed' : 'dismissed',
    'custom-properties': { link_name: `accordion_item_${n}-${slug(q)}` },
  };
}

export default function decorate(block) {
  const rows = [...block.children];
  const list = document.createElement('div');
  list.className = 'faq-list';
  // In-article FAQs and the .cmp (compare page) variant start fully collapsed
  // upstream; on other marketing pages every item is expanded on load,
  // matching the original site.
  const inArticle = !!block.closest('main.blog-article');
  const open = !inArticle && !block.classList.contains('cmp');

  rows.forEach((row, i) => {
    const cells = [...row.children];
    if (!cells.length) return;

    const item = document.createElement('div');
    item.className = 'faq-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'faq-toggle';
    button.id = `faq-toggle-${i}`;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');

    const label = document.createElement('span');
    label.className = 'faq-question';
    label.textContent = cells[0].textContent.trim();

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'faq-chevron');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.innerHTML = CHEVRON;
    button.append(label, icon);

    const panel = document.createElement('div');
    panel.className = 'faq-panel';
    const id = `faq-panel-${i}`;
    panel.id = id;
    button.setAttribute('aria-controls', id);

    // Expose each answer as an ARIA disclosure region tied to its toggle,
    // matching production's accordion (role=region + aria-labelledby). See #660.
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', button.id);

    const answer = document.createElement('div');
    answer.className = 'faq-answer';
    if (cells[1]) answer.innerHTML = cells[1].innerHTML;
    panel.append(answer);

    button.addEventListener('click', () => {
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    item.append(button, panel);
    list.append(item);
  });

  block.replaceChildren(list);

  // Per-toggle structured payload prod records — derived by faqTogglePayload (exported so the
  // offline parity harness derives it identically). Non-toggles fall through to the normal derive.
  return trackAs('accordion', block, { key: 'faq', linkName: false, payload: (el) => faqTogglePayload(el, block) });
}
