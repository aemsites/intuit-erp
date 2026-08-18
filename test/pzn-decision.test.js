import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import {
  apiBase, fragmentPath, fetchDecision, applyFragment, withTimeout, swapMain,
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
  it('reduces an absolute URL to its same-origin pathname', () => {
    expect(fragmentPath('https://main--intuit-erp--aemsites.aem.live/fragments/pzn/financial-services'))
      .toBe('/fragments/pzn/financial-services');
  });
  it('reduces an absolute URL with a query/hash to just the pathname', () => {
    expect(fragmentPath('https://main--intuit-erp--aemsites.aem.live/fragments/pzn/financial-services?a=1#top'))
      .toBe('/fragments/pzn/financial-services');
  });
});

describe('fetchDecision', () => {
  afterEach(() => {
    // Reset page URL to default to avoid test leakage
    window.history.replaceState({}, '', '/');
  });

  it('POSTs JSON and returns the parsed body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ placement: 'p', fragment: 'f' }]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const out = await fetchDecision('pzn', { method: 'POST', body: { slots: [{ placement: 'p' }] } });
    expect(out).toEqual([{ placement: 'p', fragment: 'f' }]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/pzn');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ slots: [{ placement: 'p' }] });
  });

  it('does not auto-append ivid to the URL — the caller owns it (query for IXP, body for PZN)', async () => {
    window.history.replaceState({}, '', '/page?ivid=qa123');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await fetchDecision('pzn', { method: 'POST', body: {} });
    const [url] = spy.mock.calls[0];
    expect(url).toBe('/api/pzn');
  });

  it('sends an intuit_tid correlation header (rp- prefixed), plus content-type on a POST body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await fetchDecision('pzn', { method: 'POST', body: {} });
    const [, init] = spy.mock.calls[0];
    expect(init.headers.intuit_tid).toMatch(/^rp-/);
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('returns null on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 500 }));
    expect(await fetchDecision('pzn')).toBeNull();
  });

  it('returns null when the request throws/aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('aborted'));
    expect(await fetchDecision('ixp')).toBeNull();
  });

  it('honors an external signal instead of creating its own internal timeout', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const pending = fetchDecision('ixp', { signal: controller.signal });
    controller.abort();
    // Resolves promptly from the caller's own abort — no internal AbortController/
    // timer is involved, so this never depends on waiting out a default timeoutMs.
    await expect(pending).resolves.toBeNull();
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

describe('swapMain', () => {
  it("fetches the variation's .plain.html and replaces main.innerHTML; returns true", async () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = '<main><div>BASE</div></main>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div>VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const ok = await swapMain(doc, '/fragments/pzn/home');
    expect(ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/fragments/pzn/home.plain.html', expect.anything());
    expect(doc.querySelector('main').innerHTML).toContain('VARIATION');
    expect(doc.querySelector('main').innerHTML).not.toContain('BASE');
  });

  it('returns false (baseline untouched) on a non-ok response', async () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = '<main><div>BASE</div></main>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    expect(await swapMain(doc, '/x')).toBe(false);
    expect(doc.querySelector('main').innerHTML).toContain('BASE');
  });

  it('returns false when there is no <main> or the ref is empty', async () => {
    const doc = document.implementation.createHTMLDocument('');
    expect(await swapMain(doc, '/x')).toBe(false);
    doc.body.innerHTML = '<main></main>';
    expect(await swapMain(doc, '')).toBe(false);
  });
});

describe('withTimeout', () => {
  it('resolves to the value when the promise settles first', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('resolves to undefined when the promise never settles within ms', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise(() => {});
      const pending = withTimeout(never, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves to undefined (never rejects) when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).resolves.toBeUndefined();
  });
});
