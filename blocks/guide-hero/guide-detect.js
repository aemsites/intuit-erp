/**
 * isGuidePage — the cheap "does this page get the guide card?" predicate, kept
 * apart from guide-hero-autoblock.js so scripts.js can decide whether to fetch
 * that module at all without statically importing it. Same split, and the same
 * reason, as blog-detect.js vs blog-template.js.
 */
import { getMetadata } from '../../scripts/aem.js';

/**
 * True on a Guide landing page, i.e. one that gets the `guide-hero` card
 * (blocks/guide-hero). The `Guide` template is the whole test — the same authored
 * signal decorateTemplateAndTheme turns into `body.guide`.
 *
 * Deliberately NOT also gated on a /blog/guide/ path. An earlier revision was, to
 * bound the change to the 9 pages the design was measured against, but the
 * template is the authored contract and the path is not: /library/templates/guide
 * already carries `template: Guide` with the same h1 + hero photo in section 1, so
 * a path gate leaves the very document authors copy a new guide FROM rendering as
 * the bare headline over an unconstrained image that issue #423 filed.
 *
 * isCaseStudyPage() (blog-detect.js) sets the precedent: template alone, no path.
 * isBlogPage()'s /blog/ prefix is load-bearing for a different reason — it has a
 * path-shape fallback for articles that carry no template metadata, which this
 * has no need of.
 * @returns {boolean}
 */
// eslint-disable-next-line import/prefer-default-export
export function isGuidePage() {
  return getMetadata('template').trim().toLowerCase() === 'guide';
}
