/**
 * promo-banner — dark promo strip: offer text with `{{label}}` highlights and one CTA.
 * Content model: one row, `| promo text | link |`; a single cell uses its last link as the CTA.
 */
import { trackAs } from '../../scripts/tracking.js';

const LABEL_RE = /\{\{([^{}]+?)\}\}/g;

function isEmpty(el) {
  return !el.textContent.trim() && !el.querySelector('img, picture');
}

/**
 * Replaces `{{label}}` runs in text nodes with highlighted label spans.
 * @param {Element} root container to scan
 */
export function highlightLabels(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const value = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let found = false;
    [...value.matchAll(LABEL_RE)].forEach((match) => {
      const label = match[1].trim();
      if (!label) return;
      found = true;
      if (match.index > last) frag.append(document.createTextNode(value.slice(last, match.index)));
      const span = document.createElement('span');
      span.className = 'promo-banner-label';
      span.textContent = label;
      frag.append(span);
      last = match.index + match[0].length;
    });
    if (!found) return;
    if (last < value.length) frag.append(document.createTextNode(value.slice(last)));
    node.replaceWith(frag);
  });
}

function findCta(textCell, ctaCell) {
  if (ctaCell) return ctaCell.querySelector('a[href]');
  const links = textCell.querySelectorAll('a[href]');
  return links.length ? links[links.length - 1] : null;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const row = block.querySelector(':scope > div');
  const [textCell, ctaCell] = row ? [...row.children] : [];
  if (!textCell) return undefined;

  const cta = findCta(textCell, ctaCell);
  if (cta) {
    const wrapper = cta.parentElement;
    if (['STRONG', 'EM'].includes(wrapper.tagName) && wrapper.childNodes.length === 1) {
      wrapper.replaceWith(cta);
    }
    const p = cta.closest('p');
    cta.remove();
    if (p && isEmpty(p)) p.remove();
    // decorateButtons may have tagged it secondary/accent; the banner CTA is always primary
    cta.className = 'button primary';
  }

  const text = document.createElement('div');
  text.className = 'promo-banner-text';
  text.append(...textCell.childNodes);
  text.querySelectorAll('p').forEach((p) => { if (isEmpty(p)) p.remove(); });
  highlightLabels(text);

  const inner = document.createElement('div');
  inner.className = 'promo-banner-inner';
  inner.append(text);
  if (cta) {
    const ctaWrap = document.createElement('div');
    ctaWrap.className = 'promo-banner-cta';
    ctaWrap.append(cta);
    inner.append(ctaWrap);
  }
  block.replaceChildren(inner);

  return trackAs('promo_banner', block, { key: 'promo_banner' });
}
