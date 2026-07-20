/**
 * feature-grid — 2x2 image cards (index).
 * Section head (h2) authored as default content before the block.
 * Rows: one row per card — cell 1: <img>, cell 2: title text.
 * CSS: blocks/feature-grid/feature-grid.css
 */
export default function decorate(block) {
  const rows = [...block.children];
  const grid = document.createElement('div');
  grid.className = 'feature-grid';

  rows.forEach((row) => {
    const cells = [...row.children];
    const pic = row.querySelector('picture, img');
    const titleCell = cells.find((c) => c.textContent.trim());
    const card = document.createElement('article');
    card.className = 'feature-card';
    if (pic) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'feature-img';
      imgWrap.append(pic.closest('picture') || pic);
      card.append(imgWrap);
    }
    const body = document.createElement('div');
    body.className = 'feature-body';
    const title = document.createElement('p');
    title.className = 'feature-title';
    title.textContent = titleCell ? titleCell.textContent.trim() : '';
    body.append(title);
    const plus = document.createElement('button');
    plus.className = 'feature-plus';
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Expand');
    plus.textContent = '+';
    body.append(plus);
    card.append(body);
    grid.append(card);
  });

  block.replaceChildren(grid);
}
