import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

function setPage({ pathname, title, canonical }) {
  window.history.pushState({}, '', pathname);
  document.title = title;
  document.head.querySelectorAll('link[rel="canonical"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'canonical';
  link.href = canonical;
  document.head.append(link);
}

function getGraph() {
  const script = document.head.querySelector('script[type="application/ld+json"]');
  return JSON.parse(script.textContent);
}

function el(tag, html) {
  const node = document.createElement(tag);
  node.innerHTML = html;
  return node;
}

// The module holds its registered-nodes list at module scope (by design — one page load, one
// graph). Reset the module between tests so each test starts with an empty graph.
let registerJsonLd;
let registerFaqPage;
let buildFaqEntity;
let registerBreadcrumb;

beforeEach(async () => {
  document.head.querySelectorAll('script[type="application/ld+json"], link[rel="canonical"]')
    .forEach((n) => n.remove());
  vi.resetModules();
  ({
    registerJsonLd, registerFaqPage, buildFaqEntity, registerBreadcrumb,
  } = await import('../scripts/structured-data.js'));
});

describe('registerJsonLd', () => {
  it('renders a single script tag and appends nodes from multiple callers into one @graph', () => {
    registerJsonLd({ '@type': 'BreadcrumbList', itemListElement: [] });
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);

    registerJsonLd({ '@type': 'FAQPage', mainEntity: [] });
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);

    const { '@graph': graph } = getGraph();
    expect(graph.map((n) => n['@type'])).toEqual(['BreadcrumbList', 'FAQPage']);
  });

  it('replaces a prior registration under the same key instead of duplicating it', () => {
    const key = {};
    registerJsonLd({ '@type': 'FAQPage', mainEntity: ['stale'] }, key);
    registerJsonLd({ '@type': 'FAQPage', mainEntity: ['fresh'] }, key);

    const { '@graph': graph } = getGraph();
    expect(graph).toHaveLength(1);
    expect(graph[0].mainEntity).toEqual(['fresh']);
  });

  it('keeps separate keys as independent nodes', () => {
    registerJsonLd({ '@type': 'FAQPage', mainEntity: ['a'] }, 'key-a');
    registerJsonLd({ '@type': 'FAQPage', mainEntity: ['b'] }, 'key-b');

    const { '@graph': graph } = getGraph();
    expect(graph).toHaveLength(2);
  });
});

describe('registerFaqPage', () => {
  it('registers nothing when there are no entities', () => {
    registerFaqPage([], 'key');
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});

describe('buildFaqEntity', () => {
  it('builds a Question node from a question/answer element pair', () => {
    const question = el('span', 'How easy is it to migrate?');
    const answer = el('div', 'Very easy.');
    expect(buildFaqEntity(question, answer)).toEqual({
      '@type': 'Question',
      name: 'How easy is it to migrate?',
      acceptedAnswer: { '@type': 'Answer', text: 'Very easy.' },
    });
  });

  it('inserts word breaks between block-level elements in a rich-HTML answer', () => {
    const question = el('span', 'Who is it for?');
    const answer = el('div', '<p>Intuit Enterprise Suite is ideal for:</p><ul><li>Item one.</li><li>Item two.</li></ul><p>Closing sentence.</p>');
    expect(buildFaqEntity(question, answer).acceptedAnswer.text)
      .toBe('Intuit Enterprise Suite is ideal for: Item one. Item two. Closing sentence.');
  });

  it('returns null when the question or answer element is missing or empty', () => {
    expect(buildFaqEntity(null, el('div', 'Answer with no question'))).toBeNull();
    expect(buildFaqEntity(el('span', ''), el('div', 'Answer'))).toBeNull();
    expect(buildFaqEntity(el('span', 'Question'), el('div', ''))).toBeNull();
  });
});

describe('registerBreadcrumb', () => {
  it('emits a 2-level breadcrumb on the homepage', () => {
    setPage({
      pathname: '/',
      title: 'Enterprise Resource Planning (ERP) Software | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/',
    });

    registerBreadcrumb();
    const { '@graph': graph } = getGraph();

    expect(graph).toHaveLength(1);
    const [breadcrumb] = graph;
    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement).toHaveLength(2);
    expect(breadcrumb.itemListElement[1]).toMatchObject({
      name: 'Intuit Enterprise Suite',
      item: 'https://main--intuit-erp--aemsites.aem.live/',
    });
  });

  it('emits a 3-level breadcrumb on a subpage, with the site-name crumb fixed regardless of <title> format', () => {
    // Real title from the source site's /compare/ page — no " | " delimiter at all, unlike the
    // homepage title above. The site-name crumb (position 2) must stay constant either way.
    setPage({
      pathname: '/compare/',
      title: 'Netsuite Competitor and QuickBooks and Sage Accounting Alternative: Intuit Enterprise Suite (IES)',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });

    registerBreadcrumb();
    const { '@graph': graph } = getGraph();
    const [breadcrumb] = graph;

    expect(breadcrumb.itemListElement).toHaveLength(3);
    expect(breadcrumb.itemListElement[1]).toMatchObject({ name: 'Intuit Enterprise Suite' });
    expect(breadcrumb.itemListElement[2]).toMatchObject({
      name: 'Netsuite Competitor and QuickBooks and Sage Accounting Alternative: Intuit Enterprise Suite (IES)',
      item: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });
  });

  it('inserts a category crumb for a nested blog article URL (/blog/<category>/<slug>/)', () => {
    setPage({
      pathname: '/blog/case-study/aprio-intuit-enterprise-suite/',
      title: 'Aprio serves a 45+ entity client with Intuit Enterprise Suite | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/blog/case-study/aprio-intuit-enterprise-suite/',
    });

    registerBreadcrumb();
    const { '@graph': graph } = getGraph();
    const [breadcrumb] = graph;

    expect(breadcrumb.itemListElement).toHaveLength(4);
    expect(breadcrumb.itemListElement[2]).toMatchObject({
      position: 3,
      name: 'Case Study',
      item: 'https://main--intuit-erp--aemsites.aem.live/blog/case-study/',
    });
    expect(breadcrumb.itemListElement[3]).toMatchObject({
      position: 4,
      name: 'Aprio serves a 45+ entity client with Intuit Enterprise Suite | Intuit Enterprise Suite',
    });
  });

  it('does not add a category crumb for the flat /blog/ index itself', () => {
    setPage({
      pathname: '/blog/',
      title: 'Blog | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/blog/',
    });

    registerBreadcrumb();
    const { '@graph': graph } = getGraph();

    expect(graph[0].itemListElement).toHaveLength(3);
  });

  it('falls back to window.location when no canonical link is present', () => {
    document.title = 'Fallback | Intuit Enterprise Suite';
    window.history.pushState({}, '', '/fallback/');

    registerBreadcrumb();
    const { '@graph': graph } = getGraph();

    expect(graph[0].itemListElement.at(-1).item).toBe(window.location.href);
  });

  it('combines with FAQPage nodes registered independently by a block', () => {
    setPage({
      pathname: '/compare/',
      title: 'Compare | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });

    registerJsonLd({ '@type': 'FAQPage', mainEntity: [buildFaqEntity(el('span', 'Q'), el('div', 'A'))] });
    registerBreadcrumb();

    const { '@graph': graph } = getGraph();
    expect(graph.map((n) => n['@type'])).toEqual(['FAQPage', 'BreadcrumbList']);
  });
});
