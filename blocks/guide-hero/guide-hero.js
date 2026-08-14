/**
 * guide-hero — lead band for /blog/guide/* gated-asset landing pages
 * (`template: Guide`).
 *
 * Not authored directly: scripts.js's buildGuideHeroAutoBlock wraps section 1 in
 * this block whenever a Guide page has both an <h1> and a hero image, so authors
 * keep writing plain default content (headline, optional lede, optional CTA
 * link, hero image) exactly as they do today.
 *
 * Upstream (erp.intuit.com/blog/guide/*) renders that content as a mint card:
 * the photo fills the left half flush to the card's edges, the copy sits in the
 * right half — headline, lede, then an outlined navy CTA. It is deliberately
 * NOT the blog-article treatment: no category eyebrow, no byline, no table of
 * contents and no rails, because these are landing pages rather than articles
 * (see issue #423). Guides with no hero image get no band at all upstream, just
 * a centred headline — that case never reaches this block; the autoblock skips
 * it and styles/styles.css handles it.
 *
 * All this decorate() does is split the authored flow into a media half and a
 * copy half so CSS has two boxes to place. Media comes first in the DOM because
 * that is also the mobile order (photo above the copy), so the stacked layout
 * needs no reordering. CTA buttonizing is left to the global decorateButtons
 * (an <em>- or <strong>-wrapped link becomes .button.secondary / .button.primary
 * and this block's CSS styles either as the upstream ghost button).
 * CSS: blocks/guide-hero/guide-hero.css
 */

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const copy = document.createElement('div');
  copy.className = 'guide-hero-copy';
  // the autoblock hands over one row / one cell holding the whole authored flow
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    [...cell.childNodes].forEach((node) => copy.append(node));
  });

  const media = document.createElement('div');
  media.className = 'guide-hero-media';
  const found = copy.querySelector('picture, img');
  if (found) {
    const el = found.closest('picture') || found;
    const host = el.parentElement;
    el.remove();
    // drop the paragraph the author wrapped the image in, now that it is empty —
    // an empty <p> still carries the global paragraph margin.
    if (host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) {
      host.remove();
    }
    media.append(el);
  }

  // The hero photo is the LCP element on these pages, so let it load eagerly —
  // the pipeline marks authored images lazy by default, which delays the paint.
  const img = media.querySelector('img');
  if (img) {
    img.setAttribute('loading', 'eager');
    img.removeAttribute('fetchpriority');
  }

  block.replaceChildren(media, copy);
}
