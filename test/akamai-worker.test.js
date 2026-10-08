import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  httpRequest, createResponse, logger, ReadableStream, TextEncoder,
} from './fixtures/akamai-runtime.js';
import { responseProvider } from '../akamai/src/main.js';

const PAGE_URL = '/pricing/?cb=worker-test';
const PAGE_HTML = '<html><head></head><body><header></header><main>Pricing</main><footer></footer></body></html>';
const NAV_HTML = '<div>Navigation</div>';
const FOOTER_HTML = '<div>Footer</div>';

function response(html, {
  tags, status = 200, type = 'text/html', headers = {},
} = {}) {
  const responseHeaders = { 'content-type': [type], ...headers };
  if (tags != null) responseHeaders['edge-cache-tag'] = Array.isArray(tags) ? tags : [tags];
  return {
    status,
    getHeader: (name) => responseHeaders[name.toLowerCase()],
    getHeaders: () => ({ ...responseHeaders }),
    text: vi.fn().mockResolvedValue(html),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    }),
  };
}

function request(method = 'GET') {
  return {
    host: 'erp.intuit.com',
    url: PAGE_URL,
    method,
    getVariable: vi.fn(),
    getHeader: vi.fn(),
  };
}

function serve(page, nav = response(NAV_HTML, { tags: 'nav,shared' }), footer = response(FOOTER_HTML, { tags: 'footer,shared' })) {
  const responses = new Map([
    [PAGE_URL, page],
    ['/nav.plain.html', nav],
    ['/footer.plain.html', footer],
  ]);
  httpRequest.mockImplementation(async (url) => {
    if (!responses.has(url)) throw new Error(`Unexpected subrequest: ${url}`);
    const result = responses.get(url);
    if (result instanceof Error) throw result;
    return result;
  });
}

