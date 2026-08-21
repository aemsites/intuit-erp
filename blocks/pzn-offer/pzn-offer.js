/**
 * pzn-offer — personalization target block for the placement-resolution demo
 * (see drafts/pzn-cell-demo.html and drafts/pzn-manifest.json). No decisioning
 * happens here: this block only renders the authored default content until the
 * aem-experimentation plugin's decisions-manifest mechanism swaps in the
 * Decision Engine's own returned fragment for this placement (see
 * scripts/personalization/byo.js `resolveDecisions` / `renderDecision`).
 * Content model: single default block of rich content (heading + paragraph).
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const cell = block.querySelector(':scope > div > div') || block;
  const inner = document.createElement('div');
  inner.className = 'pzn-offer-inner';
  inner.append(...cell.childNodes);
  block.replaceChildren(inner);
}
