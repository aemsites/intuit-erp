import { describe, it, expect } from 'vitest';
import { mockBatch } from '../src/de/mock.js';

const SLOTS = [{ location: 'slot-1', placement: 'SBSEGQBMContentAemPznIxpTest', experience: 'marketing' }];

function offerFor(ivid) {
  const resp = mockBatch({ slots: SLOTS, attributes: { ivid, locale: 'en-US' } });
  return Object.values(resp)[0].data.recommendations.recommendation[0].copyData.pznblock;
}

describe('mockBatch (in-worker Decision Engine mock)', () => {
  it('returns one status:200 recommendation per slot, keyed <experience>_<placement>_<locale>', () => {
    const resp = mockBatch({ slots: SLOTS, attributes: { ivid: 'v1', locale: 'en-US' } });
    expect(Object.keys(resp)).toEqual(['marketing_SBSEGQBMContentAemPznIxpTest_en_US']);
    const entry = resp.marketing_SBSEGQBMContentAemPznIxpTest_en_US;
    expect(entry.status).toBe(200);
    expect(entry.placement).toBe('SBSEGQBMContentAemPznIxpTest');
    expect(entry.data.recommendations.recommendation[0].copyData.pznblock).toMatch(/^drafts\/pzn-demo\/offer-/);
  });

  it('is sticky per ivid', () => {
    expect(offerFor('visitor-42')).toBe(offerFor('visitor-42'));
  });

  it('varies the offer across visitors (all three firmographic segments appear)', () => {
    const segments = new Set(Array.from({ length: 30 }, (_, i) => offerFor(`v${i}`)));
    expect(segments.has('drafts/pzn-demo/offer-hospitality')).toBe(true);
    expect(segments.has('drafts/pzn-demo/offer-construction')).toBe(true);
    expect(segments.has('drafts/pzn-demo/offer-retail')).toBe(true);
  });
});
