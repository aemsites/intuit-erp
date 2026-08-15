import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

function makeBlock(rows) {
  const block = document.createElement('div');
  block.className = 'faq block';
  rows.forEach(([question, answer]) => {
    const row = document.createElement('div');
    const q = document.createElement('div');
    q.innerHTML = question;
    const a = document.createElement('div');
    a.innerHTML = answer;
    row.append(q, a);
    block.append(row);
  });
  return block;
}

function getGraph() {
  const script = document.head.querySelector('script[type="application/ld+json"]');
  return script && JSON.parse(script.textContent);
}

let decorate;

beforeEach(async () => {
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
  vi.resetModules();
  ({ default: decorate } = await import('../blocks/faq/faq.js'));
});

describe('faq block', () => {
  it('decorates the accordion and registers a matching FAQPage JSON-LD node', () => {
    const block = makeBlock([
      ['How easy is it to migrate?', 'Very easy.'],
      ['Is support available?', '<p>Yes, 24/7.</p>'],
    ]);

    decorate(block);

    // visual decoration still works
    expect(block.querySelectorAll('.faq-item')).toHaveLength(2);
    expect(block.querySelector('.faq-question').textContent).toBe('How easy is it to migrate?');

    // and the same content made it into the registered FAQPage node
    const { '@graph': graph } = getGraph();
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'How easy is it to migrate?',
      acceptedAnswer: { '@type': 'Answer', text: 'Very easy.' },
    });
    expect(faq.mainEntity[1].acceptedAnswer.text).toBe('Yes, 24/7.');
  });

  it('registers nothing when the block has no rows', () => {
    const block = makeBlock([]);
    decorate(block);
    expect(getGraph()).toBeNull();
  });
});
