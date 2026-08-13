import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handlePzn } from '../src/api/pzn.js';

const BATCH_URL = env.PERSONALIZATION_BATCH_URL;
const PZN_ENV = { ...env, PZN_API_KEY: 'test-pzn-key' };
const jsonHeaders = { 'content-type': 'application/json' };

// Batch response keyed <experience>_<placement>_<locale>; placement echoed in the entry.
// Mirrors the real shape: data.recommendations is an array on status 200.
function batchResponse(placement, contentId) {
  return {
    [`marketing_${placement}_en_US`]: {
      data: { recommendations: [{ id: 'rec-1', copyData: { contentId }, accessPoint: placement }] },
      placement,
      experience: 'marketing',
      status: 200,
    },
  };
}

function mockBatch(response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === BATCH_URL) {
      return new Response(JSON.stringify(response), { status: 200, headers: jsonHeaders });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function pznReq(body, headers = {}) {
  return new Request('https://aem-erp.intuit.com/api/pzn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('handlePzn (verbatim passthrough)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the raw batch response as-is for a personalized slot', async () => {
    const response = batchResponse('mktgplacement', 'c1mX51ufI');
    mockBatch(response);
    const res = await handlePzn(pznReq({ slots: [{ placement: 'mktgplacement' }], path: '/p' }, { cookie: 'ivid=abc' }), PZN_ENV);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(response);
  });

  it('returns {} when there is no ivid (no batch call)', async () => {
    const spy = mockBatch(batchResponse('mktgplacement', 'c'));
    const res = await handlePzn(pznReq({ slots: [{ placement: 'mktgplacement' }] }), PZN_ENV);
    expect(await res.json()).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns {} when no slots are supplied', async () => {
    const res = await handlePzn(pznReq({ slots: [] }, { cookie: 'ivid=abc' }), PZN_ENV);
    expect(await res.json()).toEqual({});
  });

  it('returns {} on an upstream failure (non-2xx)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await handlePzn(pznReq({ slots: [{ placement: 'x' }] }, { cookie: 'ivid=abc' }), PZN_ENV);
    expect(await res.json()).toEqual({});
  });
});
