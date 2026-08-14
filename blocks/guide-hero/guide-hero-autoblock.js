/**
 * buildGuideHeroAutoBlock — promotes section 1 of a Guide landing page into a
 * `guide-hero` block. Split out of scripts.js so it is unit-testable, and so the
 * module is only fetched for the pages that use it: loadEager imports it behind
 * isGuidePage() (./guide-detect.js), which is therefore the template/path gate —
 * this function only decides whether section 1 has the right SHAPE.
 *
 * See blocks/guide-hero/guide-hero.js for what the block does with the content
 * and why Guide pages get their own card rather than the blog-article band.
 */
import { buildBlock } from '../../scripts/aem.js';
import { isVideoLink } from '../video/video-info.js';

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
 * Callers are expected to have checked isGuidePage() already; all this needs is an
 * <h1> to build a header around.
 *
 * The hero photo is optional on purpose. Upstream renders an imageless guide as a
 * plain centred headline with no band (/blog/guide/webinars-on-demand), and that
 * is the block's `no-media` variant rather than a rule somewhere global: building
 * the block either way is what lets ALL of this template's styling live in
 * guide-hero.css, instead of leaking the imageless case into styles.css — which
 * every page on the site downloads — just because the block would otherwise be
 * absent there.
 * @param {Element} main the page's <main>
 * @returns {Element|null} the inserted block, or null when nothing was built
 */
export default function buildGuideHeroAutoBlock(main) {
  const firstSection = main.querySelector(':scope > div');
  if (!firstSection || firstSection.querySelector('.guide-hero')) return null;
  if (!firstSection.querySelector('h1')) return null;

  const elems = [...firstSection.children].filter((node) => !belongsToSection(node));
  if (!elems.length) return null;

  const block = buildBlock('guide-hero', { elems });
  firstSection.prepend(block);
  return block;
}
