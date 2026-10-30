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
 *     first cell. Each paragraph in the second cell renders as its own line,
 *     and a leading check/dash glyph becomes the same marker the table body
 *     uses. An optional THIRD cell supplies the disclosure toggle's label; when
 *     authored the key is collapsed behind a `<details>` like the original,
 *     and when omitted it renders expanded. Renders as `.ct-legend`.
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

/**
 * Returns the legend's authored source cell — the one whose child markup should
 * be preserved (paragraphs, `<strong>` labels, check/dash glyphs) — or null when
 * the legend has no such cell. Mirrors getLegendText's precedence.
 * @param {Element[]} cells
 * @returns {Element|null}
 */
function legendSourceCell(cells) {
  if (cells.length > 1 && cells[1].textContent.trim()) return cells[1];
  return null;
}

/**
 * Renders legend content into `container`, preserving authored line structure.
 * Each authored paragraph becomes its own line. A leading check glyph is swapped
 * for the same CSS `.ck` checkmark the table body uses, so the key matches the
 * symbols it explains; a leading ✗ becomes `.ct-x` and a leading en/em dash
 * becomes `.ct-dash`. Falls back to flat text when the cell has no paragraph
 * children.
 * @param {Element} container `.ct-legend` element to fill
 * @param {Element|null} cell authored legend cell
 * @param {string} fallbackText plain-text legend used when `cell` is absent
 * @param {string} summaryText authored toggle label; when empty the key renders
 *   expanded instead of collapsed
 */
/**
 * Returns the authored label for the legend's disclosure toggle — the third cell
 * of the legend row — or '' when none is authored, in which case the legend
 * renders expanded rather than behind an unlabelled toggle.
 * @param {Element[]} cells
 * @returns {string}
 */
function legendSummaryText(cells) {
  return cells.length > 2 ? cells[2].textContent.trim() : '';
}

function legendLine(sourceP) {
  const line = document.createElement('span');
  line.className = 'ct-legend-item';
  [...sourceP.childNodes].forEach((n) => line.append(n.cloneNode(true)));
  // Swap a leading marker glyph for the styled equivalent used in the table body.
  const first = line.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE) {
    const m = first.textContent.match(/^\s*(\u2713|\u2714|\u2717|\u2718|\u00d7|\u2013|\u2014|-)\s*/);
    if (m) {
      first.textContent = first.textContent.slice(m[0].length);
      const [, mark] = m;
      const glyph = document.createElement('span');
      if (mark === '\u2713' || mark === '\u2714') {
        glyph.className = 'ck';
      } else if (['\u2717', '\u2718', '\u00d7'].includes(mark)) {
        glyph.className = 'ct-x';
        glyph.textContent = mark;
      } else {
        glyph.className = 'ct-dash';
        glyph.innerHTML = '&ndash;';
      }
      line.prepend(glyph);
    }
  }
  return line;
}

function renderLegend(container, cell, fallbackText, summaryText) {
  const paras = cell ? [...cell.querySelectorAll(':scope > p')] : [];
  if (!paras.length) {
    container.textContent = fallbackText;
    return;
  }
  const body = document.createElement('div');
  body.className = 'ct-legend-body';
  paras.forEach((sourceP) => body.append(legendLine(sourceP)));
  if (!summaryText) {
    // No toggle label authored — show the key rather than hide it behind a
    // blank control.
    container.append(body);
    return;
  }
  // The original collapses the key behind a labelled toggle; mirror that with a
  // native <details> so it works without JS and stays accessible.
  const details = document.createElement('details');
  details.className = 'ct-legend-item-wrap';
  const summary = document.createElement('summary');
  summary.textContent = summaryText;
  details.append(summary, body);
  container.append(details);
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
  } else if (low === 'add-on') {
    td.className = 'addon';
    td.innerHTML = `<span class="ck"></span><span class="addon-label">${t}</span>`;
  } else {
    td.className = 'txt';
    td.innerHTML = cell.innerHTML;
  }
  return td;
}

/**
 * Reads a leading status marker off a simple-variant cell and returns the icon
 * type plus the remaining copy. Markers are a glyph (✓ ✔ / ● • · ○ / ✗ ✘ ×) or a
 * keyword (yes|check|included / partial|limited / no|x); anything else is plain
 * text with no icon.
 * @param {string} raw
 * @returns {{icon: ('check'|'dot'|'x'|null), text: string}}
 */
