import { env } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { handleApi } from '../src/api/router.js';

const jsonHeaders = { 'content-type': 'application/json' };
const BATCH_URL = env.DECISION_ENGINE_BATCH_URL;
const API_ENV = { ...env, PZN_API_KEY: 'k' };

afterEach(() => vi.restoreAllMocks());

function req(path, init = {}) {
  return new Request(`https://aem-erp.intuit.com${path}`, init);
}

describe('handleApi', () => {
  it('answers an OPTIONS preflight from an allowed cross-origin with CORS 204', async () => {
    const res = await handleApi(req('/api/de', {
      method: 'OPTIONS',
      headers: { origin: 'https://branch--intuit-erp--aemsites.aem.page' },
    }), API_ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://branch--intuit-erp--aemsites.aem.page');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('403s a foreign origin', async () => {
    const res = await handleApi(
      req('/api/de', {
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
      }),
      API_ENV,
    );
    expect(res.status).toBe(403);
  });

  it('404s an unknown /api path', async () => {
    const res = await handleApi(req('/api/nope'), API_ENV);
    expect(res.status).toBe(404);
  });

  it('routes POST /api/de through to a decision', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === BATCH_URL) {
        return new Response(
          JSON.stringify({
            marketing_p_en_US: {
              data: {
                recommendations: {
                  recommendation: [{ copyData: { pznblock: 'fragments/pzn/x' } }],
                },
              },
              placement: 'p',
              experience: 'marketing',
              status: 200,
            },
          }),
          { status: 200, headers: jsonHeaders },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const res = await handleApi(
      req('/api/de', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'ivid=abc' },
        body: JSON.stringify({ slots: [{ placement: 'p' }] }),
      }),
      API_ENV,
    );
    expect(res.status).toBe(200);
    expect((await res.json())[0].fragment).toBe('fragments/pzn/x');
  });
});
