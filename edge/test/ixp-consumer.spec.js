import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';
import { fillTokens } from '../src/pzn.js';
import { assignmentToPznEntry } from '../src/ixp/resolve.js';
import { resolveRoute } from '../src/ixp/routes.js';
import { bucketPercent } from '../src/mock/ixp-fixtures.js';

const IncomingRequest = Request;

const ORIGIN = env.ORIGIN_BASE_URL;
const IXP_URL = 'http://127.0.0.1:8787/us/v2/assignment';
const ROUTE = { experimentId: 39002, location: 'slot-1', fidelity: 'block' };

/** Builds an assignment with only the consumed fields set. */
function assignment(partial) {
  return {
    experimentId: 39002,
    experimentType: 'REPLACE_WEB_CONTENT',
    label: '',
    payload: '',
    assetLocation: null,
    control: false,
    ...partial,
  };
}

describe('assignmentToPznEntry', () => {
  it('maps REDIRECT + payload.variationUrl to a page-level replace', () => {
    const entry = assignmentToPznEntry(
      assignment({
        experimentType: 'REDIRECT',
        payload: JSON.stringify({ sourceUrl: '/x', variationUrl: '/x-variant' }),
      }),
      ROUTE,
      '/x',
    );
    expect(entry).toEqual({
      path: '/x', fragment: '/x-variant', location: 'slot-1', action: 'replace', fidelity: 'page',
    });
  });

  it('maps REPLACE_WEB_CONTENT + assetLocation to a block replace at the route slot', () => {
    const entry = assignmentToPznEntry(
      assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/pzn/automation' }),
      ROUTE,
      '/x',
    );
    expect(entry).toEqual({
      path: '/x',
      fragment: '/fragments/pzn/automation',
      location: 'slot-1',
      action: 'replace',
      fidelity: 'block',
    });
  });

  it('parses a REPLACE_WEB_CONTENT payload into entry.data (scalars only, stringified)', () => {
    const entry = assignmentToPznEntry(
      assignment({
        experimentType: 'REPLACE_WEB_CONTENT',
        assetLocation: '/fragments/pzn/welcome',
        payload: JSON.stringify({
          headline: 'Hello', count: 3, flag: true, nested: { x: 1 },
        }),
      }),
      ROUTE,
      '/x',
    );
    expect(entry?.data).toEqual({ headline: 'Hello', count: '3', flag: 'true' });
  });

  it('returns null for the control arm (baseline)', () => {
    const entry = assignmentToPznEntry(assignment({ control: true }), ROUTE, '/x');
    expect(entry).toBeNull();
  });

  it('returns null for a DEFAULT (no-treatment) type', () => {
    const entry = assignmentToPznEntry(assignment({ experimentType: 'DEFAULT' }), ROUTE, '/x');
    expect(entry).toBeNull();
  });

  it('returns null for REDIRECT without a variationUrl', () => {
    const entry = assignmentToPznEntry(
      assignment({ experimentType: 'REDIRECT', payload: JSON.stringify({ sourceUrl: '/x' }) }),
      ROUTE,
      '/x',
    );
    expect(entry).toBeNull();
  });

  it('returns null for REPLACE_WEB_CONTENT without an assetLocation', () => {
    const entry = assignmentToPznEntry(assignment({ assetLocation: null }), ROUTE, '/x');
    expect(entry).toBeNull();
  });
});

describe('resolveRoute', () => {
  it('resolves an enrolled path', () => {
    expect(resolveRoute('/drafts/suresh/pzn')).toEqual({ experimentId: 39002, location: 'slot-1', fidelity: 'block' });
  });

  it('normalizes a trailing slash', () => {
    expect(resolveRoute('/drafts/suresh/pzn/')).not.toBeNull();
  });

  it('returns null for an unenrolled path', () => {
    expect(resolveRoute('/nope')).toBeNull();
  });
});

// --- end-to-end through the worker in ixp mode ------------------------------

const PAGE_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<main>
  <div>
    <div class="slot-1"><div>OLD BLOCK</div></div>
  </div>
</main>
</body></html>`;

const OFFER_HTML = `<div>
  <div class="offer"><div>NEW OFFER</div></div>
</div>`;

const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
const jsonHeaders = { 'content-type': 'application/json' };

const IXP_ENV = {
  ...env, PZN_SOURCE: 'ixp', IXP_ASSIGNMENT_URL: IXP_URL, IXP_API_KEY: 'dev-ixp-key',
};

/**
 * Routes mocked fetches: the IXP endpoint returns `ixpBody`, the offer fragment
 * returns `offer`, anything else returns the origin page.
 */
function mockIxp(ixpBody, offer = OFFER_HTML) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl.startsWith(IXP_URL)) {
      return new Response(JSON.stringify(ixpBody), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/fragments/pzn/')) {
      return offer === null
        ? new Response('not found', { status: 404 })
        : new Response(offer, { status: 200, headers: htmlHeaders });
    }
    return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
  });
}

async function runWith(envObj, path, headers) {
  const request = new IncomingRequest(`https://worker.example.com${path}`, { headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, envObj, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function run(path, headers) {
  return runWith(IXP_ENV, path, headers);
}

