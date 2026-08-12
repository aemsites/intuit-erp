import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handleManifest } from '../src/api/manifest.js';

const BATCH_URL = env.DECISION_ENGINE_BATCH_URL;
// Pin the mock off for the real-batch (stubbed fetch) tests; wrangler.jsonc sets
// DE_MOCK=enabled for the live demo, which the test env would otherwise inherit.
const DE_ENV = { ...env, PZN_API_KEY: 'test-pzn-key', DE_MOCK: 'disabled' };
const jsonHeaders = { 'content-type': 'application/json' };
const PAGE = '/drafts/pzn-demo';
const PLACEMENT = 'SBSEGQBMContentAemPznIxpTest';

// Batch response keyed <experience>_<placement>_<locale>; placement echoed in the entry.
function batchResponse(pznblock, { placement = PLACEMENT, status = 200 } = {}) {
  return {
    [`marketing_${placement}_en_US`]: {
      data: { recommendations: { recommendation: [{ copyData: { pznblock } }] } },
      placement,
      experience: 'marketing',
      status,
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

function manifestReq(headers = {}) {
  return new Request('https://aem-erp.intuit.com/api/pzn-manifest.json', { method: 'GET', headers });
}

describe('handleManifest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns an aem-experimentation Audience Manifest for a personalized slot', async () => {
    mockBatch(batchResponse('fragments/pzn/slot1-hospitality'));
    const res = await handleManifest(
      manifestReq({ referer: `https://aem-erp.intuit.com${PAGE}`, cookie: 'ivid=abc' }),
      DE_ENV,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      data: [{
        page: PAGE,
        audience: 'remote',
        selector: '.slot-1',
        url: '/fragments/pzn/slot1-hospitality',
      }],
    });
  });

  it('derives the page from ?path= when there is no Referer', async () => {
    mockBatch(batchResponse('fragments/pzn/slot1-hospitality'));
    const req = new Request(`https://aem-erp.intuit.com/api/pzn-manifest.json?path=${PAGE}`, {
      method: 'GET',
      headers: { cookie: 'ivid=abc' },
    });
    const res = await handleManifest(req, DE_ENV);
    expect((await res.json()).data[0].selector).toBe('.slot-1');
  });

  it('returns empty data (no batch call) when there is no ivid', async () => {
    const spy = mockBatch(batchResponse('f'));
    const res = await handleManifest(manifestReq({ referer: `https://aem-erp.intuit.com${PAGE}` }), DE_ENV);
    expect(await res.json()).toEqual({ data: [] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns empty data (no batch call) for a page with no client DE route', async () => {
    const spy = mockBatch(batchResponse('f'));
    const res = await handleManifest(
      manifestReq({ referer: 'https://aem-erp.intuit.com/not-enrolled', cookie: 'ivid=abc' }),
      DE_ENV,
    );
    expect(await res.json()).toEqual({ data: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('omits slots with no personalized recommendation (non-200 status)', async () => {
    mockBatch(batchResponse('f', { status: 204 }));
    const res = await handleManifest(
      manifestReq({ referer: `https://aem-erp.intuit.com${PAGE}`, cookie: 'ivid=abc' }),
      DE_ENV,
    );
    expect(await res.json()).toEqual({ data: [] });
  });

  it('uses the in-worker DE mock when DE_MOCK=enabled (no network call)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await handleManifest(
      manifestReq({ referer: `https://aem-erp.intuit.com${PAGE}`, cookie: 'ivid=abc' }),
      { ...DE_ENV, DE_MOCK: 'enabled' },
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ page: PAGE, audience: 'remote', selector: '.slot-1' });
    expect(body.data[0].url).toMatch(/^\/drafts\/pzn-demo\/offer-/);
    expect(spy).not.toHaveBeenCalled();
  });
});
