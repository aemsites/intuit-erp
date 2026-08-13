import { describe, it, expect } from 'vitest';
import { readIvid } from '../src/ivid.js';

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
