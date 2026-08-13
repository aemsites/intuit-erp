/**
 * isBlogPage — the cheap "is this a blog article?" predicate, split out from
 * blog-template.js so scripts.js can gate blog decoration in the eager phase
 * without statically importing the (~21KB) blog-template module on every page.
 * blog-template.js re-exports it so its public API is unchanged.
 */
import { getMetadata } from '../../scripts/aem.js';

/**
 * The `template` metadata values under /blog/ that are article pages — an H1 +
 * hero image authored in section 1 with prose below — and so get the identical
 * blog-template treatment: the `.blog-hero` band, the TOC rail and the right
 * rail. Verified against erp.intuit.com, which renders a case study
 * (/blog/case-study/fire-and-ice-intuit-enterprise-suite-review) with exactly
 * the same band + rails as a standard blog article.
 *
 * Deliberately absent:
 *  - `category`, `author`, `search` — listing pages; they own their own layout.
 *  - `guide` — a gated-asset landing page. Upstream gives it a different hero
 *    (image left on a mint band, headline + lede + CTA right, no eyebrow and no
 *    byline) over a full-width body, not this article layout. Tracked
 *    separately; adding it here would be worse than leaving it plain.
 */
export const ARTICLE_TEMPLATES = ['blog article', 'case study', 'research'];

/**
 * The page's `template` metadata, lower-cased and trimmed so it can be compared
 * against ARTICLE_TEMPLATES. Empty string when the page carries no template.
 * @returns {string}
 */
export function pageTemplate() {
  return getMetadata('template').trim().toLowerCase();
}

/**
 * True on a blog *article* page (drives the hero/TOC/right-rail template build).
 * @returns {boolean}
 */
export function isBlogPage() {
  const path = window.location.pathname;
  if (!path.startsWith('/blog/')) return false;
  const template = pageTemplate();
  // An explicitly authored template always decides — including one we don't
  // recognise, which must not then be guessed at from the path shape.
  if (template) return ARTICLE_TEMPLATES.includes(template);
  // fallback (no template metadata): /blog/<category>/<slug>, not /blog/author/*
  const segments = path.replace(/\/+$/, '').slice('/blog/'.length).split('/').filter(Boolean);
  return segments.length >= 2 && segments[0] !== 'author';
}
