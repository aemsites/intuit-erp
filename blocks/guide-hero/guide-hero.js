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
 * needs no reordering, and it makes the photo section 1's first <img> so aem.js
 * eager-loads it as the LCP candidate. CTA buttonizing is left to the global
 * decorateButtons (an <em>- or <strong>-wrapped link becomes .button.secondary /
 * .button.primary and this block's CSS styles either as the upstream ghost
 * button).
 *
 * A hero photo is optional. Without one the block takes its `no-media` variant —
 * no media half is inserted (an empty one renders as a blank half-card) and the
 * CSS drops the band for the plain centred headline upstream shows on
 * /blog/guide/webinars-on-demand.
 * CSS: blocks/guide-hero/guide-hero.css
 */

/**
 * True for an <img> that decorateIcons() produced from an `:icon-name:` token.
 * decorateIcons runs before buildAutoBlocks (see decorateMain), so an inline icon
 * is already a real <img> by the time this block decorates. Left unchecked it
 * would pass for the hero photo — a 16px SVG stretched across half the card, and
 * missing from the sentence it was authored in — and would suppress the plain
 * variant on a guide that has no real photo at all.
 * @param {Element} el a <picture> or <img>
 * @returns {boolean}
 */
function isIcon(el) {
  const img = el.tagName === 'PICTURE' ? el.querySelector('img') || el : el;
  return !!(img.closest('span.icon') || img.hasAttribute('data-icon-name'));
}

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
  const found = [...copy.querySelectorAll('picture, img')].find((el) => !isIcon(el));
  if (found) {
    // Lift the whole link when the photo is wrapped in one — a linked hero image
    // is a reasonable authoring choice on a gated-asset page, and taking only the
    // <picture> would silently drop the href.
    const el = found.closest('a') || found.closest('picture') || found;
    let host = el.parentElement;
    el.remove();
    // Then discard every ancestor the move emptied, not just the immediate one:
    // an emptied <p> still carries the global paragraph margin, and with a linked
    // image the emptied node is the <a>'s parent, one level further up.
    while (host && host !== copy && !host.textContent.trim() && !host.querySelector('img, picture')) {
      const parent = host.parentElement;
      host.remove();
      host = parent;
    }
    media.append(el);
  }

  // loading="eager" on the photo is left to aem.js: waitForFirstImage() sets it
  // on section 1's first <img> — which, after this split, is this one — and
  // loadSection awaits it as the callback right after loading this block.
  if (media.children.length) {
    block.replaceChildren(media, copy);
  } else {
    // marked here rather than sniffed with :has() in CSS, because decorate() is
    // what decides — one source of truth for which of the two variants this is
    block.classList.add('no-media');
    block.replaceChildren(copy);
  }
}
