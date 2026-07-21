/**
 * columns — generic side-by-side column layout. Used by OF1-generated
 * content (blocks/of1), which emits a single `.columns > div` row of
 * column cells. Full styling lives in blocks/of1/of1.css (.generated-section .columns).
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
