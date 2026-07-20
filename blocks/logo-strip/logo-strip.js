/**
 * logo-strip — dark band, a single row of customer logo images (index).
 * Authoring: one cell holding all logo <img>s (or one row per logo).
 * CSS: blocks/logo-strip/logo-strip.css
 */
export default function decorate(block) {
  const imgs = [...block.querySelectorAll('picture, img')];
  const row = document.createElement('div');
  row.className = 'logostrip-row';
  imgs.forEach((img) => {
    const el = img.closest('picture') || img;
    row.append(el);
  });
  block.replaceChildren(row);
}
