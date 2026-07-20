/**
 * disclosure — blue bar with an expandable "Important pricing details" note
 * (index, erp-solutions).
 * Row 1 = summary text. Row 2 = body (a cell of one or more paragraphs).
 * CSS: blocks/disclosure/disclosure.css
 */
export default function decorate(block) {
  const rows = [...block.children];
  const summaryText = rows[0] ? rows[0].textContent.trim() : 'Important pricing details and product information';
  const bodyCell = rows[1] ? rows[1].firstElementChild : null;

  const details = document.createElement('details');
  details.className = 'disclosure-item';
  const summary = document.createElement('summary');
  summary.innerHTML = `${summaryText} <span class="disc-caret">▾</span>`;
  const body = document.createElement('div');
  body.className = 'disclosure-body';
  if (bodyCell) body.innerHTML = bodyCell.innerHTML;
  details.append(summary, body);

  block.replaceChildren(details);
}
