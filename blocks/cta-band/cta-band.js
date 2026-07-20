/**
 * cta-band — split stat card + dark CTA card (index "first call / 90%").
 * One row, cells:
 *   1. big stat number   2. stat description
 *   3. eyebrow   4. heading   5. body   6. CTA (<strong><a>)
 * CSS: blocks/cta-band/cta-band.css
 */
export default function decorate(block) {
  const row = block.querySelector(':scope > div');
  if (!row) return;
  const cells = [...row.children];
  const [numCell, descCell, eyebrowCell, headCell, bodyCell, ctaCell] = cells;

  const grid = document.createElement('div');
  grid.className = 'firstcall-grid';

  const stat = document.createElement('div');
  stat.className = 'firstcall-stat';
  const num = document.createElement('div');
  num.className = 'fc-num';
  num.textContent = numCell ? numCell.textContent.trim() : '';
  const desc = document.createElement('p');
  desc.className = 'fc-desc';
  if (descCell) desc.innerHTML = descCell.innerHTML;
  stat.append(num, desc);

  const card = document.createElement('div');
  card.className = 'firstcall-card';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'fc-eyebrow';
  eyebrow.textContent = eyebrowCell ? eyebrowCell.textContent.trim() : '';
  const title = document.createElement('h3');
  title.className = 'fc-title';
  title.textContent = headCell ? headCell.textContent.trim() : '';
  const body = document.createElement('p');
  body.className = 'fc-body';
  if (bodyCell) body.innerHTML = bodyCell.innerHTML;
  card.append(eyebrow, title, body);
  if (ctaCell) {
    [...ctaCell.childNodes].forEach((n) => card.append(n));
  }

  grid.append(stat, card);
  block.replaceChildren(grid);
}
