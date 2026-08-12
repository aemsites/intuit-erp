import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { handleAudiences } from '../src/api/audiences.js';

const MOCK_ENV = { ...env, IXP_MOCK: 'enabled' };
const PAGE = '/drafts/pzn-demo/experiment';
const EXP = '39100';

function req(headers = {}, path = PAGE) {
  return new Request(
    `https://aem-erp.intuit.com/api/audiences?path=${encodeURIComponent(path)}`,
    { method: 'GET', headers },
  );
}

async function decide(ivid, path = PAGE) {
  const res = await handleAudiences(req({ cookie: `ivid=${ivid}` }, path), MOCK_ENV);
  return res;
}

describe('handleAudiences', () => {
  it('returns the sticky IXP arm as a remote audience token (no-store)', async () => {
    const res = await decide('visitor-1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(Object.keys(body.assignments)).toEqual([EXP]);
    const arm = body.assignments[EXP];
    expect(['treatment', 'control']).toContain(arm);
    expect(body.audiences).toEqual([`ixp${arm}`]);
  });

  it('is sticky per ivid', async () => {
    const a = await (await decide('visitor-1')).json();
    const b = await (await decide('visitor-1')).json();
    expect(b.assignments[EXP]).toBe(a.assignments[EXP]);
  });

  it('splits visitors deterministically across both arms', async () => {
    const bodies = await Promise.all(
      Array.from({ length: 20 }, (_, i) => decide(`v${i}`).then((r) => r.json())),
    );
    const arms = new Set(bodies.map((b) => b.assignments[EXP]));
    expect(arms.has('treatment')).toBe(true);
    expect(arms.has('control')).toBe(true);
  });

  it('returns empty for a page with no IXP route', async () => {
    const body = await (await decide('x', '/not-enrolled')).json();
    expect(body).toEqual({ assignments: {}, audiences: [] });
  });

  it('returns empty when there is no ivid', async () => {
    const res = await handleAudiences(req({}), MOCK_ENV);
    expect(await res.json()).toEqual({ assignments: {}, audiences: [] });
  });
});
