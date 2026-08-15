import {
  describe, it, expect, beforeEach,
} from 'vitest';
import buildStructuredData from '../scripts/structured-data.js';

function setPage({ pathname, title, canonical }) {
  window.history.pushState({}, '', pathname);
  document.title = title;
  document.head.querySelectorAll('link[rel="canonical"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'canonical';
  link.href = canonical;
  document.head.append(link);
}

function addFaqItem(question, answer) {
  const main = document.querySelector('main') || document.body.appendChild(document.createElement('main'));
  const block = main.querySelector('.faq') || main.appendChild(Object.assign(document.createElement('div'), { className: 'faq' }));
  const item = document.createElement('div');
  item.className = 'faq-item';
  item.innerHTML = `<div class="faq-question">${question}</div><div class="faq-answer">${answer}</div>`;
  block.append(item);
}

function addOf1FaqItem(question, answer) {
  const main = document.querySelector('main') || document.body.appendChild(document.createElement('main'));
  const list = main.querySelector('.of1-faqx-faq-list') || main.appendChild(Object.assign(document.createElement('div'), { className: 'of1-faqx-faq-list' }));
  const item = document.createElement('details');
  item.className = 'of1-faqx-faq-item';
  item.innerHTML = `<summary>${question}</summary><div class="of1-faqx-faq-answer">${answer}</div>`;
  list.append(item);
}

function getGraph() {
  const script = document.head.querySelector('script[type="application/ld+json"]');
  return JSON.parse(script.textContent);
}

describe('buildStructuredData', () => {
  beforeEach(() => {
    document.head.querySelectorAll('script[type="application/ld+json"], link[rel="canonical"]')
      .forEach((el) => el.remove());
    document.body.innerHTML = '<main></main>';
  });

  it('emits a 2-level breadcrumb on the homepage, with no FAQPage node', () => {
    setPage({
      pathname: '/',
      title: 'Enterprise Resource Planning (ERP) Software | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/',
    });

    buildStructuredData();
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

    buildStructuredData();
    const { '@graph': graph } = getGraph();
    const [breadcrumb] = graph;

    expect(breadcrumb.itemListElement).toHaveLength(3);
    expect(breadcrumb.itemListElement[1]).toMatchObject({ name: 'Intuit Enterprise Suite' });
    expect(breadcrumb.itemListElement[2]).toMatchObject({
      name: 'Netsuite Competitor and QuickBooks and Sage Accounting Alternative: Intuit Enterprise Suite (IES)',
      item: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });
  });

  it('adds a FAQPage node built from .faq-item content when present', () => {
    setPage({
      pathname: '/compare/',
      title: 'Compare | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });
    addFaqItem('How easy is it to migrate?', 'Very easy.');
    addFaqItem('Is support available?', 'Yes, 24/7.');

    buildStructuredData();
    const { '@graph': graph } = getGraph();
    const faq = graph.find((n) => n['@type'] === 'FAQPage');

    expect(faq).toBeDefined();
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'How easy is it to migrate?',
      acceptedAnswer: { '@type': 'Answer', text: 'Very easy.' },
    });
  });

  it('inserts word breaks between block-level elements in a rich-HTML answer', () => {
    setPage({
      pathname: '/compare/',
      title: 'Compare | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });
    addFaqItem(
      'Who is it for?',
      '<p>Intuit Enterprise Suite is ideal for:</p><ul><li>Item one.</li><li>Item two.</li></ul><p>Closing sentence.</p>',
    );

    buildStructuredData();
    const { '@graph': graph } = getGraph();
    const faq = graph.find((n) => n['@type'] === 'FAQPage');

    expect(faq.mainEntity[0].acceptedAnswer.text)
      .toBe('Intuit Enterprise Suite is ideal for: Item one. Item two. Closing sentence.');
  });

  it('adds a FAQPage node built from the of1-deep-dive-faq-explainer template markup', () => {
    setPage({
      pathname: '/deep-dive/',
      title: 'Is Intuit Enterprise Suite an ERP? | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/deep-dive/',
    });
    addOf1FaqItem('What size company is it built for?', 'Growing multi-entity businesses.');

    buildStructuredData();
    const { '@graph': graph } = getGraph();
    const faq = graph.find((n) => n['@type'] === 'FAQPage');

    expect(faq).toBeDefined();
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'What size company is it built for?',
      acceptedAnswer: { '@type': 'Answer', text: 'Growing multi-entity businesses.' },
    });
  });

  it('skips FAQ items missing a question or answer', () => {
    setPage({
      pathname: '/compare/',
      title: 'Compare | Intuit Enterprise Suite',
      canonical: 'https://main--intuit-erp--aemsites.aem.live/compare/',
    });
    addFaqItem('', 'Answer with no question');

    buildStructuredData();
    const { '@graph': graph } = getGraph();

    expect(graph.find((n) => n['@type'] === 'FAQPage')).toBeUndefined();
  });

  it('falls back to window.location when no canonical link is present', () => {
    document.title = 'Fallback | Intuit Enterprise Suite';
    window.history.pushState({}, '', '/fallback/');

    buildStructuredData();
    const { '@graph': graph } = getGraph();

    expect(graph[0].itemListElement.at(-1).item).toBe(window.location.href);
  });
});
