import {
  describe, expect, it, vi,
} from 'vitest';
import {
  AEM_ADMIN_ORIGIN,
  DA_ADMIN_ORIGIN,
  TRACKING_SOURCE_PATH,
  createTrackingApi,
  resolveTrackingRef,
} from '../tools/plugins/tracking/api.js';

const CONTEXT = { org: 'aemsites', repo: 'intuit-erp' };
const SOURCE_URL = 'https://admin.da.live/source/aemsites/intuit-erp/tracking.json';

function response({
  body = {}, etag = '"revision-1"', ok = true, status = 200, statusText = 'OK',
} = {}) {
  return {
    headers: { get: vi.fn((name) => (name.toLowerCase() === 'etag' ? etag : null)) },
    json: vi.fn().mockResolvedValue(body),
    ok,
    status,
    statusText,
  };
}

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

describe('tracking editor authenticated delivery API', () => {
  it('exports the tracking source and admin origins', () => {
    expect(TRACKING_SOURCE_PATH).toBe('/tracking.json');
    expect(DA_ADMIN_ORIGIN).toBe('https://admin.da.live');
    expect(AEM_ADMIN_ORIGIN).toBe('https://admin.hlx.page');
  });

  it('resolves explicit and context refs before DA preview hostnames, otherwise using main', () => {
    const hostname = 'codex-tracking-editor-poc--intuit-erp--aemsites.preview.da.live';

    expect(resolveTrackingRef({ ref: 'explicit-ref', context: { ref: 'context-ref' }, hostname }))
      .toBe('explicit-ref');
    expect(resolveTrackingRef({ context: { ref: 'context-ref' }, hostname }))
      .toBe('context-ref');
    expect(resolveTrackingRef({ hostname })).toBe('codex-tracking-editor-poc');
    expect(resolveTrackingRef({ hostname: 'main--intuit-erp--aemsites.preview.da.live' }))
      .toBe('main');
    expect(resolveTrackingRef({ hostname: 'www.intuit.com' })).toBe('main');
  });

  it('maps the DA local development ref to the main AEM delivery ref', () => {
    expect(resolveTrackingRef({ ref: 'local', hostname: 'localhost' })).toBe('main');
  });

  it('reads and parses the live tracking sheet through authenticated daFetch', async () => {
    const sheet = { ':type': 'sheet', total: 0, data: [] };
    const daFetch = vi.fn().mockResolvedValue(response({ body: sheet }));
    const api = createTrackingApi({ daFetch, context: CONTEXT });

    await expect(api.readSource()).resolves.toEqual(sheet);
    expect(daFetch).toHaveBeenCalledWith(SOURCE_URL, { method: 'GET', cache: 'no-store' });
  });

  it('reads the source ETag required for atomic editing', async () => {
    const sheet = { ':type': 'sheet', total: 0, data: [] };
    const daFetch = vi.fn().mockResolvedValue(response({ body: sheet, etag: '"revision-42"' }));
    const api = createTrackingApi({ daFetch, context: CONTEXT });

    await expect(api.readSourceRevision()).resolves.toEqual({
      sheet,
      etag: '"revision-42"',
    });
  });

  it('normalizes Cloudflare weak ETags before conditional writes', async () => {
    const sheet = { ':type': 'sheet', total: 0, data: [] };
    const daFetch = vi.fn().mockResolvedValue(response({ body: sheet, etag: 'W/"revision-42"' }));
    const api = createTrackingApi({ daFetch, context: CONTEXT });

    const revision = await api.readSourceRevision();
    await api.writeSource(sheet, { etag: 'W/"revision-42"' });

    expect(revision.etag).toBe('"revision-42"');
    expect(daFetch).toHaveBeenNthCalledWith(1, SOURCE_URL, { method: 'GET', cache: 'no-store' });
    expect(daFetch).toHaveBeenLastCalledWith(SOURCE_URL, expect.objectContaining({
      method: 'POST',
      headers: { 'If-Match': '"revision-42"' },
    }));
  });

  it('reports actionable read failures for HTTP, network, and malformed JSON errors', async () => {
    const forbidden = createTrackingApi({
      context: CONTEXT,
      daFetch: vi.fn().mockResolvedValue(response({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      })),
    });
    await expect(forbidden.readSource()).rejects.toThrow(/read tracking sheet.*403 Forbidden/i);

    const offline = createTrackingApi({
      context: CONTEXT,
      daFetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(offline.readSource()).rejects.toThrow(/read tracking sheet.*Failed to fetch/i);

    const malformedResponse = response();
    malformedResponse.json.mockRejectedValue(new SyntaxError('Unexpected token'));
    const malformed = createTrackingApi({
      context: CONTEXT,
      daFetch: vi.fn().mockResolvedValue(malformedResponse),
    });
    await expect(malformed.readSource()).rejects.toThrow(/tracking sheet.*valid JSON/i);
  });

  it('writes the sheet as DA-compatible multipart form data through authenticated daFetch', async () => {
    const sheet = { ':type': 'sheet', total: 1, data: [{ path: '*', id: 'cta:test' }] };
    const daFetch = vi.fn().mockResolvedValue(response());
    const api = createTrackingApi({ daFetch, context: CONTEXT });

    await api.writeSource(sheet, { etag: '"revision-1"' });

    expect(daFetch).toHaveBeenCalledTimes(1);
    const [url, options] = daFetch.mock.calls[0];
    expect(url).toBe(SOURCE_URL);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'If-Match': '"revision-1"' });
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('data')).toBeInstanceOf(Blob);
    await expect(readBlob(options.body.get('data'))).resolves.toBe(
      `${JSON.stringify(sheet, null, 2)}\n`,
    );
  });

  it('refuses an unconditional whole-sheet write', async () => {
    const api = createTrackingApi({ daFetch: vi.fn(), context: CONTEXT });

    await expect(api.writeSource({ data: [] }))
      .rejects.toThrow(/etag.*safe tracking sheet update/i);
  });

  it('reports actionable source write failures', async () => {
    const api = createTrackingApi({
      context: CONTEXT,
      daFetch: vi.fn().mockResolvedValue(response({
        ok: false,
        status: 409,
        statusText: 'Conflict',
      })),
    });

    await expect(api.writeSource({ data: [] }, { etag: '"revision-1"' }))
      .rejects.toThrow(/save tracking sheet.*409 Conflict/i);
  });

  it('previews tracking.json on the resolved ref through authenticated daFetch', async () => {
    const daFetch = vi.fn().mockResolvedValue(response({ body: { preview: { status: 200 } } }));
    const api = createTrackingApi({ daFetch, context: CONTEXT, ref: 'feature-ref' });

    await api.preview();

    expect(daFetch).toHaveBeenCalledWith(
      'https://admin.hlx.page/preview/aemsites/intuit-erp/feature-ref/tracking.json',
      { method: 'POST' },
    );
  });

  it('publishes tracking.json on the resolved ref through authenticated daFetch', async () => {
    const daFetch = vi.fn().mockResolvedValue(response({ body: { live: { status: 200 } } }));
    const api = createTrackingApi({ daFetch, context: CONTEXT, ref: 'feature-ref' });

    await api.publish();

    expect(daFetch).toHaveBeenCalledWith(
      'https://admin.hlx.page/live/aemsites/intuit-erp/feature-ref/tracking.json',
      { method: 'POST' },
    );
  });

  it('reports actionable AEM delivery failures', async () => {
    const api = createTrackingApi({
      context: CONTEXT,
      daFetch: vi.fn().mockResolvedValue(response({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })),
      ref: 'main',
    });

    await expect(api.preview()).rejects.toThrow(/preview tracking sheet.*503 Service Unavailable/i);
    await expect(api.publish()).rejects.toThrow(/publish tracking sheet.*503 Service Unavailable/i);
  });
});
