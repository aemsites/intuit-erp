import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

// blocks/of1/of1.js imports decorateMain from scripts/scripts.js, which runs the real page-load
// pipeline (network calls, timers, martech) as a module-scope side effect — not something a unit
// test should trigger. Stub it out; decorateAndLoad only needs loadSections (from aem.js, safe)
// and its own registerFaqEntities scan, neither of which depends on decorateMain's real behavior.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

function getGraph() {
  const script = document.head.querySelector('script[type="application/ld+json"]');
  return script && JSON.parse(script.textContent);
}

let decorateAndLoad;

beforeEach(async () => {
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
  vi.resetModules();
  ({ decorateAndLoad } = await import('../blocks/of1/of1.js'));
});

describe('of1 decorateAndLoad', () => {
  it('registers a FAQPage node from of1-deep-dive-faq-explainer FAQ markup', async () => {
    const sectionHtml = `
      <div class="of1-faqx-faq-list">
        <details class="of1-faqx-faq-item">
          <summary>What size company is it built for?</summary>
          <div class="of1-faqx-faq-answer">Growing multi-entity businesses.</div>
        </details>
        <details class="of1-faqx-faq-item">
          <summary>Is support available?</summary>
          <div class="of1-faqx-faq-answer"><p>Yes, 24/7.</p></div>
        </details>
      </div>
    `;

    await decorateAndLoad(sectionHtml);

    const { '@graph': graph } = getGraph();
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'What size company is it built for?',
      acceptedAnswer: { '@type': 'Answer', text: 'Growing multi-entity businesses.' },
    });
    expect(faq.mainEntity[1].acceptedAnswer.text).toBe('Yes, 24/7.');
  });

  it('registers nothing for sections without of1-faqx-faq-item markup', async () => {
    await decorateAndLoad('<div class="of1-faqx-hero"><h1>Hello</h1></div>');
    expect(getGraph()).toBeNull();
  });
});
