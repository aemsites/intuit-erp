import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', async () => {
  const actual = await vi.importActual('../scripts/personalization/decision.js');
  return {
    fetchDecision: vi.fn(),
    fragmentPath: actual.fragmentPath,
    // swapMain moved out of exp.js into decision.js; the redirect-swap tests exercise
    // the real fetch + innerHTML behavior, so use the actual implementation.
    swapMain: actual.swapMain,
  };
});

// eslint-disable-next-line import/first
import { isExperimentEnabled, runExperiment } from '../scripts/exp.js';
// eslint-disable-next-line import/first
import { fetchDecision } from '../scripts/personalization/decision.js';
// eslint-disable-next-line import/first
import { resetAnalytics } from '../scripts/personalization/analytics.js';

const VARIATION_KEY = 'intuit.com.integration.variation.html';

// A raw IXP assignment (only the fields the consumer reads).
function assignment(partial) {
  return {
    experimentId: 385944,
    experimentVersion: 7,
    id: 39927,
    experimentType: 'REDIRECT',
    payload: '',
    assetLocation: null,
    control: false,
    ...partial,
  };
}

const redirectTo = (path) => assignment({
  experimentType: 'REDIRECT',
  payload: JSON.stringify({ [VARIATION_KEY]: path }),
});
const replaceWith = (path) => assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: path });

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<main><div class="hero">BASE</div></main>';
  resetAnalytics();
  delete window.appVars;
  window.requestIdleCallback = (cb) => { cb(); return 0; };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.requestIdleCallback;
  resetAnalytics();
  delete window.appVars;
});

function setMeta(name, content) {
  const m = document.createElement('meta');
  m.setAttribute('name', name);
  m.setAttribute('content', content);
  document.head.appendChild(m);
}

describe('isExperimentEnabled', () => {
  it('is false with no experiment metadata', () => {
    expect(isExperimentEnabled()).toBe(false);
  });
  it('is true when experiment-id is present', () => {
    setMeta('experiment-id', '385944');
    expect(isExperimentEnabled()).toBe(true);
  });
});

describe('runExperiment', () => {
  it('swaps <main> with the variation plain.html on a redirect assignment', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [redirectTo('/drafts/pzn/csr-variation')] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div class="hero">VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    await runExperiment(document);

    const [source] = fetchDecision.mock.calls[0];
    expect(source).toContain('ixp?');
    expect(source).toContain('experimentId=385944');
    expect(source).not.toContain('fidelity=');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/drafts/pzn/csr-variation.plain.html',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(document.querySelector('main').innerHTML).toContain('VARIATION');
    expect(document.querySelector('main').innerHTML).not.toContain('BASE');

    // Analytics record published (treatment ⇒ has a replacement path).
    expect(window.appVars.ixpDetailsArr).toEqual([{
      experiment_id: 385944,
      experiment_version: 7,
      experiment_treatment: 39927,
      original_content_id: window.location.pathname,
      replacement_content_id: '/drafts/pzn/csr-variation',
    }]);
  });

  it('fetches the same-origin pathname (not a doubled URL) when the variation is an absolute URL', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({
      assignments: [redirectTo('https://main--intuit-erp--aemsites.aem.live/fragments/pzn/financial-services')],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div>VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    await runExperiment(document);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/fragments/pzn/financial-services.plain.html',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(document.querySelector('main').innerHTML).toContain('VARIATION');
  });

  it('is a no-op when not enabled', async () => {
    await runExperiment(document);
    expect(fetchDecision).not.toHaveBeenCalled();
    expect(document.querySelector('main').innerHTML).toContain('BASE');
  });

  it('appends the ivid (from the cookie) to the ixp query when present', async () => {
    document.cookie = 'ivid=cookie-abc';
    try {
      setMeta('experiment-id', '385944');
      fetchDecision.mockResolvedValue({ assignments: [assignment({ control: true })] });
      await runExperiment(document);
      const [source] = fetchDecision.mock.calls[0];
      expect(source).toContain('experimentId=385944');
      expect(source).toContain('ivid=cookie-abc');
    } finally {
      document.cookie = 'ivid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });

  it('leaves the baseline on a control arm but still records the exposure (no replacement)', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [assignment({ control: true })] });
    await runExperiment(document);
    expect(document.querySelector('main').innerHTML).toContain('BASE');
    expect(window.appVars.ixpDetailsArr).toEqual([{
      experiment_id: 385944,
      experiment_version: 7,
      experiment_treatment: 39927,
      original_content_id: window.location.pathname,
    }]);
  });

  it('is a no-op (no fetchDecision call) when only bare experiment metadata is present', async () => {
    setMeta('experiment', 'true');
    await runExperiment(document);
    expect(fetchDecision).not.toHaveBeenCalled();
    expect(document.querySelector('main').innerHTML).toContain('BASE');
  });

  it('does not touch the page for a replace (block/section) assignment', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/x')] });
    await runExperiment(document);
    // Not a redirect ⇒ the whole-page path leaves <main> alone.
    expect(document.querySelector('main').innerHTML).toContain('BASE');
  });

  it('bounds the whole decision+swap chain with ONE shared deadline, so a hanging swap never clobbers the page late', async () => {
    vi.useFakeTimers();
    try {
      setMeta('experiment-id', '385944');
      fetchDecision.mockResolvedValue({ assignments: [redirectTo('/drafts/pzn/csr-variation')] });
      // A connection that never completes on its own; only the shared signal's
      // 'abort' settles it (mirrors real fetch + AbortSignal behavior).
      vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => new Promise((resolve, reject) => {
        if (options && options.signal) {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      }));

      const pending = runExperiment(document);
      await vi.advanceTimersByTimeAsync(1400);
      await pending;

      expect(document.querySelector('main').innerHTML).toContain('BASE');
      expect(document.querySelector('main').innerHTML).not.toContain('VARIATION');
    } finally {
      vi.useRealTimers();
    }
  });

  // The block-level click channel: the swapped <main> carries the experiment identity
  // as the data-* attributes the SBSEG click tracker walks ancestors for.
  it('stamps the experiment identity on <main> after a redirect swap', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [redirectTo('/drafts/pzn/csr-variation')] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div class="hero">VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    await runExperiment(document);

    const mainEl = document.querySelector('main');
    expect(mainEl.getAttribute('data-experiment-id')).toBe('385944');
    expect(mainEl.getAttribute('data-experiment-version')).toBe('7');
    expect(mainEl.getAttribute('data-treatment-id')).toBe('39927');
  });

  it('does not stamp <main> on a control arm (no swap)', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [assignment({ control: true })] });
    await runExperiment(document);
    expect(document.querySelector('main').hasAttribute('data-experiment-id')).toBe(false);
  });

  it('does not stamp <main> when the swap does not land', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ assignments: [redirectTo('/drafts/pzn/csr-variation')] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await runExperiment(document);
    expect(document.querySelector('main').hasAttribute('data-experiment-id')).toBe(false);
  });
});
