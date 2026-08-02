/**
 * cta-band — bottom-of-page conversion band, authored as a key/value table
 * (one field per row: label cell + value cell). Fields are read by label, so
 * order doesn't matter and unused fields can simply be omitted.
 *
 *   default   Split stat card + dark CTA card (homepage, case studies).
 *             Fields: stat · stat description · eyebrow · heading · body · cta
 *
 *   simple    Single centered dark CTA card (guide download pages).
 *             Fields: heading · body · cta
 *
 * A CTA linking to "#schedule" opens the shared Schedule-a-call modal
 * (scripts/schedule-modal.js); a "#download" CTA is left to scroll the page
 * to its download form.
 * CSS: blocks/cta-band/cta-band.css
 */
import { openScheduleModal } from '../../scripts/schedule-modal.js';

/** Read a key/value block into { label: valueCell } keyed by lowercased label. */
function readFields(block) {
  const fields = {};
  block.querySelectorAll(':scope > div').forEach((row) => {
    const cells = [...row.children];
    if (cells.length < 2) return;
    const [labelCell, valueCell] = cells;
    const key = labelCell.textContent.trim().toLowerCase();
    if (key) fields[key] = valueCell;
  });
  return fields;
}

function text(cell) {
  return cell ? cell.textContent.trim() : '';
}

/**
 * Build a styled container from a value cell's rich content. A single-paragraph
 * value becomes a <p> (its inline content lifted out, so we never nest <p>); a
 * multi-paragraph or block value becomes a <div> that keeps its paragraphs.
 */
function fillRich(className, cell) {
  const kids = cell ? [...cell.children] : [];
  const lone = kids.length === 1 && kids[0].tagName === 'P';
  const el = document.createElement(lone ? 'p' : 'div');
  el.className = className;
  const src = lone ? kids[0] : cell;
  if (src) [...src.childNodes].forEach((n) => el.append(n));
  return el;
}

function buildCard(fields) {
  const card = document.createElement('div');
  card.className = 'firstcall-card';

  const eyebrow = text(fields.eyebrow);
  if (eyebrow) {
    const p = document.createElement('p');
    p.className = 'fc-eyebrow';
    p.textContent = eyebrow;
    card.append(p);
  }

  const heading = text(fields.heading);
  if (heading) {
    const title = document.createElement('h3');
    title.className = 'fc-title';
    title.textContent = heading;
    card.append(title);
  }

  if (text(fields.body)) {
    card.append(fillRich('fc-body', fields.body));
  }

  if (fields.cta) {
    [...fields.cta.childNodes].forEach((n) => card.append(n));
  }

  card.querySelectorAll('a[href="#schedule"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openScheduleModal();
    });
  });

  return card;
}

export default function decorate(block) {
  const fields = readFields(block);
  const grid = document.createElement('div');
  grid.className = 'firstcall-grid';

  if (!block.classList.contains('simple')) {
    const stat = document.createElement('div');
    stat.className = 'firstcall-stat';
    const num = document.createElement('div');
    num.className = 'fc-num';
    num.textContent = text(fields.stat);
    stat.append(num, fillRich('fc-desc', fields['stat description']));
    grid.append(stat);
  }

  grid.append(buildCard(fields));
  block.replaceChildren(grid);
}
