import { describe, it, expect } from 'vitest';
import { handleCatalog } from '../src/api/catalog.js';
import { SEGMENTS } from '../src/de/mock.js';

describe('handleCatalog', () => {
  it('returns the engine audience catalog (DE segments + IXP arms), cacheable', async () => {
    const res = await handleCatalog();
    expect(res.headers.get('content-type')).toContain('application/json');
    // Metadata, not per-visitor → cacheable (unlike the decision endpoints).
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);

    const body = await res.json();
    expect(Array.isArray(body.audiences)).toBe(true);
    SEGMENTS.forEach((segment) => expect(body.audiences).toContain(segment));
    expect(body.audiences).toEqual(expect.arrayContaining(['ixptreatment', 'ixpcontrol']));
  });
});
