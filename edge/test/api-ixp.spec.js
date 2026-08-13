import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handleIxp } from '../src/api/ixp.js';

const IXP_URL = env.IXP_ASSIGNMENT_URL;
const IXP_ENV = { ...env, IXP_API_KEY: 'test-ixp-key' };
const jsonHeaders = { 'content-type': 'application/json' };
const VARIATION_KEY = 'intuit.com.integration.variation.html';

function mockAssign(body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(IXP_URL)) {
      return new Response(JSON.stringify(body), { status: 200, headers: jsonHeaders });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function ixpReq(query, headers = {}) {
  return new Request(`https://aem-erp.intuit.com/api/ixp?${query}`, { headers });
}

describe('handleIxp (verbatim passthrough)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the raw assignment response as-is', async () => {
    const body = {
      ivid: 'abc',
      transactionId: 'tx-1',
      assignments: [{
        experimentId: 385944,
        experimentVersion: 7,
        id: 39927,
        experimentType: 'REDIRECT',
        control: false,
        payload: JSON.stringify({ [VARIATION_KEY]: '/drafts/pzn/csr-variation' }),
        assetLocation: null,
      }],
    };
    mockAssign(body);
    const res = await handleIxp(ixpReq('experimentId=385944', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(body);
  });

  it('returns { assignments: [] } with no ivid (no assignment call)', async () => {
    const spy = mockAssign({ ivid: 'abc', assignments: [] });
    const res = await handleIxp(ixpReq('experimentId=385944'), IXP_ENV);
    expect(await res.json()).toEqual({ assignments: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns { assignments: [] } when neither experimentId nor label is given', async () => {
    const res = await handleIxp(ixpReq('', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(await res.json()).toEqual({ assignments: [] });
  });

  it('returns { assignments: [] } on an upstream failure (non-2xx)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await handleIxp(ixpReq('experimentId=385944', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(await res.json()).toEqual({ assignments: [] });
  });
});
