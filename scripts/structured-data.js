/**
 * Shared JSON-LD (schema.org) infrastructure. Any module can contribute a node via
 * registerJsonLd(); every call re-renders the single <script type="application/ld+json"> in
 * <head>, so nodes registered at any point in the page lifecycle — including asynchronously,
 * e.g. the of1 SDK resolving after the delayed phase — still make it in.
 *
 * FAQPage nodes are registered by the block that owns that markup (blocks/faq/faq.js,
 * blocks/of1/of1.js) rather than re-derived here by guessing at every FAQ markup shape in the
 * codebase — a block that owns a DOM shape is far less likely to silently drift out of sync
 * with whatever reads that shape back out than a separate module querying for it after the fact.
 *
 * BreadcrumbList has no owning block (it's page-level, derived from the canonical URL), so it's
 * registered here directly — see registerBreadcrumb(), called once from delayed.js.
 *
 * Anything that isn't derivable from the DOM at all (Organization, WebSite, ratings, curated
 * descriptions, etc.) is out of scope for this module. Those are authored via the page's
 * `json-ld` metadata property, which the EDS pipeline injects into <head> on its own — see
 * https://www.aem.live/docs/authoring#special-metadata-properties. This module only ever adds
 * to that; it never duplicates it.
 */

const nodes = [];
let script;

function render() {
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    document.head.append(script);
  }
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
}

/**
 * Adds a schema.org node to the page's JSON-LD graph and re-renders immediately.
 * @param {object} node
 */
export function registerJsonLd(node) {
  nodes.push(node);
  render();
}

// Block-level tags whose boundaries must become word breaks when flattening rich HTML to plain
// text (blocks/faq/faq.js documents its answer cell as "may contain rich HTML" — e.g. a <p> plus
// a <ul> — and .textContent alone would run their contents together with no separator).
const BLOCK_TAGS = 'p, li, div, br, h1, h2, h3, h4, h5, h6, tr';

/**
 * Flattens an element to plain text, inserting a space at block-level boundaries so multi-element
 * rich HTML (paragraphs, lists) doesn't collapse into one run-together word.
 * @param {Element} el
 * @returns {string}
 */
function textWithSpacing(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(BLOCK_TAGS).forEach((block) => block.append(' '));
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a schema.org Question node from a question/answer element pair.
 * @param {Element|null|undefined} questionEl
 * @param {Element|null|undefined} answerEl
 * @returns {object|null} a Question node, or null if either element is missing/empty
 */
export function buildFaqEntity(questionEl, answerEl) {
  const name = questionEl && textWithSpacing(questionEl);
  const text = answerEl && textWithSpacing(answerEl);
  if (!name || !text) return null;
  return {
    '@type': 'Question',
    name,
    acceptedAnswer: { '@type': 'Answer', text },
  };
}

// Fixed across every page on this site (confirmed against the source site's own BreadcrumbList,
// where this name never varies by page) — not something derivable from page-specific content
// like <title>, so it isn't worth guessing at.
const SITE_NAME = 'Intuit Enterprise Suite';

/**
 * Registers this page's BreadcrumbList: Home -> this site (SITE_NAME) -> current page (using
 * <title>, the one page-specific label every page reliably has). The homepage has no
 * page-specific crumb, matching the two-level breadcrumb used across the source site.
 */
export function registerBreadcrumb() {
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.href
    || window.location.href;
  const url = new URL(canonicalHref);
  const isHome = url.pathname === '/';

  const itemListElement = [
    {
      '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.intuit.com/',
    },
    {
      '@type': 'ListItem', position: 2, name: SITE_NAME, item: `${url.origin}/`,
    },
  ];
  if (!isHome) {
    itemListElement.push({
      '@type': 'ListItem',
      position: 3,
      name: document.title.trim(),
      item: canonicalHref,
    });
  }

  registerJsonLd({
    '@type': 'BreadcrumbList',
    '@id': `${canonicalHref}#breadcrumb`,
    itemListElement,
  });
}
