import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';
import { fillPlaceholders } from '../src/template.js';
import { deriveVisitorTokens } from '../src/visitor.js';

const IncomingRequest = Request;

const ORIGIN = env.ORIGIN_BASE_URL;
const MAP_URL = env.PZN_MAP_URL;
const SHEET_URL = `${ORIGIN}/drafts/pzn/api.json`;

/** The authored automation page: ALL-CAPS placeholders in head + body. */
const AUTOMATION_HTML = `<!DOCTYPE html><html><head>
<title>TITLE</title>
<meta property="og:title" content="TITLE">
<meta name="twitter:title" content="TITLE">
</head><body>
<main><div>
  <h2 id="title">TITLE</h2>
  <p>BODY</p>
</div></main>
</body></html>`;

/** A one-row sheet, shaped like the real /drafts/pzn/api.json. */
const SHEET = {
  total: 1,
  limit: 1,
  offset: 0,
  data: [{ title: 'Automate the routine', body: 'Intuit AI automates manual tasks' }],
  ':type': 'sheet',
};

const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
const jsonHeaders = { 'content-type': 'application/json' };

/** Routes mocked fetches: empty pzn map, the sheet, else the origin page. */
function mockOrigin(sheet = SHEET, page = AUTOMATION_HTML, sheetOk = true) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl === MAP_URL) {
      return new Response(JSON.stringify({ data: [] }), { headers: jsonHeaders });
    }
    if (reqUrl === SHEET_URL) {
      return sheetOk
        ? new Response(JSON.stringify(sheet), { status: 200, headers: jsonHeaders })
        : new Response('not found', { status: 404 });
    }
    return new Response(page, { status: 200, headers: htmlHeaders });
  });
}

async function run(path, init) {
  const request = new IncomingRequest(`https://worker.example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('template-fill personalization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fills the body TITLE and BODY on the automation page from the sheet', async () => {
    mockOrigin();
    const html = await (await run('/drafts/pzn/automation')).text();
    expect(html).toContain('<h2 id="title">Automate the routine</h2>');
    expect(html).toContain('<p>Intuit AI automates manual tasks</p>');
  });

  it('leaves the head <title> and social meta placeholders untouched (body-only scope)', async () => {
    mockOrigin();
    const html = await (await run('/drafts/pzn/automation')).text();
    expect(html).toContain('<title>TITLE</title>');
    expect(html).toContain('property="og:title" content="TITLE"');
    expect(html).toContain('name="twitter:title" content="TITLE"');
  });

  it('leaves the lowercase attribute/tag names untouched', async () => {
    mockOrigin();
    const html = await (await run('/drafts/pzn/automation')).text();
    expect(html).toContain('id="title"'); // not rewritten
    expect(html).toContain('og:title'); // not rewritten
    expect(html).toContain('<body>'); // not rewritten by the BODY token
  });

  it('passes a non-template page through byte-identical with no sheet fetch', async () => {
    const spy = mockOrigin();
    const res = await run('/some/other/page');
    expect(await res.text()).toBe(AUTOMATION_HTML);
    const fetchedSheet = spy.mock.calls
      .some(([i]) => (typeof i === 'string' ? i : i.url) === SHEET_URL);
    expect(fetchedSheet).toBe(false);
  });

  it('passes the page through untouched when the sheet cannot be fetched', async () => {
    mockOrigin(SHEET, AUTOMATION_HTML, false);
    const html = await (await run('/drafts/pzn/automation')).text();
    expect(html).toContain('>TITLE<'); // placeholder left as-is, page not broken
  });

  it('fills a per-visitor placeholder (CITY) from request.cf', async () => {
    const page = AUTOMATION_HTML.replace('<h2 id="title">TITLE</h2>', '<h2 id="title">CITY: TITLE</h2>');
    mockOrigin(SHEET, page);
    const html = await (await run('/drafts/pzn/automation', { cf: { city: 'Bengaluru' } })).text();
    expect(html).toContain('Bengaluru: Automate the routine');
  });
});

describe('fillPlaceholders (unit)', () => {
  it('HTML-escapes values and inserts $ literally', () => {
    const out = fillPlaceholders('<p>BODY</p>', { body: 'a <b> & "c" $1' });
    expect(out).toBe('<p>a &lt;b&gt; &amp; &quot;c&quot; $1</p>');
  });

  it('replaces whole words only, not substrings', () => {
    expect(fillPlaceholders('SUBTITLE TITLE', { title: 'X' })).toBe('SUBTITLE X');
  });

  it('scopes replacement to <body>, leaving <head> tokens intact', () => {
    const doc = '<head><title>TITLE</title></head><body><h2>TITLE</h2></body>';
    expect(fillPlaceholders(doc, { title: 'X' }))
      .toBe('<head><title>TITLE</title></head><body><h2>X</h2></body>');
  });
});

describe('deriveVisitorTokens (unit)', () => {
  it('reads geo from request.cf and always yields a greeting', () => {
    const req = { cf: { city: 'Paris', country: 'FR' }, headers: new Headers() };
    const tokens = deriveVisitorTokens(req);
    expect(tokens.city).toBe('Paris');
    expect(tokens.country).toBe('FR');
    expect(['Welcome', 'Good morning', 'Good afternoon', 'Good evening']).toContain(tokens.greeting);
  });

  it('falls back to CF-IPCountry and Accept-Language headers', () => {
    const req = {
      headers: new Headers({ 'cf-ipcountry': 'IN', 'accept-language': 'en-GB,en;q=0.9' }),
    };
    const tokens = deriveVisitorTokens(req);
    expect(tokens.country).toBe('IN');
    expect(tokens.lang).toBe('en-GB');
  });
});
