/**
 * pzn-hero — personalization target block for the cell-resolution demo
 * (see drafts/pzn-cell-demo.html and drafts/pzn-manifest.json). No decisioning
 * happens here: this block only renders the authored default content until the
 * aem-experimentation plugin's audience-manifest mechanism swaps in a
 * cell-specific fragment (see scripts/personalization/byo.js `renderDecision`).
 * Content model: single cell of rich content (heading + paragraph).
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const cell = block.querySelector(':scope > div > div') || block;
  const inner = document.createElement('div');
  inner.className = 'pzn-hero-inner';
  inner.append(...cell.childNodes);
  block.replaceChildren(inner);
}
