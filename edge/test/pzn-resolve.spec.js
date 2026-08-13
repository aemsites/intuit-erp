import { describe, it, expect } from 'vitest';
import { buildBatchRequest } from '../src/pzn/batch-client.js';
import { buildAttributes, entryForSlot, slotEntryToPznEntry } from '../src/pzn/resolve.js';

const PLACEMENT = 'SBSEGQBMContentAemPznIxpTest';
const EXPERIENCE = 'marketing';

function deRequest(path, init) {
  return new Request(`https://worker.example.com${path}`, init);
}

describe('buildBatchRequest', () => {
  it('emits one batchItem per slot (numberOfRecommendations 1, metadata true) + attributes', () => {
    const slots = [{ location: 'slot-1', placement: PLACEMENT, experience: EXPERIENCE }];
    const req = buildBatchRequest(slots, { ivid: 'abc', locale: 'en-US' });
    expect(req.batchItems).toEqual([
      {
        placement: PLACEMENT,
        experience: EXPERIENCE,
        numberOfRecommendations: 1,
        recommendationMetadata: true,
      },
    ]);
    expect(req.attributes).toEqual({ ivid: 'abc', locale: 'en-US' });
  });
});

describe('buildAttributes', () => {
  it('builds the shared attributes from the request, ivid, and permalink', () => {
    const attrs = buildAttributes(
      deRequest('/drafts/pzn/treatment', { headers: { 'accept-language': 'en-US,en;q=0.9' } }),
      'abc',
      '/drafts/pzn/treatment',
    );
    expect(attrs).toMatchObject({
      ivid: 'abc',
      permalink: '/drafts/pzn/treatment',
      locale: 'en-US',
      deviceType: 'Desktop',
      newVisitor: true,
    });
  });

  it('detects a mobile device from the user-agent', () => {
    const attrs = buildAttributes(
      deRequest('/x', { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' } }),
      'abc',
      '/x',
    );
    expect(attrs.deviceType).toBe('Mobile');
  });

  it('lets a ?locale= query param override the Accept-Language locale', () => {
    const attrs = buildAttributes(
      deRequest('/x?locale=en-US', { headers: { 'accept-language': 'en-GB' } }),
      'abc',
      '/x',
    );
    expect(attrs.locale).toBe('en-US');
  });

  it('carries the client IP when present', () => {
    const attrs = buildAttributes(
      deRequest('/x', { headers: { 'cf-connecting-ip': '203.0.113.7' } }),
      'abc',
      '/x',
    );
    expect(attrs.ipAddress).toBe('203.0.113.7');
  });
});

describe('entryForSlot (case-insensitive placement match)', () => {
  it('matches when the response placement differs only in case', () => {
    const response = { k: { placement: PLACEMENT, status: 200 } };
    const hit = entryForSlot(response, { placement: PLACEMENT.toLowerCase() });
    expect(hit).toEqual({ placement: PLACEMENT, status: 200 });
  });

  it('returns null when no placement matches', () => {
    expect(entryForSlot({ k: { placement: 'other' } }, { placement: 'nope' })).toBeNull();
  });
});

describe('slotEntryToPznEntry', () => {
  const slot = { location: 'slot-1', placement: PLACEMENT, experience: EXPERIENCE };

  function responseEntry(pznblock, status = 200) {
    return {
      placement: PLACEMENT,
      status,
      data: { recommendations: { recommendation: [{ copyData: { pznblock } }] } },
    };
  }

  it('maps a 200 recommendation to a block-replace entry', () => {
    const entry = slotEntryToPznEntry(responseEntry('fragments/pzn/slot1-hospitality'), slot, '/drafts/pzn/treatment');
    expect(entry).toEqual({
      path: '/drafts/pzn/treatment',
      fragment: 'fragments/pzn/slot1-hospitality',
      location: 'slot-1',
      action: 'replace',
      fidelity: 'block',
    });
  });

  it('returns null on a non-200 status', () => {
    expect(slotEntryToPznEntry(responseEntry('x', 204), slot, '/x')).toBeNull();
  });

  it('returns null when the fragment (pznblock) is missing', () => {
    expect(slotEntryToPznEntry(responseEntry(undefined), slot, '/x')).toBeNull();
  });

  it('returns null for a null response entry', () => {
    expect(slotEntryToPznEntry(null, slot, '/x')).toBeNull();
  });
});
