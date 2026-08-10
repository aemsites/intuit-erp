import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handleDe } from '../src/api/de.js';

const BATCH_URL = env.DECISION_ENGINE_BATCH_URL;
const DE_ENV = { ...env, PZN_API_KEY: 'test-pzn-key' };
const jsonHeaders = { 'content-type': 'application/json' };

// Batch response keyed <experience>_<placement>_<locale>; placement echoed in the entry.
function batchResponse(placement, pznblock) {
  return {
    [`marketing_${placement}_en_US`]: {
      data: { recommendations: { recommendation: [{ copyData: { pznblock } }] } },
      placement,
      experience: 'marketing',
      status: 200,
    },
  };
}

function mockBatch(response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === BATCH_URL) return new Response(JSON.stringify(response), { status: 200, headers: jsonHeaders });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function deReq(body, headers = {}) {
  return new Request('https://aem-erp.intuit.com/api/de', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('handleDe', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a normalized decision for a personalized slot (lowercased placement)', async () => {
    mockBatch(batchResponse('mktgplacement', 'fragments/pzn/hospitality'));
    const res = await handleDe(deReq({ slots: [{ placement: 'mktgplacement' }], path: '/p' }, { cookie: 'ivid=abc' }), DE_ENV);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual([
      { placement: 'mktgplacement', action: 'replace', fidelity: 'block', fragment: 'fragments/pzn/hospitality' },
    ]);
  });

  it('matches case-insensitively when the response echoes a different case', async () => {
    mockBatch(batchResponse('MktgPlacement', 'fragments/pzn/x'));
    const res = await handleDe(deReq({ slots: [{ placement: 'mktgplacement' }] }, { cookie: 'ivid=abc' }), DE_ENV);
    expect((await res.json())[0].fragment).toBe('fragments/pzn/x');
  });

  it('returns [] when there is no ivid (no batch call)', async () => {
    const spy = mockBatch(batchResponse('mktgplacement', 'f'));
    const res = await handleDe(deReq({ slots: [{ placement: 'mktgplacement' }] }), DE_ENV);
    expect(await res.json()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns [] when no slots are supplied', async () => {
    const res = await handleDe(deReq({ slots: [] }, { cookie: 'ivid=abc' }), DE_ENV);
    expect(await res.json()).toEqual([]);
  });
});
