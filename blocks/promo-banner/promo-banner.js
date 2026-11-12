import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

export default async function decorate(block) {
  const promoMeta = getMetadata('enable-promo-banner');
  const promoPath = promoMeta ? new URL(promoMeta, window.location).pathname : '';
  const fragment = await loadFragment(promoPath);
  if (!fragment) {
    block.closest('.promo-banner-bar')?.remove();
    window.dispatchEvent(new Event('promo-banner-resize'));
    return;
  }

  const rows = [...(fragment.querySelector('.default-content-wrapper')?.children || [])];
  const content = rows[0];
  const ctaButton = rows[1]?.querySelector('a');

  const message = document.createElement('p');
  if (content) {
    // wrap each {text} in a highlight span, dropping the braces
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      let node = textNode;
      let start = node.nodeValue.indexOf('{');
      let end = node.nodeValue.indexOf('}', start);
      while (start !== -1 && end !== -1) {
        const match = node.splitText(start);
        node = match.splitText(end - start + 1);
        const highlight = document.createElement('span');
        highlight.className = 'promo-banner-highlight';
        highlight.textContent = match.nodeValue.slice(1, -1);
        match.replaceWith(highlight);
        start = node.nodeValue.indexOf('{');
        end = node.nodeValue.indexOf('}', start);
      }
    });
    message.append(...content.childNodes);
  }

  block.replaceChildren(message);
  if (ctaButton) {
    // drop global button variants (primary/accent) so the block's own button styles apply
    ctaButton.className = 'button';
    if (isExternal(ctaButton.getAttribute('href')) && !ctaButton.hasAttribute('target')) {
      ctaButton.target = '_blank';
      ctaButton.relList.add('noopener');
    }
    const cta = document.createElement('p');
    cta.className = 'promo-banner-cta';
    cta.append(ctaButton);
    block.append(cta);
  }
}
