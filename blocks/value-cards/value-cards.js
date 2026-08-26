/**
 * value-cards — 4-up boxed icon cards (compare "Why finance teams switch").
 *
 * Content model: one row per card, two cells —
 *   1. icon  — an icon span (`:ies-rocket:` / `<span class="icon icon-…">`)
 *              or a small image
 *   2. copy  — a heading (card title) plus body paragraph(s)
 * A single-cell row is also accepted: the icon/image is lifted out of the
 * flowing copy, so authors can keep everything in one cell.
 *
 * Exists because `cards.icons` is fixed 3-up (`repeat(3, 1fr)`) and this
 * section is 4-up; the shared block is deliberately left untouched.
 * CSS: blocks/value-cards/value-cards.css
 */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    row.className = 'value-card';
    const cells = [...row.children];

    // Two-cell form: cell 1 is the icon, cell 2 the copy. Single-cell form:
    // pull the icon out of the copy so both author styles render identically.
    let iconCell = cells.length > 1 ? cells[0] : null;
    const copyCell = cells.length > 1 ? cells[1] : cells[0];
    if (!copyCell) return;

    if (!iconCell) {
      const found = copyCell.querySelector('span.icon, picture, img');
      if (found) {
        iconCell = document.createElement('div');
        const node = found.closest('picture') || found;
        // Drop the now-empty paragraph the icon was sitting in.
        const host = node.parentElement;
        iconCell.append(node);
        if (host && host !== copyCell && !host.textContent.trim()
          && !host.querySelector('span.icon, picture, img')) host.remove();
        row.prepend(iconCell);
      }
    }

    if (iconCell) iconCell.className = 'value-card-icon';
    copyCell.className = 'value-card-body';
  });
}
