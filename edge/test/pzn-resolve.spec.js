import { describe, it, expect } from 'vitest';
import { buildBatchRequest } from '../src/pzn/batch-client.js';
import { buildAttributes } from '../src/pzn/resolve.js';

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
