/**
 * icon-columns — 3 feature columns (compare "Grow confidently").
 * Section head (h2) authored as default content.
 * One row per column, cells: icon <img> / eyebrow / heading / body.
 * CSS: blocks/icon-columns/icon-columns.css
 */
function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

export default function decorate(block) {
  const rows = [...block.children];
  const grid = document.createElement('div');
  grid.className = 'cmp-grow-grid';

  rows.forEach((row) => {
    const cells = [...row.children];
    const col = document.createElement('article');
    col.className = 'cmp-col';
    const icon = pic(cells[0]);
    if (icon) { icon.classList.add('cmp-col-icon'); icon.setAttribute('alt', ''); col.append(icon); }
    if (cells[1] && cells[1].textContent.trim()) {
      const eb = document.createElement('p');
      eb.className = 'eyebrow cmp-col-eyebrow';
      eb.textContent = cells[1].textContent.trim();
      col.append(eb);
    }
    if (cells[2]) {
      // production marks these column titles up as <h2>; match that level.
      const h = document.createElement('h2');
      h.className = 'cmp-col-title';
      h.innerHTML = cells[2].innerHTML;
      col.append(h);
    }
    if (cells[3]) {
      const b = document.createElement('p');
      b.className = 'cmp-col-body';
      b.innerHTML = cells[3].innerHTML;
      col.append(b);
    }
    grid.append(col);
  });

  block.replaceChildren(grid);
}