describe('Akamai responseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpRequest.mockReset();
  });

  it('requests visible cache tags on every subrequest without a client pragma', async () => {
    const responses = new Map([
      [PAGE_URL, [PAGE_HTML, 'page,shared']],
      ['/nav.plain.html', [NAV_HTML, 'nav,shared']],
      ['/footer.plain.html', [FOOTER_HTML, 'footer,shared']],
    ]);
    httpRequest.mockImplementation(async (url, { headers }) => {
      const [html, tags] = responses.get(url);
      const visible = headers.pragma?.includes('akamai-x-get-cache-tags');
      return response(html, { tags: visible ? tags : undefined });
    });
    const req = request();
    const result = await responseProvider(req);

    expect(result.headers['edge-cache-tag']).toEqual(['page,shared,nav,footer']);
    expect(httpRequest).toHaveBeenCalledTimes(3);
    httpRequest.mock.calls.forEach(([, options]) => {
      expect(options.headers).toEqual({
        'x-forwarded-host': ['erp.intuit.com'],
        'x-byo-cdn-type': ['akamai'],
        'x-push-invalidation': ['enabled'],
        pragma: ['akamai-x-get-cache-tags'],
      });
    });
    expect(req.getHeader).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('preserves origin authentication without forwarding other client debug pragmas', async () => {
    serve(response(PAGE_HTML, { tags: 'page' }));
    const req = request();
    req.getVariable.mockReturnValue('test-origin-auth');
    req.getHeader.mockReturnValue(['akamai-x-cache-on,akamai-x-get-cache-tags']);

    await responseProvider(req);

    expect(req.getVariable).toHaveBeenCalledWith('PMUSER_ORIGIN_AUTH');
    httpRequest.mock.calls.forEach(([, options]) => {
      expect(options.headers.authorization).toEqual(['token test-origin-auth']);
      expect(options.headers.pragma).toEqual(['akamai-x-get-cache-tags']);
    });
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('unions all header values and streams composed HTML larger than 16 KB', async () => {
    const html = PAGE_HTML.replace('Pricing', 'Pricing '.repeat(3000));
    serve(response(html, {
      tags: ['page,shared', 'page-extra'],
      headers: {
        'content-length': ['123'],
        'content-encoding': ['gzip'],
        'cache-control': ['max-age=60'],
        'last-modified': ['Wed, 07 Oct 2026 10:00:00 GMT'],
      },
    }), response(NAV_HTML, {
      tags: ['nav,shared', 'nav-extra'],
      headers: { 'last-modified': ['Thu, 08 Oct 2026 10:00:00 GMT'] },
    }));

    const result = await responseProvider(request());
    const body = await new Response(result.body).text();

    expect(result.status).toBe(200);
    expect(result.headers['edge-cache-tag']).toEqual(['page,shared,page-extra,nav,nav-extra,footer']);
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['cache-control']).toEqual(['max-age=60']);
    expect(result.headers['last-modified']).toEqual(['Thu, 08 Oct 2026 10:00:00 GMT']);
    expect(body.length).toBeGreaterThan(16 * 1024);
    expect(body).toContain('<header>\n  <nav>\n    <div>Navigation</div>');
    expect(body).toContain('<footer>\n  <nav>\n    <div>Footer</div>');
    expect(body).toContain('Pricing '.repeat(3000));
  });

  it('keeps page tags without fetching hidden header or footer fragments', async () => {
    const html = PAGE_HTML.replace('<head>', '<head><meta name="hide-header" content="true"><meta name="hide-footer" content="yes">');
    serve(response(html, { tags: 'page' }));

    const result = await responseProvider(request());

    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(result.headers['edge-cache-tag']).toEqual(['page']);
    expect(await new Response(result.body).text()).toBe(html);
  });

  it('requests tags for overridden fragment paths, including folder indexes', async () => {
    const html = PAGE_HTML.replace('<head>', '<head><meta name="nav" content="/custom/nav"><meta name="footer" content="/custom/footer/">');
    const responses = new Map([
      [PAGE_URL, response(html, { tags: 'page' })],
      ['/custom/nav.plain.html', response(NAV_HTML, { tags: 'custom-nav' })],
      ['/custom/footer/index.plain.html', response(FOOTER_HTML, { tags: 'custom-footer' })],
    ]);
    httpRequest.mockImplementation(async (url) => {
      if (!responses.has(url)) throw new Error(`Unexpected subrequest: ${url}`);
      return responses.get(url);
    });

    const result = await responseProvider(request());

    expect(result.headers['edge-cache-tag']).toEqual(['page,custom-nav,custom-footer']);
    expect(httpRequest.mock.calls.map(([url]) => url)).toEqual([...responses.keys()]);
    httpRequest.mock.calls.forEach(([, options]) => {
      expect(options.headers.pragma).toEqual(['akamai-x-get-cache-tags']);
    });
  });

  it.each([
    ['404', () => response('Not found', { status: 404, tags: 'failed-nav' })],
    ['non-HTML', () => response('Not HTML', { type: 'text/plain', tags: 'failed-nav' })],
    ['network error', () => new Error('Fragment unavailable')],
  ])('logs a %s fragment failure without merging its tags', async (_, failedNav) => {
    serve(response(PAGE_HTML, { tags: 'page' }), failedNav());

    const result = await responseProvider(request());
    const body = await new Response(result.body).text();

    expect(result.headers['edge-cache-tag']).toEqual(['page,footer,shared']);
    expect(body).toContain('<header></header>');
    expect(body).toContain(FOOTER_HTML);
    expect(logger.log).toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalledWith('inline: %s response is missing edge-cache-tag', 'nav');
  });

  it.each(['page', 'nav', 'footer'])('reports missing %s tags while preserving existing inlining behavior', async (source) => {
    serve(
      response(PAGE_HTML, { tags: source === 'page' ? undefined : 'page' }),
      response(NAV_HTML, { tags: source === 'nav' ? undefined : 'nav' }),
      response(FOOTER_HTML, { tags: source === 'footer' ? undefined : 'footer' }),
    );

    const result = await responseProvider(request());

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('inline: %s response is missing edge-cache-tag', source);
    expect(result.headers['edge-cache-tag']).toEqual([
      ['page', 'nav', 'footer'].filter((tag) => tag !== source).join(','),
    ]);
    const body = await new Response(result.body).text();
    expect(body).toContain(NAV_HTML);
    expect(body).toContain(FOOTER_HTML);
  });

  it('reports empty tag sets instead of silently treating the response as tagged', async () => {
    serve(
      response(PAGE_HTML),
      response(NAV_HTML, { tags: ' , ' }),
      response(FOOTER_HTML, { tags: [] }),
    );

    const result = await responseProvider(request());

    expect(logger.log.mock.calls).toEqual([
      ['inline: %s response is missing edge-cache-tag', 'page'],
      ['inline: %s response is missing edge-cache-tag', 'nav'],
      ['inline: %s response is missing edge-cache-tag', 'footer'],
    ]);
    expect(result.headers['edge-cache-tag']).toBeUndefined();
  });

  it.each([
    ['HEAD', 200, 'text/html'],
    ['GET', 404, 'text/html'],
    ['GET', 200, 'application/json'],
  ])('preserves the pass-through path for %s / %i / %s', async (method, status, type) => {
    const page = response('Unmodified', { status, type, tags: 'page' });
    serve(page);

    const result = await responseProvider(request(method));

    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(page.text).not.toHaveBeenCalled();
    expect(result).toEqual({ status, headers: page.getHeaders(), body: page.body });
    expect(createResponse).toHaveBeenCalledWith(status, page.getHeaders(), page.body);
    expect(logger.log).not.toHaveBeenCalled();
  });
});
