/**
 * columns — generic side-by-side column layout.
 * CSS: blocks/columns/columns.css
 */
export default function decorate(block) {
  const row = block.firstElementChild;
  if (!row) return;
  [...row.children].forEach((col) => {
    const pic = col.querySelector('picture');
    if (pic && col.children.length === 1) col.classList.add('columns-img-col');
  });
}
