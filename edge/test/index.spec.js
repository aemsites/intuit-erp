import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';

const IncomingRequest = Request;

// The real pzn placement + experience the treatment page is enrolled in
// (see src/de/routes.js), keyed the way the batch service keys its response.
const PLACEMENT = 'SBSEGQBMContentAemPznIxpTest';
const EXPERIENCE = 'marketing';
const BATCH_URL = env.DECISION_ENGINE_BATCH_URL;
// PZN_API_KEY is a Wrangler secret, absent from the test env; supply it so the
// batch client actually fires (the default source is `de`).
const DE_ENV = { ...env, PZN_API_KEY: 'test-pzn-key' };

/** The DE-enrolled page with an authored slot the batch recommendation fills. */
const PAGE_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<header></header>
<main>
  <div>
    <div class="hero"><div>Hero</div></div>
  </div>
  <div>
    <div class="slot-1"><div>OLD BLOCK</div></div>
  </div>
</main>
<footer></footer>
</body></html>`;

const OFFER_HTML = `<div>
  <div class="offer"><div>NEW OFFER</div></div>
</div>`;

const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
const jsonHeaders = { 'content-type': 'application/json' };

/**
 * One batch response, keyed as the pzn service keys it
 * (`<experience>_<placement>_<locale>`). A 200 carries a recommendation whose
 * `copyData.pznblock` is the fragment to inject; a non-200 status means "no
 * personalized recommendation for this slot" (leave it as authored).
 */
function batchResponse(pznblock, status = 200) {
  const key = `${EXPERIENCE}_${PLACEMENT}_en_US`;
  const entry = status === 200
    ? {
      data: { recommendations: { recommendation: [{ copyData: { pznblock } }] } },
      placement: PLACEMENT,
      experience: EXPERIENCE,
      status: 200,
    }
    : {
      data: { recommendations: { fallback: true } },
      placement: PLACEMENT,
      experience: EXPERIENCE,
      status,
    };
  return { [key]: entry };
}

/**
 * Routes mocked fetches: the batch POST returns `batch`, the offer fragment
 * returns `offer` (null → 404), anything else returns the origin `page`.
 */
function mockDe(batch, page = PAGE_HTML, offer = OFFER_HTML) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl === BATCH_URL) {
      return new Response(JSON.stringify(batch), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/fragments/pzn/')) {
      return offer === null
        ? new Response('not found', { status: 404 })
        : new Response(offer, { status: 200, headers: htmlHeaders });
    }
    return new Response(page, { status: 200, headers: htmlHeaders });
  });
}

async function run(path, headers) {
  const request = new IncomingRequest(`https://worker.example.com${path}`, { headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, DE_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('intuit-edge personalization proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes non-enrolled paths through byte-identical (no batch call)', async () => {
    const spy = mockDe(batchResponse('fragments/pzn/automation'));
    const res = await run('/not-personalized?ivid=abc');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE_HTML);
    // An unenrolled path resolves to [] before any network call.
    const calledBatch = spy.mock.calls.some(([i]) => (typeof i === 'string' ? i : i.url) === BATCH_URL);
    expect(calledBatch).toBe(false);
  });

  it('forces no-store while push invalidation is disabled', async () => {
    // env.PUSH_INVALIDATION is "disabled" in wrangler.jsonc, so the worker must
    // not let a CDN cache output it cannot purge on publish.
    mockDe(batchResponse('fragments/pzn/automation'));
    const res = await run('/not-personalized');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('cdn-cache-control')).toBe('no-store');
  });

  it('replaces the enrolled slot from the batch recommendation', async () => {
    mockDe(batchResponse('fragments/pzn/automation'));
    const html = await (await run('/drafts/pzn/treatment?ivid=abc')).text();
    expect(html).not.toContain('OLD BLOCK');
    expect(html).toContain('class="offer"');
    expect(html).toContain('NEW OFFER');
    // other slots untouched
    expect(html).toContain('class="hero"');
  });

  it('sends the site-auth token to the origin page and the offer fragment', async () => {
    const spy = mockDe(batchResponse('fragments/pzn/automation'));
    const authEnv = { ...DE_ENV, ORIGIN_AUTHENTICATION: 'hlx_site_token' };
    const request = new IncomingRequest('https://worker.example.com/drafts/pzn/treatment?ivid=abc');
    const ctx = createExecutionContext();
    await worker.fetch(request, authEnv, ctx);
    await waitOnExecutionContext(ctx);

    // authorization header, whether fetch was called with a Request (input) or
    // a url string + init ({ headers }).
    const authOf = ([input, init]) => {
      if (typeof input !== 'string') return input.headers.get('authorization');
      const h = new Headers(init?.headers || {});
      return h.get('authorization');
    };
    const originCall = spy.mock.calls.find(([i]) => {
      const u = typeof i === 'string' ? i : i.url;
      return u.startsWith(env.ORIGIN_BASE_URL) && !u.includes('/fragments/pzn/');
    });
    const fragmentCall = spy.mock.calls.find(([i]) => {
      const u = typeof i === 'string' ? i : i.url;
      return u.includes('/fragments/pzn/');
    });
    expect(authOf(originCall)).toBe('token hlx_site_token');
    expect(authOf(fragmentCall)).toBe('token hlx_site_token');
  });

  it('passes through untouched when the offer fragment cannot be fetched', async () => {
    mockDe(batchResponse('fragments/pzn/missing'), PAGE_HTML, null);
    const html = await (await run('/drafts/pzn/treatment?ivid=abc')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through untouched when the enrolled slot is absent from the page', async () => {
    const pageNoSlot = PAGE_HTML.replace('class="slot-1"', 'class="not-the-slot"');
    mockDe(batchResponse('fragments/pzn/automation'), pageNoSlot);
    const html = await (await run('/drafts/pzn/treatment?ivid=abc')).text();
    expect(html).toBe(pageNoSlot);
  });
});

