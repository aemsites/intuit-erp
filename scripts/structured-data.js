/**
 * Programmatic JSON-LD (schema.org) for parts that are mechanically derivable from the
 * rendered page — BreadcrumbList (from the canonical URL) and FAQPage (from any authored
 * Q&A pairs, whether in a .faq block or an of1-deep-dive-faq-explainer template). Anything
 * that isn't derivable from the DOM (Organization, WebSite, ratings, curated descriptions,
 * etc.) is authored separately via the page's `json-ld` metadata property, which the EDS
 * pipeline injects into <head> on its own — see
 * https://www.aem.live/docs/authoring#special-metadata-properties. This module only ever adds
 * to that; it never duplicates it.
 *
 * Runs in the delayed phase (see delayed.js) so it never competes with LCP, and after
 * loadSections() has resolved so every .faq block on the page is already decorated. Pages whose
 * FAQ content is rendered by the async of1 SDK (blocks/of1/of1.js) are only covered if that SDK
 * call has resolved by the time this runs — a pre-existing timing characteristic of of1 pages,
 * not something this module can control.
 *
 * templates/prototype-home.html also authors a `<details class="faq-item"><summary>` FAQ shape,
 * but that file has no <head>/script include of its own, isn't wired into templates-catalog.json
 * or any block, and 404s without its .html extension — it's an unreferenced design mockup, not a
 * servable page, so it's intentionally not a third shape handled here.
 */

// Fixed across every page on this site (confirmed against the source site's own BreadcrumbList,
// where this name never varies by page) — not something derivable from page-specific content
// like <title>, so it isn't worth guessing at.
const SITE_NAME = 'Intuit Enterprise Suite';

// Block-level tags whose boundaries must become word breaks when flattening rich HTML to plain
// text (blocks/faq/faq.js documents cell 2 as "may contain rich HTML" — e.g. a <p> plus a <ul> —
// and .textContent alone would run their contents together with no separator).
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
 * One schema.org Question per authored FAQ item. Recognizes both the standard .faq block
 * (blocks/faq/faq.js: .faq-item > .faq-question / .faq-answer) and the of1-deep-dive-faq-explainer
 * template (templates/of1-deep-dive-faq-explainer.html: details.of1-faqx-faq-item > summary /
 * .of1-faqx-faq-answer) — the two authored FAQ markups that exist in this codebase.
 * @returns {Array<object>} or [] if none
 */
function getFaqEntities() {
  const items = [
    ...[...document.querySelectorAll('main .faq-item')].map((item) => ({
      question: item.querySelector('.faq-question'),
      answer: item.querySelector('.faq-answer'),
    })),
    ...[...document.querySelectorAll('main .of1-faqx-faq-item')].map((item) => ({
      question: item.querySelector('summary'),
      answer: item.querySelector('.of1-faqx-faq-answer'),
    })),
  ];

  return items
    .map(({ question, answer }) => {
      const name = question && textWithSpacing(question);
      const text = answer && textWithSpacing(answer);
      if (!name || !text) return null;
      return {
        '@type': 'Question',
        name,
        acceptedAnswer: { '@type': 'Answer', text },
      };
    })
    .filter(Boolean);
}

/**
 * Builds a BreadcrumbList from the canonical URL: Home -> this site (SITE_NAME) -> current page
 * (using <title>, the one page-specific label every page reliably has). The homepage has no
 * page-specific crumb, matching the two-level breadcrumb used across the source site.
 * @param {string} canonicalHref
 * @returns {object} schema.org BreadcrumbList
 */
function buildBreadcrumb(canonicalHref) {
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

  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalHref}#breadcrumb`,
    itemListElement,
  };
}

/**
 * Builds and appends a single <script type="application/ld+json"> to <head> containing every
 * dynamically-derivable node for the current page. No-op beyond the breadcrumb if the page has
 * no .faq block.
 */
export default function buildStructuredData() {
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.href
    || window.location.href;

  const graph = [buildBreadcrumb(canonicalHref)];

  const faqEntities = getFaqEntities();
  if (faqEntities.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonicalHref}#faq`,
      mainEntity: faqEntities,
    });
  }

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
  document.head.append(script);
}
