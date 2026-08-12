import { describe, it, expect } from 'vitest';
import { readIvid, resolveVisitorIvid } from '../src/ivid.js';

const req = (url, init) => new Request(url, init);

describe('readIvid', () => {
  it('prefers the ?ivid= query param', () => {
    expect(readIvid(req('https://x.com/p?ivid=q123', { headers: { cookie: 'ivid=c456' } }))).toBe('q123');
  });

  it('falls back to the ivid cookie (url-decoded)', () => {
    expect(readIvid(req('https://x.com/p', { headers: { cookie: 'a=1; ivid=c%20456; b=2' } }))).toBe('c 456');
  });

  it('returns null when neither is present', () => {
    expect(readIvid(req('https://x.com/p'))).toBeNull();
  });
});

describe('resolveVisitorIvid', () => {
  it('mints a new ivid + Set-Cookie when none is present', () => {
    const { ivid, setCookie } = resolveVisitorIvid(req('https://x.com/p'));
    expect(ivid).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toContain(`ivid=${ivid}`);
    expect(setCookie).toContain('Path=/');
  });

  it('reuses an existing cookie without re-setting it', () => {
    const { ivid, setCookie } = resolveVisitorIvid(req('https://x.com/p', { headers: { cookie: 'ivid=c456' } }));
    expect(ivid).toBe('c456');
    expect(setCookie).toBeNull();
  });

  it('honors ?ivid= and persists it as a cookie (override)', () => {
    const { ivid, setCookie } = resolveVisitorIvid(req('https://x.com/p?ivid=q123', { headers: { cookie: 'ivid=c456' } }));
    expect(ivid).toBe('q123');
    expect(setCookie).toContain('ivid=q123');
  });
});