describe('worker in ixp mode', () => {
  afterEach(() => vi.restoreAllMocks());

  const okBody = {
    ivid: 'abc',
    transactionId: 't',
    assignments: [assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/pzn/automation' })],
  };

  it('injects the offer when an assignment resolves (ivid via query)', async () => {
    mockIxp(okBody);
    const html = await (await run('/drafts/suresh/pzn?ivid=abc')).text();
    expect(html).not.toContain('OLD BLOCK');
    expect(html).toContain('NEW OFFER');
  });

  it('reads the ivid from a cookie', async () => {
    mockIxp(okBody);
    const html = await (await run('/drafts/suresh/pzn', { cookie: 'foo=1; ivid=abc' })).text();
    expect(html).toContain('NEW OFFER');
  });

  it('passes through when there is no ivid', async () => {
    mockIxp(okBody);
    const html = await (await run('/drafts/suresh/pzn')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through on an unenrolled path (no IXP call needed)', async () => {
    mockIxp(okBody);
    const html = await (await run('/not-enrolled?ivid=abc')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through when the assignment is the control arm', async () => {
    mockIxp({ ivid: 'abc', transactionId: 't', assignments: [assignment({ control: true })] });
    const html = await (await run('/drafts/suresh/pzn?ivid=abc')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through when IXP returns no assignments', async () => {
    mockIxp({ ivid: 'abc', transactionId: 't', assignments: [] });
    const html = await (await run('/drafts/suresh/pzn?ivid=abc')).text();
    expect(html).toBe(PAGE_HTML);
  });
});

describe('?pzn= source override', () => {
  afterEach(() => vi.restoreAllMocks());

  const okBody = {
    ivid: 'abc',
    transactionId: 't',
    assignments: [assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/pzn/automation' })],
  };

  it('?pzn=ixp forces the IXP flow even when the default is map', async () => {
    mockIxp(okBody); // env default (from wrangler.jsonc) is PZN_SOURCE=map
    const html = await (await runWith(env, '/drafts/suresh/pzn?pzn=ixp&ivid=abc')).text();
    expect(html).toContain('NEW OFFER');
  });

  it('?pzn=map forces the map flow (and never calls IXP) even when the default is ixp', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      if (reqUrl.startsWith(IXP_URL)) throw new Error('IXP must not be called in map mode');
      if (reqUrl === env.PZN_MAP_URL) {
        const row = {
          path: '/drafts/suresh/pzn', fragment: '/fragments/pzn/automation', location: 'slot-1', action: 'replace', fidelity: 'block',
        };
        return new Response(JSON.stringify({ data: [row] }), { status: 200, headers: jsonHeaders });
      }
      if (reqUrl.includes('/fragments/pzn/')) return new Response(OFFER_HTML, { status: 200, headers: htmlHeaders });
      return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
    });
    const html = await (await runWith(IXP_ENV, '/drafts/suresh/pzn?pzn=map')).text();
    expect(html).toContain('NEW OFFER');
  });

  it('strips all query params from the origin request for an HTML page (identity not leaked)', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      seen.push(reqUrl);
      if (reqUrl.startsWith(IXP_URL)) {
        return new Response(JSON.stringify(okBody), { status: 200, headers: jsonHeaders });
      }
      if (reqUrl.includes('/fragments/pzn/')) return new Response(OFFER_HTML, { status: 200, headers: htmlHeaders });
      return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
    });
    await runWith(env, '/drafts/suresh/pzn?pzn=ixp&ivid=secret-visitor&keep=1');
    const originCall = seen.find((u) => u.startsWith(ORIGIN) && !u.includes('/fragments/'));
    expect(originCall).toBeDefined();
    const originQuery = new URL(originCall).searchParams;
    expect(originQuery.has('ivid')).toBe(false); // identity not leaked to origin
    expect(originQuery.has('pzn')).toBe(false); // demo toggle stripped
    expect(originQuery.has('keep')).toBe(false); // HTML requests forward no query params
    expect(originCall).not.toContain('secret-visitor');
  });
});

// --- in-process mock source (?pzn=mock): the "no key required" demo path -----