// --- aem.live proxy behaviors -----------------------------------------------

describe('aem.live proxy behaviors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('strips age and x-robots-tag from the response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(PAGE_HTML, {
      status: 200,
      headers: { ...htmlHeaders, age: '12', 'x-robots-tag': 'noindex' },
    }));
    const res = await run('/some-page');
    expect(res.headers.has('age')).toBe(false);
    expect(res.headers.has('x-robots-tag')).toBe(false);
  });

  it('falls back to mhast html-to-json on a .json origin 404', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      if (reqUrl.includes('mhast-html-to-json')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    const res = await run('/missing/page.json');
    expect(res.status).toBe(200);
    expect(seen.some((u) => u.includes('mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp/missing/page'))).toBe(true);
  });

  it('normalizes /index.json to the folder path when falling back (EDS index doc)', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      if (reqUrl.includes('mhast-html-to-json')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    await run('/index.json');
    await run('/blog/index.json');
    // /index.json -> the homepage path "/", /blog/index.json -> "/blog/"
    expect(seen).toContain('https://mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp/');
    expect(seen).toContain('https://mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp/blog/');
    // never requests the non-existent /index page
    expect(seen.some((u) => u.endsWith('/aemsites/intuit-erp/index'))).toBe(false);
  });

  it('does not fall back to mhast when the .json origin request succeeds', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const res = await run('/query-index.json');
    expect(res.status).toBe(200);
    expect(seen.some((u) => u.includes('mhast-html-to-json'))).toBe(false);
  });

  it('routes a .json 404 under a STRUCTURED_CONTENT_PATHS prefix to da-sc (not mhast)', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      if (reqUrl.includes('da-sc.adobeaem.workers.dev')) {
        return new Response(JSON.stringify({ metadata: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 }); // origin 404
    });
    const res = await run('/events/intuit-connect-2026.json');
    expect(res.status).toBe(200);
    expect(seen).toContain('https://da-sc.adobeaem.workers.dev/live/aemsites/intuit-erp/events/intuit-connect-2026');
    expect(seen.some((u) => u.includes('mhast-html-to-json'))).toBe(false);
  });

  it('does not use da-sc when an events .json is served by the origin (query-index)', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const res = await run('/events/query-index.json');
    expect(res.status).toBe(200);
    expect(seen.some((u) => u.includes('da-sc'))).toBe(false);
  });

  it('a non-structured .json 404 still falls back to mhast (not da-sc)', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      if (reqUrl.includes('mhast-html-to-json')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    const res = await run('/blog/article.json');
    expect(res.status).toBe(200);
    expect(seen.some((u) => u.includes('da-sc'))).toBe(false);
    expect(seen.some((u) => u.includes('mhast-html-to-json'))).toBe(true);
  });

  it('merges the offer fragment cache keys into the personalized response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      if (reqUrl === BATCH_URL) {
        return new Response(JSON.stringify(batchResponse('fragments/pzn/automation')), { status: 200, headers: jsonHeaders });
      }
      if (reqUrl.includes('/fragments/pzn/')) {
        return new Response(OFFER_HTML, { status: 200, headers: { ...htmlHeaders, 'surrogate-key': 'frag-key', 'cache-tag': 'frag-tag' } });
      }
      return new Response(PAGE_HTML, { status: 200, headers: { ...htmlHeaders, 'surrogate-key': 'page-key', 'cache-tag': 'page-tag' } });
    });
    const res = await run('/drafts/pzn/treatment?ivid=abc');
    expect(res.headers.get('surrogate-key').split(' ').sort()).toEqual(['frag-key', 'page-key']);
    expect(res.headers.get('cache-tag').split(',').sort()).toEqual(['frag-tag', 'page-tag']);
  });
});
