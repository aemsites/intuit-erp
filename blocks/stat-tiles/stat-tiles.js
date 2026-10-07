/**
 * stat-tiles — wintermint band of headline stats (Mega Firms landing page):
 * gradient number over a muted label, one tile per stat.
 *
 * Content model — one row per stat, a single flowing cell:
 *   a bold-only line for the figure (e.g. "25,000+"), then the label
 *   paragraph (e.g. "firms trust ProConnect Tax*"). A trailing "*" is kept
 *   verbatim — the footnote lives in the page's legal section.
 * Hidden below 768px to match the mobile design, which omits the band.
 * CSS: blocks/stat-tiles/stat-tiles.css
 */
export default function decorate(block) {
  const tiles = [...block.children].map((row) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const content = document.createElement('div');
    [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => content.append(n)));

    const strong = content.querySelector('strong');
    const figure = document.createElement('p');
    figure.className = 'stat-tile-figure';
    if (strong) {
      figure.textContent = strong.textContent.trim();
      const p = strong.closest('p');
      (p || strong).remove();
    }

    const label = document.createElement('p');
    label.className = 'stat-tile-label';
    const text = content.textContent.trim();
    if (text) label.textContent = text;

    tile.append(figure);
    if (text) tile.append(label);
    return tile;
  });

  block.textContent = '';
  block.append(...tiles);
}
