/**
 * buildGuideHeroAutoBlock — promotes section 1 of a `template: Guide` page into a
 * `guide-hero` block. Split out of scripts.js so the gate is unit-testable
 * (blog-detect.js does the same for isBlogPage) and so scripts.js's eager path
 * stays a one-line call.
 *
 * See blocks/guide-hero/guide-hero.js for what the block does with the content
 * and why Guide pages get their own card rather than the blog-article band.
 */
import { buildBlock } from '../../scripts/aem.js';
import { isVideoLink } from '../video/video-info.js';

/**
 * True for an <img> that decorateIcons() produced from an `:icon-name:` token.
 * decorateIcons runs before buildAutoBlocks (see decorateMain), so by the time
 * this runs an inline icon is already a real <img> and would otherwise pass for
 * a hero photo — a 16px SVG stretched across half the card, and missing from the
 * sentence it was authored in.
 * @param {Element} img
 * @returns {boolean}
 */
const isIcon = (img) => !!(img.closest('span.icon') || img.hasAttribute('data-icon-name'));

/**
 * The hero photo in `section`, ignoring icons — null when there is none.
 * @param {Element} section
 * @returns {Element|null}
 */
function heroImage(section) {
  return [...section.querySelectorAll('picture, img')]
    .find((el) => !isIcon(el.tagName === 'PICTURE' ? el.querySelector('img') || el : el)) || null;
}

/**
 * True when `node` must be left in the section rather than absorbed into the
 * hero, because something downstream still needs to find it where it is:
 *  - a DIV is an authored block. decorateBlocks() only looks at
 *    `div.section > div > div`, so a block nested inside the hero's cell would
 *    never be decorated or have its CSS/JS loaded.
 *  - a lone video-host link is claimed by buildVideoAutoBlocks, which requires
 *    the paragraph to be a direct child of a section.
 *  - a lone `/widgets/` link is claimed by buildWidgetAutoBlocks, which has no
 *    such restriction and would happily build a block the loader can't reach.
 * @param {Element} node a direct child of section 1
 * @returns {boolean}
 */
function belongsToSection(node) {
  if (node.tagName === 'DIV') return true;
  const links = [...node.querySelectorAll('a[href]')];
  if (links.length !== 1) return false;
  const [a] = links;
  if (node.textContent.replace(a.textContent, '').trim()) return false;
  return isVideoLink(a.getAttribute('href')) || a.getAttribute('href').includes('/widgets/');
}

/**
 * Wraps section 1's headline, lede, CTA and hero photo in a `guide-hero` block.
 * No-op unless the page is `template: Guide` and section 1 has both an <h1> and
 * a hero photo — guides with no photo get no card upstream, just a centred
 * headline, which styles.css handles from the section left in place.
 * @param {Element} main the page's <main>
 * @param {string} template the page's `template` metadata, already normalised
 * @returns {Element|null} the inserted block, or null when nothing was built
 */
export default function buildGuideHeroAutoBlock(main, template) {
  if (template !== 'guide') return null;
  const firstSection = main.querySelector(':scope > div');
  if (!firstSection || firstSection.querySelector('.guide-hero')) return null;
  if (!firstSection.querySelector('h1') || !heroImage(firstSection)) return null;

  const elems = [...firstSection.children].filter((node) => !belongsToSection(node));
  if (!elems.length) return null;

  const block = buildBlock('guide-hero', { elems });
  firstSection.prepend(block);
  return block;
}
