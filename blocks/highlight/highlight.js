/**
 * highlight — colored-background rich-content callout.
 * Content model: single cell of rich content (heading + list/paragraphs).
 * Variant via block class (e.g. `highlight sky`); default light-blue.
 */
export default function decorate(block) {
  const cell = block.querySelector(':scope > div > div') || block;
  const inner = document.createElement('div');
  inner.className = 'highlight-inner';
  inner.append(...cell.childNodes);
  block.replaceChildren(inner);
}
