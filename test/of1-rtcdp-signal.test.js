import { describe, it, expect } from 'vitest';
import { buildOf1SignalXdm, OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';

const page = { url: 'https://x.aem.page/construction', name: 'construction' };

describe('buildOf1SignalXdm', () => {
  it('maps interests, intent, and pages under the tenant-namespaced object', () => {
    const xdm = buildOf1SignalXdm({
      interests: [{ topic: 'job costing', score: 82 }, { topic: 'construction', score: 70 }],
      intentProfile: { type: 'research', journeyStage: 'consideration' },
      pageVisits: ['/construction', '/blog/construction-case-study'],
    }, page);

    expect(xdm.eventType).toBe('web.webpagedetails.pageViews');
    expect(xdm.web.webPageDetails.URL).toBe(page.url);
    expect(xdm.web.webPageDetails.name).toBe(page.name);

    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([
      { topic: 'job costing', score: 82 },
      { topic: 'construction', score: 70 },
    ]);
    expect(obj.intent).toEqual({ type: 'research', journeyStage: 'consideration' });
    expect(obj.pagesViewed).toEqual(['/construction', '/blog/construction-case-study']);
    expect(typeof obj.capturedAt).toBe('string');
  });

  it('tolerates an empty/partial profile without throwing', () => {
    const xdm = buildOf1SignalXdm({}, page);
    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([]);
    expect(obj.intent).toBeNull();
    expect(obj.pagesViewed).toEqual([]);
  });
});
