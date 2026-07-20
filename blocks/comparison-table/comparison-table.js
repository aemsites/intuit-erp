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
 * CSS: blocks/comparison-table/comparison-table.css
 */
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
  rows.slice(1).forEach((row) => {
    const cells = [...row.children];
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
    th.textContent = cells[0].textContent.trim();
    tr.append(th);
    cells.slice(1).forEach((c) => tr.append(valueCell(c)));
    tbody.append(tr);
  });

  const scroll = document.createElement('div');
  scroll.className = 'cmp-table-scroll';
  scroll.append(table);
  block.replaceChildren(scroll);
}
