/**
 * disclosure — blue bar with an expandable "Important pricing details" note
 * (index, erp-solutions).
 * Row 1 = summary text. Row 2 = body (a cell of one or more paragraphs).
 * CSS: blocks/disclosure/disclosure.css
 */
let disclosureSeq = 0;

export default function decorate(block) {
  const rows = [...block.children];
  const summaryText = rows[0] ? rows[0].textContent.trim() : 'Important pricing details and product information';
  const bodyCell = rows[1] ? rows[1].firstElementChild : null;

  const details = document.createElement('details');
  details.className = 'disclosure-item';
  const summary = document.createElement('summary');
  summary.innerHTML = `${summaryText} <svg class="disc-caret" aria-hidden="true" width="17" height="8" viewBox="0 0 17 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l7.5 6L16 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const body = document.createElement('div');
  body.className = 'disclosure-body';
  if (bodyCell) body.innerHTML = bodyCell.innerHTML;

  // Expose the expandable note as an ARIA disclosure region tied to its summary,
  // matching production's landmark markup (role=region + aria-labelledby). See #685.
  disclosureSeq += 1;
  const summaryId = `disclosure-summary-${disclosureSeq}`;
  summary.id = summaryId;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', summaryId);

  details.append(summary, body);

  block.replaceChildren(details);
}