/** Mocks fetch for the origin page + offer fragment only (no IXP endpoint). */
function mockOrigin(offer = OFFER_HTML) {
  const seen = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    seen.push(reqUrl);
    if (reqUrl.includes('/fragments/pzn/')) return new Response(offer, { status: 200, headers: htmlHeaders });
    return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
  });
  return seen;
}

/** Finds an ivid that lands in the requested arm of experiment 39002 (split 50/50). */
function ividForArm(wantTreatment) {
  for (let i = 0; i < 500; i += 1) {
    const id = `mock-visitor-${i}`;
    if ((bucketPercent(id, 39002) < 50) === wantTreatment) return id;
  }
  throw new Error('no ivid found for arm');
}

describe('?pzn=mock in-process source (no key required)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves the treatment arm in-process and injects the offer (no network call)', async () => {
    const seen = mockOrigin();
    const html = await (await runWith(env, `/drafts/suresh/pzn?pzn=mock&ivid=${ividForArm(true)}`)).text();
    expect(html).toContain('NEW OFFER');
    expect(html).not.toContain('OLD BLOCK');
    // The assignment is resolved in-process, so no request ever hits an IXP endpoint.
    expect(seen.some((u) => u.includes('/v2/assignment'))).toBe(false);
  });

  it('shows the baseline for the control arm', async () => {
    mockOrigin();
    const html = await (await runWith(env, `/drafts/suresh/pzn?pzn=mock&ivid=${ividForArm(false)}`)).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('?experimentId= overrides which experiment the mock resolves', async () => {
    // 39003 is a control fixture -> passthrough. A treatment-arm ivid would show
    // the offer under the route's default 39002, so baseline here proves the override.
    mockOrigin();
    const html = await (await runWith(env, `/drafts/suresh/pzn?pzn=mock&experimentId=39003&ivid=${ividForArm(true)}`)).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('strips demo params (pzn, ivid, experimentId) from the origin request', async () => {
    const seen = mockOrigin();
    await runWith(env, `/drafts/suresh/pzn?pzn=mock&ivid=${ividForArm(true)}&experimentId=39002&keep=1`);
    const originCall = seen.find((u) => u.startsWith(ORIGIN) && !u.includes('/fragments/'));
    expect(originCall).toBeDefined();
    const q = new URL(originCall).searchParams;
    expect(q.has('pzn')).toBe(false);
    expect(q.has('ivid')).toBe(false);
    expect(q.has('experimentId')).toBe(false);
    expect(q.has('keep')).toBe(false); // HTML requests forward no query params
  });
});

// --- data-fill: the response payload fills the fragment template's tokens ----

describe('fillTokens', () => {
  it('fills a present value (HTML-escaped), uses the default when absent, else empty', () => {
    const tpl = '<h2>{{headline|Default headline}}</h2><p>{{tagline}}</p><a>{{cta|Get started}}</a>';
    const out = fillTokens(tpl, { headline: 'Hi <b>Acme</b>', cta: 'Resume' });
    expect(out).toContain('<h2>Hi &lt;b&gt;Acme&lt;/b&gt;</h2>'); // value wins, escaped
    expect(out).toContain('<a>Resume</a>'); // value wins over the default
    expect(out).toContain('<p></p>'); // no value and no default -> empty
  });

  it('renders authored defaults unchanged when there is no data', () => {
    expect(fillTokens('<h2>{{headline|Automate the routine}}</h2>', undefined))
      .toBe('<h2>Automate the routine</h2>');
  });

  it('leaves token-free markup untouched', () => {
    expect(fillTokens(OFFER_HTML, { headline: 'x' })).toBe(OFFER_HTML);
  });
});

describe('?experimentId=39005 data-driven offer (payload fills the template)', () => {
  afterEach(() => vi.restoreAllMocks());

  const TEMPLATE = `<div>
  <div class="offer"><h2>{{headline|Default headline}}</h2><p>{{tagline}}</p><a class="button">{{cta|Get started}}</a></div>
</div>`;

  /** Serves the token template for the fragment, the page otherwise. */
  function mockTemplateOrigin() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      if (reqUrl.includes('/fragments/pzn/')) return new Response(TEMPLATE, { status: 200, headers: htmlHeaders });
      return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
    });
  }

  it('fills the template with the assignment payload data (defaults for omitted fields)', async () => {
    mockTemplateOrigin();
    const html = await (await runWith(env, '/drafts/suresh/pzn?pzn=mock&experimentId=39005&ivid=demo-visitor-1')).text();
    expect(html).toContain('Welcome back, Acme Co.'); // headline from payload
    expect(html).toContain('Resume your setup'); // cta from payload
    expect(html).toContain('<p></p>'); // tagline: no payload value, no default
    expect(html).not.toContain('{{'); // every token resolved
    expect(html).not.toContain('OLD BLOCK'); // block was replaced
  });
});
