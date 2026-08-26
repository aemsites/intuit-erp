/**
 * accolades — row of award badges with vertical dividers between them
 * (compare "Verified by more than our own word").
 *
 * Content model: one row per award, two cells —
 *   1. badge — the award image/logo
 *   2. label — optional text beside it ("2026 TrustRadius Top Rated");
 *              omit the cell for a logo-only award (e.g. Forrester)
 * An optional FIRST row with a SINGLE cell is the eyebrow above the row —
 * same single-cell-row convention comparison-table uses for its band rows.
 *
 * Distinct from logo-band, which takes images only and draws no dividers.
 * CSS: blocks/accolades/accolades.css
 */
export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  // A leading single-cell row is the eyebrow, not an award.
  let eyebrow = null;
  if (rows.length > 1 && rows[0].children.length === 1
    && !rows[0].querySelector('picture, img')) {
    [eyebrow] = rows.splice(0, 1);
    eyebrow.className = 'accolades-eyebrow';
  }

  const list = document.createElement('ul');
  list.className = 'accolades-list';

  rows.forEach((row) => {
    const cells = [...row.children];
    const item = document.createElement('li');
    item.className = 'accolades-item';

    const badge = cells[0]?.querySelector('picture, img');
    if (badge) {
      const figure = document.createElement('div');
      figure.className = 'accolades-badge';
      figure.append(badge.closest('picture') || badge);
      item.append(figure);
    }

    const labelText = cells[1]?.textContent.trim();
    if (labelText) {
      const label = document.createElement('p');
      label.className = 'accolades-label';
      label.append(...cells[1].childNodes);
      item.append(label);
    }

    if (item.children.length) list.append(item);
  });

  block.replaceChildren(...(eyebrow ? [eyebrow] : []), list);
}
