import { getMetadata } from '../../scripts/aem.js';

const VARIANTS = ['dark-blue', 'green', 'light-green', 'sky', 'tofu', 'beige'];

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

/**
 * Fetches the promo fragment's raw markup and returns its "Promo Banner" table.
 * Deliberately not decorated via loadFragment(): decorating would load this same
 * block inside the fragment, which would fetch the fragment again, recursively.
 * @param {string} path The fragment path
 * @returns {Promise<Element|null>} The fragment's promo-banner block element
 */
async function fetchPromoTable(path) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  const plainPath = path.endsWith('/') ? `${path}index` : path;
  const resp = await fetch(`${plainPath}.plain.html`);
  if (!resp.ok) return null;
  const root = document.createElement('div');
  root.innerHTML = await resp.text();
  return root.querySelector('.promo-banner');
}

/**
 * True when a table cell holds nothing but a single link (the CTA cell).
 * @param {Element} cell The table cell
 */
function isCtaCell(cell) {
  const links = cell.querySelectorAll('a');
  return links.length === 1 && cell.textContent.trim() === links[0].textContent.trim();
}

/**
 * Wraps each {text} in a highlight span, dropping the braces.
 * @param {Element} content The element to scan
 */
function decorateHighlights(content) {
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
}

export default async function decorate(block) {
  const bar = block.closest('.promo-banner-bar');
  const promoMeta = getMetadata('enable-promo-banner');
  const promoPath = promoMeta ? new URL(promoMeta, window.location).pathname : '';
  const table = await fetchPromoTable(promoPath);
  if (!table) {
    bar?.remove();
    window.dispatchEvent(new Event('promo-banner-resize'));
    return;
  }

  // variant: page metadata wins, else the table's own option, e.g. "Promo Banner (green)"
  const metaVariant = getMetadata('promo-banner-variant').trim().toLowerCase();
  const variant = VARIANTS.includes(metaVariant)
    ? metaVariant
    : VARIANTS.find((v) => table.classList.contains(v));
  if (variant) bar?.classList.add(variant);

  // rows are <div>s of cell <div>s; message + CTA may be authored as two rows or two columns
  const cells = [...table.querySelectorAll(':scope > div > div')]
    .filter((cell) => cell.textContent.trim());
  const ctaCell = cells.find(isCtaCell);
  const content = cells.find((cell) => cell !== ctaCell);
  const ctaButton = ctaCell?.querySelector('a');

  const message = document.createElement('p');
  if (content) {
    decorateHighlights(content);
    // unwrap a single authored <p> so the message stays one paragraph
    const source = content.children.length === 1 && content.firstElementChild.tagName === 'P'
      ? content.firstElementChild
      : content;
    message.append(...source.childNodes);
  }

  block.replaceChildren(message);
  if (ctaButton) {
    // drop any button variant classes so the block's own button styles apply
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
