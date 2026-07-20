/**
 * faq — accordion of question/answer pairs (index, compare, erp-solutions).
 * Section head (h2) authored as default content.
 * One row per Q/A: cell 1 = question, cell 2 = answer (may contain rich HTML).
 * First item opens by default. Variant .faq.cmp = light band (compare).
 * CSS: blocks/faq/faq.css
 */
export default function decorate(block) {
  const rows = [...block.children];
  const list = document.createElement('div');
  list.className = 'faq-list';

  rows.forEach((row, i) => {
    const cells = [...row.children];
    if (!cells.length) return;
    const details = document.createElement('details');
    details.className = 'faq-item';
    if (i === 0) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = cells[0].textContent.trim();
    const answer = document.createElement('div');
    answer.className = 'faq-answer';
    if (cells[1]) answer.innerHTML = cells[1].innerHTML;
    details.append(summary, answer);
    list.append(details);
  });

  block.replaceChildren(list);
}
