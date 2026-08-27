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

  // Per-item JIT payload deriver: prod records each toggle as the structured accordion
  // interaction (ui_object=accordion_item_N by DOM order, ui_action=displayed on expand /
  // dismissed on collapse, link_name=accordion_item_N-<question>). object_detail=faq|
  // question_N is authored + scrambled upstream (question numbers repeat / don't track
  // DOM order), so we emit the DOM-order form and the oracle compares it index-tolerant.
  // data-wa-link / icom_user_action stay authored residue (word-ordinal, not derivable).
  // Answer-body links (not .faq-toggle) return null -> normal derive, left untouched.
  const payload = (el) => {
    if (!el.matches || !el.matches('.faq-toggle')) return null;
    const item = el.closest('.faq-item');
    const n = item ? [...block.querySelectorAll('.faq-item')].indexOf(item) + 1 : 0;
    if (n < 1) return null;
    const q = (el.querySelector('.faq-question')?.textContent || '').trim();
    // pointerdown fires before the toggle flips aria-expanded, so the current value is
    // the pre-click state: an expanded item is about to collapse, and vice-versa.
    const willOpen = el.getAttribute('aria-expanded') !== 'true';
    return {
      'ui-object': `accordion_item_${n}`,
      'object-detail': `faq|question_${n}`,
      'ui-action': willOpen ? 'displayed' : 'dismissed',
      'custom-properties': { link_name: `accordion_item_${n}-${slug(q)}` },
    };
  };
  // Accordion -> "accordion" trail; sheet/opt-in key "faq". linkName:false suppresses the
  // generic derived button link_name; the deriver supplies the structured one per toggle.
  return trackAs('accordion', block, { key: 'faq', linkName: false, payload });
}
