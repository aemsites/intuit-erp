/**
 * comparison-table — grouped product comparison (compare).
 * Section head (h2) + footnotes authored as default content.
 *
 * Row 1 = column headers: ["", col1, col2, col3, col4] (5 cells).
 * Then, per group:
 *   - a band row: a SINGLE cell holding the group label (e.g. "Implementation")
 *   - data rows: [rowLabel, v1, v2, v3, v4] where a value is "✓"/"yes" (check),
 *     "–"/"-" (dash), or free text ("add-on", "6 months", …).
 * The column-header row is repeated inside every group, matching the prototype.
 *
 * Content model additions:
 *   - Tooltip: a row-header cell may carry a nested `<span class="tip">…</span>`
 *     or a second `<p>` holding help text. It renders as a "What does this
 *     mean?" popover button appended to the row `<th>`.
 *   - Legend: a final single-cell row whose label — after stripping any nested
 *     tip/second-paragraph — is exactly "legend" (case-insensitive) supplies
 *     legend text via that same nested tip/second-paragraph. It renders as
 *     `.ct-legend`, detected BEFORE band detection (a single-cell "legend" row
 *     would otherwise match the band heuristic below and render as a band).
 *   - Mobile-adaptive: the block carries a `data-adaptive` attribute and each
 *     value `<td>` a `data-label` (its column header), consumed by CSS for a
 *     card view under 600px.
 *
 * CSS: blocks/comparison-table/comparison-table.css
 */

let tipSeq = 0;

/**
 * Extracts a nested tooltip/legend text from a cell: either a `span.tip` or a
 * second `<p>`. Removes the matched node from `cell` (mutates it) and returns
 * its trimmed text, or '' if neither is present.
 * @param {Element} cell
 * @returns {string}
 */
function extractTip(cell) {
  const tipSpan = cell.querySelector('span.tip');
  if (tipSpan) {
    const text = tipSpan.textContent.trim();
    tipSpan.remove();
    return text;
  }
  const paras = cell.querySelectorAll('p');
  if (paras.length > 1) {
    const tipP = paras[paras.length - 1];
    const text = tipP.textContent.trim();
    tipP.remove();
    return text;
  }
  return '';
}

/**
 * Builds a "What does this mean?" tooltip trigger: a real <button> containing
 * a `.ct-tip-popover` with the given text. Toggled via `aria-expanded` on
 * click (native <button> keyboard activation — Enter/Space — fires the same
 * click handler) and closed with Escape.
 * @param {string} text
 * @returns {HTMLButtonElement}
 */
export function buildTooltip(text) {
  tipSeq += 1;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ct-tip-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'What does this mean?');
  btn.innerHTML = '<span aria-hidden="true">?</span>';

  const popover = document.createElement('span');
  popover.className = 'ct-tip-popover';
  popover.id = `ct-tip-${tipSeq}`;
  popover.setAttribute('role', 'tooltip');
  popover.textContent = text;
  btn.append(popover);
  btn.setAttribute('aria-controls', popover.id);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });
  return btn;
}

/**
 * Detects a legend row and returns its legend text, or null if `cells` isn't
 * one. Must run BEFORE band detection (see file header).
 * @param {Element[]} cells
 * @returns {string|null}
 */
function getLegendText(cells) {
  if (!cells.length) return null;
  if (cells.length === 1) {
    const clone = cells[0].cloneNode(true);
    const tip = extractTip(clone);
    const label = clone.textContent.trim().toLowerCase();
    return (label === 'legend' && tip) ? tip : null;
  }
  const label = cells[0].textContent.trim().toLowerCase();
  if (label !== 'legend') return null;
  return cells.slice(1).map((c) => c.textContent.trim()).filter(Boolean).join(' ');
}

function valueCell(cell, label) {
  const td = document.createElement('td');
  if (label) td.dataset.label = label;
  const t = cell.textContent.trim();
  const low = t.toLowerCase();
  if (t === '✓' || low === 'yes' || low === 'check') {
    td.className = 'yes';
    td.innerHTML = '<span class="ck"></span>';
  } else if (t === '–' || t === '-' || t === '—' || t === '') {
    td.className = 'dash';
    td.innerHTML = '&ndash;';
  } else {
    td.className = 'txt';
    td.innerHTML = cell.innerHTML;
  }
  return td;
}

export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  block.setAttribute('data-adaptive', '');

  const cols = [...rows[0].children].map((c) => c.textContent.trim());
  const ncol = cols.length; // includes the empty label column

  const table = document.createElement('table');
  table.className = 'cmp-table';
  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML = `<col class="col-label">${'<col>'.repeat(Math.max(0, ncol - 1))}`;
  table.append(colgroup);

  function headRow() {
    const tr = document.createElement('tr');
    tr.className = 'cmp-head';
    cols.forEach((c, i) => {
      if (i === 0) { tr.innerHTML += '<td></td>'; return; }
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      tr.append(th);
    });
    return tr;
  }

  let tbody = null;
  let legendEl = null;
  rows.slice(1).forEach((row) => {
    const cells = [...row.children];

    const legendText = getLegendText(cells);
    if (legendText !== null) {
      legendEl = document.createElement('p');
      legendEl.className = 'ct-legend';
      legendEl.textContent = legendText;
      return;
    }

    const nonEmpty = cells.filter((c) => c.textContent.trim());
    const isBand = cells.length === 1 || (nonEmpty.length === 1 && cells[0].textContent.trim());
    if (isBand) {
      tbody = document.createElement('tbody');
      table.append(tbody);
      const bandTr = document.createElement('tr');
      bandTr.className = 'cmp-band';
      bandTr.innerHTML = `<td colspan="${ncol}">${cells[0].textContent.trim()}</td>`;
      tbody.append(bandTr);
      tbody.append(headRow());
      return;
    }
    if (!tbody) { tbody = document.createElement('tbody'); table.append(tbody); }
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    const tipText = extractTip(cells[0]);
    th.textContent = cells[0].textContent.trim();
    if (tipText) {
      const tipBtn = buildTooltip(tipText);
      th.append(tipBtn);
      const popover = tipBtn.querySelector('.ct-tip-popover');
      th.setAttribute('aria-describedby', popover.id);
    }
    tr.append(th);
    cells.slice(1).forEach((c, i) => tr.append(valueCell(c, cols[i + 1])));
    tbody.append(tr);
  });

  const scroll = document.createElement('div');
  scroll.className = 'cmp-table-scroll';
  scroll.append(table);
  block.replaceChildren(scroll);
  if (legendEl) block.append(legendEl);
}
