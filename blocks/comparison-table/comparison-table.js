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
 *     mean?" popover button + sibling popover appended to the row `<th>`.
 *   - Legend: a final row whose first cell is exactly "legend" (case-
 *     insensitive) is ALWAYS treated as the legend, never a band (checked
 *     BEFORE band detection — a single-cell "legend" row would otherwise
 *     match the band heuristic below). Legend text comes from the second
 *     cell when present, else from a nested tip/second-paragraph on the
 *     first cell. Renders as `.ct-legend`.
 *   - Mobile: the table scrolls horizontally within `.cmp-table-scroll`
 *     (see CSS), matching the original rather than reflowing into cards.
 *
 * CSS: blocks/comparison-table/comparison-table.css
 */

let tipSeq = 0;
// Tooltip wrappers currently expanded, so a single document-level click
// listener can close any of them when a click lands outside their wrapper.
const openTips = new Set();
let outsideClickBound = false;

function bindOutsideClick() {
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener('click', (e) => {
    [...openTips].forEach((wrapper) => {
      if (!wrapper.contains(e.target)) {
        wrapper.querySelector('.ct-tip-btn').setAttribute('aria-expanded', 'false');
        openTips.delete(wrapper);
      }
    });
  });
}

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
 * Builds a "What does this mean?" tooltip disclosure: a `<span class="ct-tip">`
 * wrapper containing a real `<button class="ct-tip-btn">` and a SIBLING
 * `.ct-tip-popover` holding the given text (the popover is deliberately not a
 * child of the button — a click on the popover's own text must not bubble
 * into the button's click handler and immediately re-close it). Toggled via
 * `aria-expanded` on click (native <button> keyboard activation — Enter/Space
 * — fires the same click handler), closed with Escape, and closed by a click
 * anywhere outside the wrapper.
 * @param {string} text
 * @returns {HTMLSpanElement} the `.ct-tip` wrapper
 */
export function buildTooltip(text) {
  tipSeq += 1;
  const wrapper = document.createElement('span');
  wrapper.className = 'ct-tip';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ct-tip-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'What does this mean?');
  btn.innerHTML = '<span aria-hidden="true">?</span>';

  const popover = document.createElement('span');
  popover.className = 'ct-tip-popover';
  popover.id = `ct-tip-${tipSeq}`;
  popover.textContent = text;
  btn.setAttribute('aria-controls', popover.id);

  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    openTips.delete(wrapper);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // keep the opening click from also hitting the document listener
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    if (expanded) openTips.delete(wrapper); else openTips.add(wrapper);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      close();
      btn.focus();
    }
  });

  wrapper.append(btn, popover);
  bindOutsideClick();
  return wrapper;
}

/**
 * Detects a legend row and returns its legend text, or null if `cells` isn't
 * one. Must run BEFORE band detection (see file header). Once the first cell
 * reads exactly "legend", the row is ALWAYS a legend (never a band), even if
 * no text can be found for it (returns '' rather than null in that case) —
 * legend text is taken from the second cell when present, else from a nested
 * tip/second-paragraph on the first cell.
 * @param {Element[]} cells
 * @returns {string|null}
 */
function getLegendText(cells) {
  if (!cells.length) return null;
  if (cells.length === 1) {
    const clone = cells[0].cloneNode(true);
    const tip = extractTip(clone);
    const label = clone.textContent.trim().toLowerCase();
    return label === 'legend' ? tip : null;
  }
  const label = cells[0].textContent.trim().toLowerCase();
  if (label !== 'legend') return null;
  const second = cells[1].textContent.trim();
  if (second) return second;
  const clone = cells[0].cloneNode(true);
  const tip = extractTip(clone);
  if (tip) return tip;
  return cells.slice(2).map((c) => c.textContent.trim()).filter(Boolean).join(' ');
}

function valueCell(cell) {
  const td = document.createElement('td');
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
      // label wrapped in a span so it can be pinned (sticky) to the left on
      // mobile while the value columns scroll — a <td> can't stick when the
      // scroll container is the ancestor .cmp-table-scroll div.
      bandTr.innerHTML = `<td colspan="${ncol}"><span>${cells[0].textContent.trim()}</span></td>`;
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
      const tipWrapper = buildTooltip(tipText);
      th.append(tipWrapper);
      const popover = tipWrapper.querySelector('.ct-tip-popover');
      th.setAttribute('aria-describedby', popover.id);
    }
    tr.append(th);
    cells.slice(1).forEach((c) => tr.append(valueCell(c)));
    tbody.append(tr);
  });

  // Relocate authored footnotes (default content that starts with a digit,
  // e.g. "1 Based on…") to sit directly beneath the group that references them
  // via <sup> markers — matching the prototype, where the disclaimer follows
  // the Implementation group rather than trailing the whole table.
  const section = block.closest('.section');
  const footPs = section
    ? [...section.querySelectorAll('.default-content-wrapper p')].filter((p) => /^\s*\d/.test(p.textContent))
    : [];
  if (footPs.length) {
    const supEl = table.querySelector('sup');
    const targetTbody = (supEl && supEl.closest('tbody')) || table.querySelector('tbody');
    if (targetTbody) {
      const tr = document.createElement('tr');
      tr.className = 'cmp-footnote';
      const td = document.createElement('td');
      td.colSpan = ncol;
      footPs.forEach((p) => td.append(p)); // append moves the node out of its wrapper
      tr.append(td);
      targetTbody.append(tr);
      // remove default-content wrappers left empty after moving the footnotes
      section.querySelectorAll('.default-content-wrapper').forEach((w) => {
        if (!w.textContent.trim() && !w.querySelector('img, picture, svg')) w.remove();
      });
    }
  }

  const scroll = document.createElement('div');
  scroll.className = 'cmp-table-scroll';
  scroll.append(table);
  block.replaceChildren(scroll);
  if (legendEl) block.append(legendEl);
}
