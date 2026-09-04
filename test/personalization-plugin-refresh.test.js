import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

// The plugin imports the DA SDK from a remote URL and runs init() on import;
// mock the SDK (default export is awaited → { context, token }) and the picker.
vi.mock('https://da.live/nx/utils/sdk.js', () => ({
  default: Promise.resolve({
    context: { org: 'o', repo: 'r', path: '/index' },
    token: 'tok',
  }),
}));
vi.mock('../tools/plugins/personalization/picker.js', () => ({ default: vi.fn() }));

const PLUGIN = '../tools/plugins/personalization/index.js';
const SOURCE_UNTAGGED = '<body><main><div><div class="hero"></div></div></main></body>';
const SOURCE_TAGGED = `<body><main><div><div class="hero"></div>`
  + `<div class="section-metadata"><div><div>pzn</div><div>MyPzn</div></div></div>`
  + '</div></main></body>';

function mockFetch(text) {
  return vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(text) });
}

describe('personalization plugin — always reads fresh DA source', () => {
  let fetchMock;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    fetchMock = mockFetch(SOURCE_UNTAGGED);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the DA source with cache: no-store', async () => {
    await import(PLUGIN);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admin.da.live/source/o/r/index.html');
    expect(opts.cache).toBe('no-store');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('re-fetches and re-renders when the tab becomes visible again', async () => {
    await import(PLUGIN);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // panel starts with no pzn tag
    expect(document.getElementById('app').textContent).not.toContain('MyPzn');

    // the doc gains a section tag out-of-band; next read should surface it
    const before = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve(SOURCE_TAGGED) });
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    await vi.waitFor(() => expect(document.getElementById('app').textContent).toContain('MyPzn'));
  });

  it('does not re-fetch while the tab is hidden', async () => {
    await import(PLUGIN);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // give any errant handler a chance to fire, then assert no extra fetch
    await new Promise((r) => { setTimeout(r, 20); });
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
