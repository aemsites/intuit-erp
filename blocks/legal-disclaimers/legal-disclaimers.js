/**
 * legal-disclaimers — footnotes block (Mega Firms landing page "Legal";
 * Figma "disclaimer-group"): a centered blue title above a stack of 12px
 * disclaimer paragraphs.
 *
 * Content model — one cell per row:
 *   row 1: the title text (e.g. "*Important offers, pricing details, and
 *          disclaimers"); if the first row contains more than a short single
 *          paragraph it is treated as a disclaimer instead
 *   rows 2…n: one disclaimer each — one or more paragraphs; a bold lead-in
 *          (<strong>Label:</strong>) is preserved as authored
 * CSS: blocks/legal-disclaimers/legal-disclaimers.css
 */
export default function decorate(block) {
  const rows = [...block.children];
  const items = rows.map((row) => {
    const item = document.createElement('div');
    item.className = 'legal-item';
    [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => item.append(n)));
    item.querySelectorAll('p').forEach((p) => { if (!p.textContent.trim()) p.remove(); });
    if (!item.querySelector('p') && item.textContent.trim()) {
      const p = document.createElement('p');
      p.textContent = item.textContent.trim();
      item.textContent = '';
      item.append(p);
    }
    return item;
  }).filter((item) => item.textContent.trim());

  const first = items[0];
  const isTitle = first && first.querySelectorAll('p').length === 1 && first.textContent.trim().length <= 120;
  if (isTitle) {
    first.className = 'legal-title';
    const heading = first.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      const p = document.createElement('p');
      p.innerHTML = heading.innerHTML;
      heading.replaceWith(p);
    }
  }

  block.textContent = '';
  block.append(...items);
}
