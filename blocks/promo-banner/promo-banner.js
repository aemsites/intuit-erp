import { getMetadata } from '../../scripts/aem.js';

/**
 * Fetches the authored promo-banner blocks from the `enable-promo-banner` fragment.
 * @returns {Promise<Element[]>} The authored blocks, in document order
 */
async function fetchPromoBanners() {
  const promoMeta = getMetadata('enable-promo-banner');
  const path = promoMeta ? new URL(promoMeta, window.location).pathname : '';

  const resp = path ? await fetch(`${path}.plain.html`) : null;
  const root = document.createElement('div');
  if (resp?.ok) root.innerHTML = await resp.text();
  return [...root.querySelectorAll('.promo-banner')];
}

/**
 * @param {Element} banner The element to render into
 * @param {Element} table The authored block (may be the banner itself)
 */
function renderBanner(banner, table) {
  banner.classList.add(...table.classList);

  const [contentRow, ctaRow] = table.children;
  const contentCell = contentRow?.firstElementChild;
  const message = document.createElement('p');
  message.innerHTML = (contentCell?.querySelector('p') || contentCell)?.innerHTML
    .replace(/\{([^}]*)\}/g, '<span class="promo-banner-highlight">$1</span>') || '';
  banner.replaceChildren(message);

  const ctaButton = ctaRow?.querySelector('a');
  if (ctaButton) {
    ctaButton.className = 'button';
    const cta = document.createElement('p');
    cta.className = 'promo-banner-cta';
    cta.append(ctaButton);
    banner.append(cta);
  }
}

/**
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const [first, ...rest] = block.closest('main') ? [block] : await fetchPromoBanners();
  if (!first) {
    block.parentElement.remove();
    return;
  }

  const extraBanners = rest.map((table) => {
    const banner = block.cloneNode(false);
    banner.dataset.blockStatus = 'loaded';
    renderBanner(banner, table);
    return banner;
  });
  renderBanner(block, first);
  block.after(...extraBanners);
}