function markerOf(raw) {
  const t = (raw || '').trim();
  if (!t) return { icon: null, text: '' };
  const g = t[0];
  if (g === '✓' || g === '✔') return { icon: 'check', text: t.slice(1).trim() };
  if ('✗✘×'.includes(g)) return { icon: 'x', text: t.slice(1).trim() };
  if ('●•·○'.includes(g)) return { icon: 'dot', text: t.slice(1).trim() };
  const word = t.split(/\s+/)[0].toLowerCase();
  const sp = t.indexOf(' ');
  const rest = sp === -1 ? '' : t.slice(sp + 1).trim();
  if (['yes', 'check', 'included'].includes(word)) return { icon: 'check', text: rest };
  if (['no', 'x'].includes(word)) return { icon: 'x', text: rest };
  if (['partial', 'limited'].includes(word)) return { icon: 'dot', text: rest };
  return { icon: null, text: t };
}

/**
 * `.simple` variant — logo column headers above a rounded card, one blue band
 * header, then rows of centred icon-over-text cells (no row-label column).
 * Row 1 = column headers (logos/images or text); a single-cell row is a band
 * header; every other row is N value cells parsed by {@link markerOf}.
 * @param {Element} block
 */
function decorateSimple(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  const headCells = [...rows[0].children];
  const ncol = headCells.length;
  block.style.setProperty('--cs-cols', ncol);

  const head = document.createElement('div');
  head.className = 'cs-head';
  headCells.forEach((cell) => {
    const logo = document.createElement('div');
    logo.className = 'cs-logo';
    // header cell without an image = text column title
    if (!cell.querySelector('picture, img')) {
      logo.classList.add('cs-text');
      const p = document.createElement('p');
      p.textContent = cell.textContent.trim();
      logo.append(p);
    } else {
      logo.append(...cell.childNodes);
    }
    head.append(logo);
  });

  const card = document.createElement('div');
  card.className = 'cs-card';

  rows.slice(1).forEach((row) => {
    const cells = [...row.children];
    const nonEmpty = cells.filter((c) => c.textContent.trim());
    if (cells.length === 1 || nonEmpty.length === 1) {
      const band = document.createElement('div');
      band.className = 'cs-band';
      band.textContent = (nonEmpty[0] || cells[0]).textContent.trim();
      card.append(band);
      return;
    }
    const tr = document.createElement('div');
    tr.className = 'cs-row';
    cells.forEach((cell) => {
      const { icon, text } = markerOf(cell.textContent);
      const cellEl = document.createElement('div');
      cellEl.className = 'cs-cell';
      if (icon) {
        const ic = document.createElement('span');
        ic.className = `cs-ic cs-${icon}`;
        cellEl.append(ic);
      }
      const p = document.createElement('p');
      p.textContent = text;
      cellEl.append(p);
      tr.append(cellEl);
    });
    card.append(tr);
  });

  const wrap = document.createElement('div');
  wrap.className = 'cmp-simple';
  wrap.append(head, card);
  block.replaceChildren(wrap);
}

/**
 * `.features` variant — logos above a white card; rows are
 * [label (+ description after a <br> or in a 2nd <p>), value, value…].
 * Row 1 = column headers (a leading empty label cell is optional); a header
 * cell may hold a 2nd image, used instead of the 1st below 768px; a
 * single-cell row starts a new card with that text as its heading.
 * Values: check/yes → check, dash/no/empty → dash, partial → dot, else text.
 * @param {Element} block
 */
