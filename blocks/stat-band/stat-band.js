/**
 * stat-band — band of stat figures (index, pricing).
 *
 * Section head (h2) is authored as default content before the block.
 * Block rows = one row per stat:
 *   default (index): number / description / company / segment
 *   .stat-band.dark (pricing "Data-backed performance"): number / description
 * An optional trailing paragraph (foot/disclaimer) is authored as default content.
 * CSS: blocks/stat-band/stat-band.css
 */

function txt(cell) { return cell ? cell.textContent.trim() : ''; }

export default function decorate(block) {
  const dark = block.classList.contains('dark');
  const rows = [...block.children];

  const grid = document.createElement('div');
  grid.className = 'stats-grid';

  rows.forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;
    const stat = document.createElement('div');
    stat.className = 'stat';
    const num = document.createElement('div');
    num.className = 'stat-num';
    num.textContent = txt(cells[0]);
    stat.append(num);
    if (cells[1]) {
      const desc = document.createElement('p');
      desc.className = 'stat-desc';
      desc.innerHTML = cells[1].innerHTML;
      stat.append(desc);
    }
    if (cells[2] && txt(cells[2])) {
      const co = document.createElement('p');
      co.className = 'stat-co';
      co.textContent = txt(cells[2]);
      stat.append(co);
    }
    if (cells[3] && txt(cells[3])) {
      const seg = document.createElement('p');
      seg.className = 'stat-seg';
      seg.textContent = txt(cells[3]);
      stat.append(seg);
    }
    grid.append(stat);
  });

  block.replaceChildren(grid);

  // decorative pager dots (light/index variant only)
  if (!dark) {
    const dots = document.createElement('div');
    dots.className = 'stats-dots';
    dots.innerHTML = '<span class="dot active"></span><span class="dot"></span><span class="arrow" aria-hidden="true">›</span>';
    block.append(dots);
  }
}
