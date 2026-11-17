import { getMetadata } from '../../scripts/aem.js';

/**
 * Loads the promo fragment set in `enable-promo-banner` metadata.
 * Row 0 holds the message ({text} is highlighted), row 1 holds the CTA link.
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const bar = block.closest('.promo-banner-bar');
  const promoMeta = getMetadata('enable-promo-banner');
  const path = promoMeta ? new URL(promoMeta, window.location).pathname : '';

  const resp = path ? await fetch(`${path}.plain.html`) : null;
  const root = document.createElement('div');
  if (resp?.ok) root.innerHTML = await resp.text();
  const table = root.querySelector('.promo-banner');

  bar?.classList.add(...[...table.classList].filter((c) => c !== 'promo-banner'));

  const [contentRow, ctaRow] = table.children;
  const contentCell = contentRow?.firstElementChild;
  const message = document.createElement('p');
  message.innerHTML = (contentCell?.querySelector('p') || contentCell)?.innerHTML
    .replace(/\{([^}]*)\}/g, '<span class="promo-banner-highlight">$1</span>') || '';
  block.replaceChildren(message);

  const ctaButton = ctaRow?.querySelector('a');
  if (ctaButton) {
    ctaButton.className = 'button';
    const cta = document.createElement('p');
    cta.className = 'promo-banner-cta';
    cta.append(ctaButton);
    block.append(cta);
  }
}
