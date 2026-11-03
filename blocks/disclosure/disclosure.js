import { trackAs } from '../../scripts/tracking.js';

/**
 * disclosure — blue bar with an expandable "Important pricing details" note
 * (index, erp-solutions).
 * Row 1 = summary text. Row 2 = body (a cell of one or more paragraphs).
 * Variation `expanded` (e.g. `Disclosure (expanded)`, `Disclosure (white, expanded)`):
 * renders the note as static content — title + always-visible body, no
 * <details>/<summary>, no caret, no expand/collapse tracking. Combines with `light` / `white`.
 * CSS: blocks/disclosure/disclosure.css
 */
let disclosureSeq = 0;

export default function decorate(block) {
  const rows = [...block.children];
  const summaryText = rows[0] ? rows[0].textContent.trim() : 'Important pricing details and product information';
  const bodyCell = rows[1] ? rows[1].firstElementChild : null;
  const expanded = block.classList.contains('expanded');

  const body = document.createElement('div');
  body.className = 'disclosure-body';
  if (bodyCell) body.innerHTML = bodyCell.innerHTML;
  disclosureSeq += 1;

  if (expanded) {
    const item = document.createElement('div');
    item.className = 'disclosure-item';
    const title = document.createElement('p');
    title.className = 'disclosure-title';
    title.id = `disclosure-title-${disclosureSeq}`;
    title.textContent = summaryText;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', title.id);
    item.append(title, body);

    // always visible, so native anchor scrolling is enough for #disclaimer
    if (!document.getElementById('disclaimer')) item.id = 'disclaimer';

    block.replaceChildren(item);
    return trackAs(null, block, { key: 'disclaimer', uiObject: 'link' });
  }

  const details = document.createElement('details');
  details.className = 'disclosure-item';
  const summary = document.createElement('summary');
  summary.innerHTML = `${summaryText} <svg class="disc-caret" aria-hidden="true" width="17" height="8" viewBox="0 0 17 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l7.5 6L16 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Expose the expandable note as an ARIA disclosure region tied to its summary,
  // matching production's landmark markup (role=region + aria-labelledby). See #685.
  const summaryId = `disclosure-summary-${disclosureSeq}`;
  summary.id = summaryId;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', summaryId);

  details.append(summary, body);

  // first disclosure on the page is the #disclaimer jump target; open it when targeted
  if (!document.getElementById('disclaimer')) {
    details.id = 'disclaimer';
    const openIfTargeted = () => {
      if (window.location.hash === '#disclaimer') details.open = true;
    };
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
  }

  block.replaceChildren(details);
  return trackAs(null, block, {
    key: 'disclaimer',
    uiObject: 'link',
    payload: () => ({ 'object-detail': `disclaimer|${details.open ? 'close' : 'open'}` }),
  });
}
