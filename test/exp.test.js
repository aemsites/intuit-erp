import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', async () => {
  const actual = await vi.importActual('../scripts/personalization/decision.js');
  return {
    fetchDecision: vi.fn(),
    fragmentPath: actual.fragmentPath,
    applyFragment: vi.fn().mockResolvedValue(true),
  };
});

// eslint-disable-next-line import/first
import {
  isExperimentEnabled, runExperiment, collectExperiments, runBlockExperiments,
} from '../scripts/exp.js';
// eslint-disable-next-line import/first
import { fetchDecision, applyFragment } from '../scripts/personalization/decision.js';
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
  // restoreMocks wipes the factory's mockResolvedValue before each test; re-arm the
  // applied-successfully default so applyFragment resolves like production.
  applyFragment.mockResolvedValue(true);
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

describe('collectExperiments', () => {
  function main(html) {
    const m = document.createElement('main');
    m.innerHTML = html;
    return m;
  }

  it('finds data-exp sections and reads the id verbatim; section fidelity by default', () => {
    const m = main('<div data-exp="Homepage_Hero"><p>base</p></div><div class="hero"></div>');
    const experiments = collectExperiments(m);
    expect(experiments).toHaveLength(1);
    expect(experiments[0].id).toBe('Homepage_Hero');
    expect(experiments[0].fidelity).toBe('section');
    expect(experiments[0].el).toBe(m.querySelector('[data-exp]'));
  });

  it('scopes to the named block (block fidelity) when data-exp-block is set', () => {
    const m = main('<div data-exp="385944" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    const experiments = collectExperiments(m);
    expect(experiments).toHaveLength(1);
    expect(experiments[0].fidelity).toBe('block');
    expect(experiments[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
  });

  it('matches the root section itself and honors { skip }', () => {
    const m = main('<div data-exp="a"></div><div data-exp="b"></div>');
    const first = m.querySelector('[data-exp]');
    expect(collectExperiments(first).map((e) => e.id)).toEqual(['a']);
    expect(collectExperiments(m, first).map((e) => e.id)).toEqual(['b']);
  });

  it('returns [] when there are no data-exp sections', () => {
    expect(collectExperiments(main('<div class="hero"></div>'))).toEqual([]);
  });
});

describe('runBlockExperiments', () => {
  function main(html) {
    const m = document.createElement('main');
    m.innerHTML = html;
    return m;
  }

  it('queries by label (non-numeric id) and applies a replace variation', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/fragments/exp/a')] });
    await runBlockExperiments(m);

    const [source] = fetchDecision.mock.calls[0];
    expect(source).toContain('ixp?');
    expect(source).toContain('label=Homepage_Hero');
    expect(source).not.toContain('fidelity=');
    expect(applyFragment).toHaveBeenCalledWith(m.querySelector('[data-exp]'), '/fragments/exp/a');
    expect(window.appVars.ixpDetailsArr).toHaveLength(1);
  });

  it('queries by experimentId (numeric id) for a block-scoped tag', async () => {
    const m = main('<div data-exp="385944" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/fragments/exp/a')] });
    await runBlockExperiments(m);
    const [source] = fetchDecision.mock.calls[0];
    expect(source).toContain('experimentId=385944');
    expect(applyFragment).toHaveBeenCalledWith(m.querySelector('[data-block-name="cards"]'), '/fragments/exp/a');
  });

  it('leaves the baseline on a control arm', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [assignment({ control: true })] });
    await runBlockExperiments(m);
    expect(applyFragment).not.toHaveBeenCalled();
  });

  it('ignores a redirect (page-level) assignment (that belongs to runExperiment)', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [redirectTo('/variation')] });
    await runBlockExperiments(m);
    expect(applyFragment).not.toHaveBeenCalled();
  });

  it('does nothing (no api call) when there are no data-exp sections', async () => {
    await runBlockExperiments(main('<div class="hero"></div>'));
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  // The block-level click channel: the injected target carries the experiment identity.
  it('stamps the experiment identity on the target after a replace', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/fragments/exp/a')] });
    await runBlockExperiments(m);
    const el = m.querySelector('[data-exp]');
    expect(el.getAttribute('data-experiment-id')).toBe('385944');
    expect(el.getAttribute('data-experiment-version')).toBe('7');
    expect(el.getAttribute('data-treatment-id')).toBe('39927');
  });

  it('stamps the named block, not the section, for a block-scoped experiment', async () => {
    const m = main('<div data-exp="385944" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/fragments/exp/a')] });
    await runBlockExperiments(m);
    const block = m.querySelector('[data-block-name="cards"]');
    expect(block.getAttribute('data-experiment-id')).toBe('385944');
    expect(block.getAttribute('data-treatment-id')).toBe('39927');
    expect(m.querySelector('[data-exp]').hasAttribute('data-experiment-id')).toBe(false);
  });

  it('does not stamp on a control arm (no injection)', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [assignment({ control: true })] });
    await runBlockExperiments(m);
    expect(m.querySelector('[data-exp]').hasAttribute('data-experiment-id')).toBe(false);
  });

  it('does not stamp when the injection does not land (applyFragment returns false)', async () => {
    const m = main('<div data-exp="Homepage_Hero"></div>');
    fetchDecision.mockResolvedValue({ assignments: [replaceWith('/fragments/exp/a')] });
    applyFragment.mockResolvedValueOnce(false);
    await runBlockExperiments(m);
    expect(m.querySelector('[data-exp]').hasAttribute('data-experiment-id')).toBe(false);
  });
});
