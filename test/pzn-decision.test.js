import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import {
  apiBase, fragmentPath, fetchDecision, applyFragment,
} from '../scripts/personalization/decision.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

describe('apiBase', () => {
  it('defaults to /api', () => {
    expect(apiBase()).toBe('/api');
  });
  it('reads the pzn-api-base metadata and strips a trailing slash', () => {
    document.head.innerHTML = '<meta name="pzn-api-base" content="https://w.example.com/api/">';
    expect(apiBase()).toBe('https://w.example.com/api');
  });
});

describe('fragmentPath', () => {
  it('adds a leading slash to a bare ref', () => {
    expect(fragmentPath('fragments/pzn/x')).toBe('/fragments/pzn/x');
  });
  it('leaves an absolute ref unchanged', () => {
    expect(fragmentPath('/fragments/pzn/x')).toBe('/fragments/pzn/x');
  });
  it('returns null for an empty ref', () => {
    expect(fragmentPath('')).toBeNull();
  });
});

describe('fetchDecision', () => {
  it('POSTs JSON and returns the parsed body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ placement: 'p', fragment: 'f' }]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const out = await fetchDecision('de', { method: 'POST', body: { slots: [{ placement: 'p' }] } });
    expect(out).toEqual([{ placement: 'p', fragment: 'f' }]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/de');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ slots: [{ placement: 'p' }] });
  });

  it('returns null on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 500 }));
    expect(await fetchDecision('de')).toBeNull();
  });

  it('returns null when the request throws/aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('aborted'));
    expect(await fetchDecision('ixp')).toBeNull();
  });
});

describe('applyFragment', () => {
  it('replaces the target children with the loaded fragment', async () => {
    const target = document.createElement('div');
    target.innerHTML = '<p>OLD</p>';
    const frag = document.createElement('main');
    frag.innerHTML = '<div class="offer">NEW</div>';
    const loadFragment = vi.fn().mockResolvedValue(frag);
    const ok = await applyFragment(target, 'fragments/pzn/x', { loadFragment });
    expect(ok).toBe(true);
    expect(loadFragment).toHaveBeenCalledWith('/fragments/pzn/x');
    expect(target.innerHTML).toContain('NEW');
    expect(target.innerHTML).not.toContain('OLD');
  });

  it('returns false when the fragment fails to load', async () => {
    const target = document.createElement('div');
    const ok = await applyFragment(target, 'x', { loadFragment: vi.fn().mockResolvedValue(null) });
    expect(ok).toBe(false);
  });
});