function decorateFeatures(block) {
  const rows = [...block.children];
  if (!rows.length) return;
  const ncol = Math.max(...rows.map((r) => r.children.length));
  const nval = Math.max(1, ncol - 1);
  block.style.setProperty('--cf-cols', nval);

  const head = document.createElement('div');
  head.className = 'cf-head';
  const spacer = document.createElement('div');
  spacer.className = 'cf-head-label';
  head.append(spacer);
  const headCells = [...rows[0].children];
  headCells.slice(Math.max(0, headCells.length - nval)).forEach((cell) => {
    const col = document.createElement('div');
    col.className = 'cf-col-title';
    col.append(...cell.childNodes);
    // optional 2nd image = mobile variant
    const pics = [...col.querySelectorAll('picture')];
    if (pics.length > 1) {
      pics[0].classList.add('cf-pic-desktop');
      pics[1].classList.add('cf-pic-mobile');
      pics.slice(2).forEach((p) => p.remove());
    }
    head.append(col);
  });

  const wrap = document.createElement('div');
  wrap.className = 'cmp-features';
  wrap.append(head);

  let card = null;
  const newCard = () => {
    card = document.createElement('div');
    card.className = 'cf-card';
    wrap.append(card);
  };

  rows.slice(1).forEach((row) => {
    const cells = [...row.children];
    if (cells.length === 1) {
      const group = document.createElement('p');
      group.className = 'cf-group';
      group.textContent = cells[0].textContent.trim();
      wrap.append(group);
      newCard();
      return;
    }
    if (!card) newCard();

    const [labelCell, ...valueCells] = cells;
    const tr = document.createElement('div');
    tr.className = 'cf-row';

    const title = document.createElement('div');
    title.className = 'cf-title';
    const paras = [...labelCell.querySelectorAll('p')];
    const html = paras.length ? paras.map((p) => p.innerHTML).join('<br>') : labelCell.innerHTML;
    const [labelHtml, ...rest] = html.split(/<br\s*\/?>/i);
    const label = document.createElement('p');
    label.className = 'cf-label';
    label.innerHTML = labelHtml.trim();
    title.append(label);
    const descHtml = rest.join('<br>').trim();
    if (descHtml) {
      const desc = document.createElement('p');
      desc.className = 'cf-desc';
      desc.innerHTML = descHtml;
      title.append(desc);
    }
    tr.append(title);

    for (let i = 0; i < nval; i += 1) {
      const cell = valueCells[i];
      const { icon, text } = markerOf(cell ? cell.textContent : '');
      const entry = document.createElement('div');
      entry.className = 'cf-entry';
      const isDash = !text && icon !== 'check' && icon !== 'dot';
      if (icon === 'check' && !text) {
        entry.innerHTML = '<span class="cf-check" role="img" aria-label="Included"></span>';
      } else if (icon === 'x' || isDash || ['–', '-', '—'].includes(text)) {
        entry.innerHTML = '<span class="cf-dash" role="img" aria-label="Not included"></span>';
      } else {
        if (icon) {
          const ic = document.createElement('span');
          ic.className = `cf-ic cf-${icon}`;
          entry.append(ic);
        }
        const p = document.createElement('p');
        p.textContent = text;
        entry.append(p);
      }
      tr.append(entry);
    }
    card.append(tr);
  });

  block.replaceChildren(wrap);
}

/**
 * Value cell for the `.ies` variant: ✓ check, ✗ cross (text after either sits
 * beneath), "add-on" check + label, empty/dash/●•○ dot, else plain text.
 * @param {Element} cell
 * @returns {HTMLTableCellElement}
 */
function iesCell(cell) {
  const td = document.createElement('td');
  const raw = cell.textContent.trim();
  const g = raw[0];

  let icon = null;
  let text = '';
  if (g === '✓' || g === '✔') {
    icon = 'check';
    text = raw.slice(1).trim();
  } else if (raw.toLowerCase() === 'add-on') {
    icon = 'check';
    text = raw;
  } else if (['', '–', '-', '—'].includes(raw)) {
    icon = 'dot';
  } else if ('✗✘×'.includes(g)) {
    icon = 'x';
    text = raw.slice(1).trim();
  } else if ('●•·○'.includes(g)) {
    icon = 'dot';
    text = raw.slice(1).trim();
  }

  if (!icon) {
    td.innerHTML = cell.innerHTML;
    return td;
  }
  const ic = document.createElement('span');
  ic.className = `ci-ic ci-${icon}`;
  ic.setAttribute('role', 'img');
  ic.setAttribute('aria-label', icon === 'check' ? 'Included' : 'Not included');
  td.append(ic);
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    td.append(p);
  }
  return td;
}

/**
 * Footnote paragraph with only its leading number superscripted, whether the
 * author wrapped the whole line, just the number, or nothing.
 * @param {Element} p
 */
function superscriptNote(p) {
  p.querySelectorAll('sup').forEach((s) => s.replaceWith(...s.childNodes));
  p.normalize();
  const { firstChild: first } = p;
  const m = first?.nodeType === Node.TEXT_NODE && first.textContent.match(/^\s*(\d+)\s*/);
  if (!m) return;
  const [match, num] = m;
  first.textContent = first.textContent.slice(match.length);
  const sup = document.createElement('sup');
  sup.textContent = num;
  p.prepend(sup, ' ');
}

