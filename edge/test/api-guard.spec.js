import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, corsHeaders, guard } from '../src/api/guard.js';

const req = (origin, extra = {}) => new Request('https://aem-erp.intuit.com/api/de', {
  headers: { ...(origin ? { origin } : {}), ...extra },
});

describe('isAllowedOrigin', () => {
  it('allows a missing Origin (same-origin / non-CORS)', () => {
    expect(isAllowedOrigin(req(null))).toBe(true);
  });
  it('allows same-origin', () => {
    expect(isAllowedOrigin(req('https://aem-erp.intuit.com'))).toBe(true);
  });
  it('allows *.intuit.com, *.aem.live, *.aem.page', () => {
    expect(isAllowedOrigin(req('https://foo.intuit.com'))).toBe(true);
    expect(isAllowedOrigin(req('https://main--intuit-erp--aemsites.aem.live'))).toBe(true);
    expect(isAllowedOrigin(req('https://branch--intuit-erp--aemsites.aem.page'))).toBe(true);
  });
  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin(req('https://evil.example.com'))).toBe(false);
  });
  it('rejects the literal null origin (sandboxed iframe bypass)', () => {
    expect(isAllowedOrigin(req('null'))).toBe(false);
  });
  it('rejects unparseable/garbage origin', () => {
    expect(isAllowedOrigin(req('not a url'))).toBe(false);
  });
  it('rejects empty-string origin (malformed header)', () => {
    const r = new Request('https://aem-erp.intuit.com/api/de', {
      headers: { origin: '' },
    });
    expect(isAllowedOrigin(r)).toBe(false);
  });
});

describe('corsHeaders', () => {
  it('emits credentialed CORS for an allowed cross-origin', () => {
    const h = corsHeaders(req('https://branch--intuit-erp--aemsites.aem.page'));
    expect(h['access-control-allow-origin']).toBe('https://branch--intuit-erp--aemsites.aem.page');
    expect(h['access-control-allow-credentials']).toBe('true');
  });
  it('emits nothing for same-origin', () => {
    expect(corsHeaders(req('https://aem-erp.intuit.com'))).toEqual({});
  });
  it('emits nothing for the literal null origin (sandboxed iframe bypass)', () => {
    expect(corsHeaders(req('null'))).toEqual({});
  });
  it('emits nothing for empty-string origin (malformed header)', () => {
    const r = new Request('https://aem-erp.intuit.com/api/de', {
      headers: { origin: '' },
    });
    expect(corsHeaders(r)).toEqual({});
  });
});

describe('guard', () => {
  it('passes an allowed origin when no EDGE_AUTH_SECRET is set', () => {
    expect(guard(req('https://aem-erp.intuit.com'), {}).ok).toBe(true);
  });
  it('403s a foreign origin', () => {
    const g = guard(req('https://evil.example.com'), {});
    expect(g.ok).toBe(false);
    expect(g.response.status).toBe(403);
  });
  it('requires the shared secret header when EDGE_AUTH_SECRET is set', () => {
    const env = { EDGE_AUTH_SECRET: 's3cret' };
    expect(guard(req('https://aem-erp.intuit.com'), env).ok).toBe(false);
    expect(guard(req('https://aem-erp.intuit.com', { 'x-edge-auth': 's3cret' }), env).ok).toBe(true);
  });
  it('403s the literal null origin (sandboxed iframe bypass)', () => {
    const g = guard(req('null'), {});
    expect(g.ok).toBe(false);
    expect(g.response.status).toBe(403);
  });
  it('still requires x-edge-auth when EDGE_AUTH_SECRET is set to empty string', () => {
    const env = { EDGE_AUTH_SECRET: '' };
    expect(guard(req('https://aem-erp.intuit.com'), env).ok).toBe(false);
    expect(guard(req('https://aem-erp.intuit.com', { 'x-edge-auth': '' }), env).ok).toBe(true);
  });
  it('403s empty-string origin (malformed header)', () => {
    const r = new Request('https://aem-erp.intuit.com/api/de', {
      headers: { origin: '' },
    });
    const g = guard(r, {});
    expect(g.ok).toBe(false);
    expect(g.response.status).toBe(403);
  });
});
