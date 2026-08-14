/**
 * isGuidePage — the cheap "does this page get the guide card?" predicate, kept
 * apart from guide-hero-autoblock.js so scripts.js can decide whether to fetch
 * that module at all without statically importing it. Same split, and the same
 * reason, as blog-detect.js vs blog-template.js.
 */
import { getMetadata } from '../../scripts/aem.js';

/**
 * True on a /blog/guide/* landing page, i.e. one that gets the `guide-hero` card
 * (blocks/guide-hero). Both halves are required:
 *  - the `Guide` template is the authored signal, and the same one
 *    decorateTemplateAndTheme turns into `body.guide`;
 *  - the path bounds it to the 9 pages the design was measured against, matching
 *    isBlogPage()'s precedent of requiring a /blog/ prefix as well as a template.
 *
 * Note the asymmetry this leaves: styles.css's imageless-guide rules key on
 * `body.guide` alone, since CSS cannot test the path. A `Guide` page outside
 * /blog/guide/ would therefore get the centred-headline treatment but no card.
 * That is cosmetic, and no such page exists today.
 * @returns {boolean}
 */
// eslint-disable-next-line import/prefer-default-export
export function isGuidePage() {
  if (!window.location.pathname.startsWith('/blog/guide/')) return false;
  return getMetadata('template').trim().toLowerCase() === 'guide';
}