/**
 * `.ies` variant — one card per group, authored like the default variant;
 * below 768px the card bodies scroll sideways together.
 * @param {Element} block
 */
function decorateIes(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  const cols = [...rows[0].children].map((c) => c.textContent.trim());
  const cards = [];
  let tbody = null;
  let legendEl = null;

  const newCard = (label) => {
    const card = document.createElement('div');
    card.className = 'ci-card';
    if (label) {
      const band = document.createElement('p');
      band.className = 'ci-band';
      band.textContent = label;
      card.append(band);
    }

    const table = document.createElement('table');
    table.className = 'ci-table';
    const colgroup = document.createElement('colgroup');
    colgroup.innerHTML = `<col class="ci-col-label">${'<col>'.repeat(Math.max(0, cols.length - 1))}`;
    const head = document.createElement('tr');
    cols.forEach((c, i) => {
      if (i === 0) { head.append(document.createElement('td')); return; }
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      head.append(th);
    });
    const thead = document.createElement('thead');
    thead.append(head);
    tbody = document.createElement('tbody');
    table.append(colgroup, thead, tbody);

    const body = document.createElement('div');
    body.className = 'ci-body';
    body.append(table);
    card.append(body);
    cards.push(card);
  };

  rows.slice(1).forEach((row) => {
    const cells = [...row.children];

    const legendText = getLegendText(cells);
    if (legendText !== null) {
      legendEl = document.createElement('p');
      legendEl.className = 'ct-legend';
      renderLegend(legendEl, legendSourceCell(cells), legendText, legendSummaryText(cells));
      return;
    }

    const nonEmpty = cells.filter((c) => c.textContent.trim());
    if (cells.length === 1 || (nonEmpty.length === 1 && cells[0].textContent.trim())) {
      newCard(cells[0].textContent.trim());
      return;
    }
    if (!tbody) newCard('');

    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    const tipText = extractTip(cells[0]);
    th.textContent = cells[0].textContent.trim();
    if (tipText) {
      const tipWrapper = buildTooltip(tipText);
      th.append(tipWrapper);
      th.setAttribute('aria-describedby', tipWrapper.querySelector('.ct-tip-popover').id);
    }
    tr.append(th);
    cells.slice(1).forEach((c) => tr.append(iesCell(c)));
    tbody.append(tr);
  });

  // footnotes move into the card whose values carry the <sup>
  const section = block.closest('.section');
  const footPs = section
    ? [...section.querySelectorAll('.default-content-wrapper p')].filter((p) => /^\s*\d/.test(p.textContent))
    : [];
  if (footPs.length && cards.length) {
    const supEl = cards.map((c) => c.querySelector('sup')).find(Boolean);
    const target = (supEl && supEl.closest('.ci-card')) || cards[0];
    const foot = document.createElement('div');
    foot.className = 'ci-foot';
    footPs.forEach((p) => {
      superscriptNote(p);
      foot.append(p); // append moves the node out of its wrapper
    });
    target.querySelector('.ci-body').append(foot);
    section.querySelectorAll('.default-content-wrapper').forEach((w) => {
      if (!w.textContent.trim() && !w.querySelector('img, picture, svg')) w.remove();
    });
  }

  // scroll all card bodies together
  const bodies = cards.map((c) => c.querySelector('.ci-body'));
  bodies.forEach((body) => body.addEventListener('scroll', () => {
    bodies.forEach((other) => {
      if (Math.abs(other.scrollLeft - body.scrollLeft) > 1) other.scrollLeft = body.scrollLeft;
    });
  }, { passive: true }));

  const wrap = document.createElement('div');
  wrap.className = 'ci-cards';
  wrap.append(...cards);
  block.replaceChildren(wrap);
  if (legendEl) block.append(legendEl);
}

export default function decorate(block) {
  if (block.classList.contains('simple')) {
    decorateSimple(block); return;
  }
  if (block.classList.contains('features')) {
    decorateFeatures(block); return;
  }
  if (block.classList.contains('ies')) {
    decorateIes(block); return;
  }

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
      renderLegend(legendEl, legendSourceCell(cells), legendText, legendSummaryText(cells));
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
