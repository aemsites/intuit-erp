/**
 * solution-cards — two large solution cards (erp-solutions).
 * Section head (eyebrow + h2 + intro) authored as default content.
 * One row per card, cells:
 *   1. eyebrow   2. title   3. lead   4. bullets (<ul>)   5. CTA (<strong><a>)   6. media <img>
 * First card = blue skin, second = sand.
 * A CTA linking to "#schedule" opens the shared "Schedule a call" modal
 * (scripts/schedule-modal.js) instead of navigating.
 * CSS: blocks/solution-cards/solution-cards.css
 */
import { openScheduleModal } from '../../scripts/schedule-modal.js';

function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

export default function decorate(block) {
  const rows = [...block.children];
  const grid = document.createElement('div');
  grid.className = 'solutions-grid';

  rows.forEach((row, i) => {
    const cells = [...row.children];
    const card = document.createElement('article');
    card.className = `sol-card ${i % 2 === 0 ? 'sol-card-blue' : 'sol-card-sand'}`;
    if (cells[0] && cells[0].textContent.trim()) {
      const eb = document.createElement('p');
      eb.className = 'eyebrow';
      eb.textContent = cells[0].textContent.trim();
      card.append(eb);
    }
    if (cells[1]) {
      const h = document.createElement('h3');
      h.className = 'sol-title';
      h.textContent = cells[1].textContent.trim();
      card.append(h);
    }
    if (cells[2]) {
      const lead = document.createElement('p');
      lead.className = 'sol-lead';
      lead.textContent = cells[2].textContent.trim();
      card.append(lead);
    }
    if (cells[3]) {
      const ul = cells[3].querySelector('ul');
      if (ul) { ul.classList.add('sol-bullets'); card.append(ul); }
    }
    if (cells[4] && cells[4].querySelector('a')) {
      [...cells[4].childNodes].forEach((n) => card.append(n));
      card.querySelectorAll('a[href="#schedule"]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openScheduleModal();
        });
      });
    }
    const shot = pic(cells[5]);
    if (shot) {
      const wrap = document.createElement('div');
      wrap.className = 'sol-shot';
      wrap.append(shot);
      card.append(wrap);
    }
    grid.append(card);
  });

  block.replaceChildren(grid);
}
