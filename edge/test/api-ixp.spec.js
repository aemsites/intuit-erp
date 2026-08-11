import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handleIxp } from '../src/api/ixp.js';

const IXP_URL = env.IXP_ASSIGNMENT_URL;
const IXP_ENV = { ...env, IXP_API_KEY: 'test-ixp-key' };
const jsonHeaders = { 'content-type': 'application/json' };
const VARIATION_KEY = 'intuit.com.integration.variation.html';

function mockAssign(assignments) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(IXP_URL)) {
      return new Response(JSON.stringify({ ivid: 'abc', assignments }), { status: 200, headers: jsonHeaders });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function ixpReq(query, headers = {}) {
  return new Request(`https://aem-erp.intuit.com/api/ixp?${query}`, { headers });
}

describe('handleIxp', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a REDIRECT assignment to a page-level fragment decision', async () => {
    mockAssign([{
      experimentId: 385944,
      experimentType: 'REDIRECT',
      control: false,
      payload: JSON.stringify({ [VARIATION_KEY]: '/drafts/pzn/csr-variation' }),
      assetLocation: null,
    }]);
    const res = await handleIxp(ixpReq('experimentId=385944', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(await res.json()).toEqual({
      action: 'replace',
      fidelity: 'page',
      fragment: '/drafts/pzn/csr-variation',
    });
  });

  it('returns { control: true } on a control arm', async () => {
    mockAssign([{
      experimentId: 385944,
      experimentType: 'REDIRECT',
      control: true,
      payload: '',
      assetLocation: null,
    }]);
    const res = await handleIxp(ixpReq('experimentId=385944', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(await res.json()).toEqual({ control: true });
  });

  it('returns { control: true } with no ivid (no assignment call)', async () => {
    const spy = mockAssign([]);
    const res = await handleIxp(ixpReq('experimentId=385944'), IXP_ENV);
    expect(await res.json()).toEqual({ control: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns { control: true } when neither experimentId nor label is given', async () => {
    const res = await handleIxp(ixpReq('', { cookie: 'ivid=abc' }), IXP_ENV);
    expect(await res.json()).toEqual({ control: true });
  });
});
