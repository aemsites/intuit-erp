import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';
import { fillTokens } from '../src/pzn.js';
import { assignmentToPznEntry } from '../src/ixp/resolve.js';
import { resolveRoute } from '../src/ixp/routes.js';

const IncomingRequest = Request;

const ORIGIN = env.ORIGIN_BASE_URL;
// The worker talks to the real IXP host (from wrangler.jsonc); fetch is spied, so
// no request leaves the test — the mock just matches this prefix.
const IXP_URL = env.IXP_ASSIGNMENT_URL;
// The route the experiment page is enrolled in (src/ixp/routes.js).
const ROUTE = { experimentId: 15972, location: 'slot-1', fidelity: 'block' };

/** The path enrolled in the real IXP experiment. */
const ENROLLED = '/drafts/pzn/experiment';

/** The redirect payload key the real IXP API carries the variation path under. */
const VARIATION_KEY = 'intuit.com.integration.variation.html';

/** Builds an assignment with only the fields the consumer reads set. */
function assignment(partial) {
  return {
    experimentId: 15972,
    experimentType: 'REPLACE_WEB_CONTENT',
    label: '',
    payload: '',
    assetLocation: null,
    control: false,
    ...partial,
  };
}

describe('assignmentToPznEntry', () => {
  it('maps REDIRECT + the variation.html key to a page-level replace', () => {
    const entry = assignmentToPznEntry(
      assignment({
        experimentType: 'REDIRECT',
        payload: JSON.stringify({ [VARIATION_KEY]: '/x-variant' }),
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

  it('returns null for REDIRECT without the variation key', () => {
    const entry = assignmentToPznEntry(
      assignment({ experimentType: 'REDIRECT', payload: JSON.stringify({ other: '/x' }) }),
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
  it('resolves the enrolled experiment path', () => {
    expect(resolveRoute(ENROLLED)).toEqual({ experimentId: 15972, location: 'slot-1', fidelity: 'block' });
  });

  it('normalizes a trailing slash', () => {
    expect(resolveRoute(`${ENROLLED}/`)).not.toBeNull();
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

const IXP_ENV = { ...env, PZN_SOURCE: 'ixp', IXP_API_KEY: 'dev-ixp-key' };

/**
 * Routes mocked fetches: the IXP endpoint returns `ixpBody`, the offer fragment
 * returns `offer` (null → 404), anything else returns the origin page.
 */
function mockIxp(ixpBody, offer = OFFER_HTML, page = PAGE_HTML) {
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
    return new Response(page, { status: 200, headers: htmlHeaders });
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
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
    expect(html).not.toContain('OLD BLOCK');
    expect(html).toContain('NEW OFFER');
  });

  it('reads the ivid from a cookie', async () => {
    mockIxp(okBody);
    const html = await (await run(ENROLLED, { cookie: 'foo=1; ivid=abc' })).text();
    expect(html).toContain('NEW OFFER');
  });

  it('passes through when there is no ivid', async () => {
    mockIxp(okBody);
    const html = await (await run(ENROLLED)).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through on an unenrolled path (no IXP call needed)', async () => {
    mockIxp(okBody);
    const html = await (await run('/not-enrolled?ivid=abc')).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through when the assignment is the control arm', async () => {
    mockIxp({ ivid: 'abc', transactionId: 't', assignments: [assignment({ control: true })] });
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
    expect(html).toBe(PAGE_HTML);
  });

  it('passes through when IXP returns no assignments', async () => {
    mockIxp({ ivid: 'abc', transactionId: 't', assignments: [] });
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
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

  it('?pzn=ixp forces the IXP flow even when the default is de', async () => {
    mockIxp(okBody); // env default (from wrangler.jsonc) is PZN_SOURCE=de
    const html = await (await runWith(env, `${ENROLLED}?pzn=ixp&ivid=abc`)).text();
    expect(html).toContain('NEW OFFER');
  });

  it('?pzn=de forces the DE flow (and never calls IXP) even when the default is ixp', async () => {
    // The experiment page has no DE route, so ?pzn=de resolves to [] (passthrough)
    // without ever touching the IXP endpoint — proving the override switched source.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqUrl = typeof input === 'string' ? input : input.url;
      if (reqUrl.startsWith(IXP_URL)) throw new Error('IXP must not be called in de mode');
      return new Response(PAGE_HTML, { status: 200, headers: htmlHeaders });
    });
    const html = await (await runWith(IXP_ENV, `${ENROLLED}?pzn=de&ivid=abc`)).text();
    expect(html).toBe(PAGE_HTML);
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
    await runWith(env, `${ENROLLED}?pzn=ixp&ivid=secret-visitor&keep=1`);
    const originCall = seen.find((u) => u.startsWith(ORIGIN) && !u.includes('/fragments/'));
    expect(originCall).toBeDefined();
    const originQuery = new URL(originCall).searchParams;
    expect(originQuery.has('ivid')).toBe(false); // identity not leaked to origin
    expect(originQuery.has('pzn')).toBe(false); // demo toggle stripped
    expect(originQuery.has('keep')).toBe(false); // HTML requests forward no query params
    expect(originCall).not.toContain('secret-visitor');
  });
});

// --- data-fill: the assignment payload fills the fragment template's tokens --

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

describe('data-driven offer (assignment payload fills the template)', () => {
  afterEach(() => vi.restoreAllMocks());

  const TEMPLATE = `<div>
  <div class="offer"><h2>{{headline|Default headline}}</h2><p>{{tagline}}</p><a class="button">{{cta|Get started}}</a></div>
</div>`;

  const dataBody = {
    ivid: 'abc',
    transactionId: 't',
    assignments: [assignment({
      experimentType: 'REPLACE_WEB_CONTENT',
      assetLocation: '/fragments/pzn/welcome',
      payload: JSON.stringify({
        headline: 'Welcome back, Acme Co.',
        cta: 'Resume your setup',
        badge: '30% off',
      }),
    })],
  };

  it('fills the template with the assignment payload data (defaults for omitted fields)', async () => {
    mockIxp(dataBody, TEMPLATE);
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
    expect(html).toContain('Welcome back, Acme Co.'); // headline from payload
    expect(html).toContain('Resume your setup'); // cta from payload
    expect(html).toContain('<p></p>'); // tagline: no payload value, no default
    expect(html).not.toContain('{{'); // every token resolved
    expect(html).not.toContain('OLD BLOCK'); // block was replaced
  });
});

// --- use case 1: experiment page → whole-<main> swap to the treatment page ---

const EXPERIMENT_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<main>
  <div><div class="hero"><div>CONTROL PAGE</div></div></div>
</main>
</body></html>`;

/** The treatment page's `.plain.html` (main content) the redirect swaps in. */
const TREATMENT_MAIN = `<div><div class="hero"><div>TREATMENT PAGE</div></div></div>
<div><div class="slot-1"><div>slot one</div></div></div>`;

/**
 * Routes fetches for the whole-page swap: the IXP endpoint returns `ixpBody`,
 * the treatment page's `.plain.html` returns the treatment main, the experiment
 * page returns the baseline.
 */
function mockExperiment(ixpBody) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl.startsWith(IXP_URL)) {
      return new Response(JSON.stringify(ixpBody), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/drafts/pzn/treatment.plain.html')) {
      return new Response(TREATMENT_MAIN, { status: 200, headers: htmlHeaders });
    }
    return new Response(EXPERIMENT_HTML, { status: 200, headers: htmlHeaders });
  });
}

describe('experiment page: whole-page A/B swap (REDIRECT)', () => {
  afterEach(() => vi.restoreAllMocks());

  const redirectBody = {
    ivid: 'abc',
    transactionId: 't',
    assignments: [assignment({
      experimentType: 'REDIRECT',
      payload: JSON.stringify({ [VARIATION_KEY]: '/drafts/pzn/treatment' }),
    })],
  };

  it('treatment arm swaps the whole <main> for the treatment page', async () => {
    mockExperiment(redirectBody);
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
    expect(html).toContain('TREATMENT PAGE');
    expect(html).not.toContain('CONTROL PAGE');
  });

  it('control arm shows the baseline experiment page', async () => {
    mockExperiment({ ivid: 'abc', transactionId: 't', assignments: [assignment({ control: true })] });
    const html = await (await run(`${ENROLLED}?ivid=abc`)).text();
    expect(html).toBe(EXPERIMENT_HTML);
    expect(html).not.toContain('TREATMENT PAGE');
  });
});
