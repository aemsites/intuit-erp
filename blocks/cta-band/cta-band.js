import { trackAs } from '../../scripts/tracking.js';

function text(el) {
  return el ? el.textContent.trim() : '';
}

function buildStat(row) {
  const container = document.createElement('div');
  [...row.children].forEach((cell) => {
    [...cell.childNodes].forEach((n) => container.append(n));
  });

  const stat = document.createElement('div');
  stat.className = 'firstcall-stat';
  const num = document.createElement('div');
  num.className = 'fc-num';
  const strong = container.querySelector('strong');
  if (strong) {
    num.textContent = text(strong);
    strong.remove();
  }
  stat.append(num);

  container.querySelectorAll('p').forEach((p) => {
    if (!text(p) && !p.querySelector('img, picture')) p.remove();
  });

  if (text(container)) {
    const kids = [...container.children];
    const lone = kids.length === 1 && kids[0].tagName === 'P';
    const desc = document.createElement(lone ? 'p' : 'div');
    desc.className = 'fc-desc';
    const src = lone ? kids[0] : container;
    [...src.childNodes].forEach((n) => desc.append(n));
    stat.append(desc);
  }

  return stat;
}

function buildCard(row) {
  const card = document.createElement('div');
  card.className = 'firstcall-card';
  [...row.children].forEach((cell) => {
    [...cell.childNodes].forEach((n) => card.append(n));
  });

  const heading = card.querySelector('h1, h2, h3, h4');
  if (heading) heading.classList.add('fc-title');

  const bodyParas = [];
  card.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('a')) return;
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) {
      p.classList.add('fc-eyebrow');
    } else {
      bodyParas.push(p);
    }
  });

  if (bodyParas.length === 1) {
    bodyParas[0].classList.add('fc-body');
  } else if (bodyParas.length > 1) {
    const body = document.createElement('div');
    body.className = 'fc-body';
    bodyParas[0].before(body);
    bodyParas.forEach((p) => body.append(p));
  }

  return card;
}

export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  const hasStat = rows.length > 1;
  block.classList.toggle('simple', !hasStat);

  const grid = document.createElement('div');
  grid.className = 'firstcall-grid';
  if (hasStat) grid.append(buildStat(rows[0]));
  grid.append(buildCard(hasStat ? rows[1] : rows[0]));

  block.replaceChildren(grid);

  // Click tracking: prod reports the CTA band under the `cta_block` trail.
  trackAs('cta_block', block, { key: 'cta' });
}
