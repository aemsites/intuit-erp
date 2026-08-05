import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';

const IncomingRequest = Request;

const MAP_URL = env.PZN_MAP_URL;

/** An origin page with two authored slots: a block slot and a section slot. */
const PAGE_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<header></header>
<main>
  <div>
    <div class="hero"><div>Hero</div></div>
  </div>
  <div>
    <div class="slot-1"><div>OLD BLOCK</div></div>
  </div>
  <div>
    <div class="slot-2"><div>SECTION CONTENT</div></div>
  </div>
</main>
<footer></footer>
</body></html>`;

const OFFER_HTML = `<div>
  <div class="offer"><div>NEW OFFER</div></div>
</div>`;

const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };

/** Routes mocked fetches by URL: map, fragment, or origin page. */
function mockOrigin(map, page = PAGE_HTML, offer = OFFER_HTML) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl === MAP_URL) {
      return new Response(JSON.stringify(map), { status: 200, headers: htmlHeaders });
    }
    if (reqUrl.includes('/fragments/pzn/')) {
      return offer === null
        ? new Response('not found', { status: 404 })
        : new Response(offer, { status: 200, headers: htmlHeaders });
    }
    return new Response(page, { status: 200, headers: htmlHeaders });
  });
}

async function run(path) {
  const request = new IncomingRequest(`https://worker.example.com${path}`);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('intuit-edge personalization proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes non-matching paths through byte-identical', async () => {
    mockOrigin({
      data: [{
        path: '/', fragment: '/fragments/pzn/x', location: 'slot-1', action: 'replace', fidelity: 'block',
      }],
    });
    const res = await run('/not-personalized');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE_HTML);
  });

  it('replaces a block targeted by slot id (fidelity=block, action=replace)', async () => {
    mockOrigin({
      data: [{
        path: '/', fragment: '/fragments/pzn/automation', location: 'slot-1', action: 'replace', fidelity: 'block',
      }],
    });
    const html = await (await run('/')).text();
    expect(html).not.toContain('OLD BLOCK');
    expect(html).toContain('class="offer"');
    expect(html).toContain('NEW OFFER');
    // other slots untouched
    expect(html).toContain('SECTION CONTENT');
    expect(html).toContain('class="hero"');
  });

  it('inserts below the enclosing section (fidelity=section, action=below)', async () => {
    mockOrigin({
      data: [{
        path: '/construction', fragment: '/fragments/pzn/automation', location: 'slot-2', action: 'below', fidelity: 'section',
      }],
    });
    const html = await (await run('/construction')).text();
    // original section content is kept, offer inserted after it
    expect(html).toContain('SECTION CONTENT');
    expect(html).toContain('NEW OFFER');
    expect(html.indexOf('SECTION CONTENT')).toBeLessThan(html.indexOf('NEW OFFER'));
  });

  it('inserts above a slot (action=above)', async () => {
    mockOrigin({
      data: [{
        path: '/', fragment: '/fragments/pzn/automation', location: 'slot-1', action: 'above', fidelity: 'block',
      }],
    });
    const html = await (await run('/')).text();
    expect(html).toContain('OLD BLOCK'); // block preserved
    expect(html).toContain('NEW OFFER');
    expect(html.indexOf('NEW OFFER')).toBeLessThan(html.indexOf('OLD BLOCK'));
  });

  it('passes through untouched when the offer fragment cannot be fetched', async () => {
    mockOrigin({
      data: [{
        path: '/', fragment: '/fragments/pzn/missing', location: 'slot-1', action: 'replace', fidelity: 'block',
      }],
    }, PAGE_HTML, null);
    const html = await (await run('/')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through untouched when the slot is absent from the page', async () => {
    mockOrigin({
      data: [{
        path: '/', fragment: '/fragments/pzn/automation', location: 'slot-404', action: 'replace', fidelity: 'block',
      }],
    });
    const html = await (await run('/')).text();
    expect(html).toBe(PAGE_HTML);
  });
});

// --- aem.live proxy behaviors -----------------------------------------------

describe('aem.live proxy behaviors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves the in-worker IXP assignment route', async () => {
    const auth = 'Intuit_APIKey intuit_apikey=dev-ixp-key, intuit_apikey_version=1.0';
    const request = new IncomingRequest(
      'https://worker.example.com/us/v2/assignment?ivid=d3878e74-ba78-4e1d-afea-3be26957721a&experimentId=15972',
      { headers: { Authorization: auth } },
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).assignments).toHaveLength(1);
  });

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

  it('merges the offer fragment cache keys into the personalized response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      if (reqUrl === MAP_URL) {
        const row = {
          path: '/', fragment: '/fragments/pzn/automation', location: 'slot-1', action: 'replace', fidelity: 'block',
        };
        return new Response(JSON.stringify({ data: [row] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (reqUrl.includes('/fragments/pzn/')) {
        return new Response(OFFER_HTML, { status: 200, headers: { ...htmlHeaders, 'surrogate-key': 'frag-key', 'cache-tag': 'frag-tag' } });
      }
      return new Response(PAGE_HTML, { status: 200, headers: { ...htmlHeaders, 'surrogate-key': 'page-key', 'cache-tag': 'page-tag' } });
    });
    const res = await run('/');
    expect(res.headers.get('surrogate-key').split(' ').sort()).toEqual(['frag-key', 'page-key']);
    expect(res.headers.get('cache-tag').split(',').sort()).toEqual(['frag-tag', 'page-tag']);
  });
});
