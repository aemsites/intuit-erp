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
 *
 * Also registers a FAQPage JSON-LD node for its Q&A pairs (see scripts/structured-data.js) —
 * this block owns the .faq-item/.faq-question/.faq-answer shape, so it builds that node itself
 * rather than leaving another module to guess at the shape from the outside.
 */
import { registerJsonLd, buildFaqEntity } from '../../scripts/structured-data.js';

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
  const faqEntities = [];

  rows.forEach((row, i) => {
    const cells = [...row.children];
    if (!cells.length) return;

    const item = document.createElement('div');
    item.className = 'faq-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'faq-toggle';
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

    const answer = document.createElement('div');
    answer.className = 'faq-answer';
    if (cells[1]) answer.innerHTML = cells[1].innerHTML;
    panel.append(answer);

    const entity = buildFaqEntity(label, answer);
    if (entity) faqEntities.push(entity);

    button.addEventListener('click', () => {
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    item.append(button, panel);
    list.append(item);
  });

  block.replaceChildren(list);

  if (faqEntities.length) {
    registerJsonLd({ '@type': 'FAQPage', mainEntity: faqEntities });
  }
}
