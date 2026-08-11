import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', async () => {
  const actual = await vi.importActual('../scripts/personalization/decision.js');
  return { fetchDecision: vi.fn(), fragmentPath: actual.fragmentPath };
});

// eslint-disable-next-line import/first
import { isExperimentEnabled, runExperiment } from '../scripts/exp.js';
// eslint-disable-next-line import/first
import { fetchDecision } from '../scripts/personalization/decision.js';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<main><div class="hero">BASE</div></main>';
});
afterEach(() => vi.restoreAllMocks());

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
  it('swaps <main> with the variation plain.html on a page decision', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ action: 'replace', fidelity: 'page', fragment: '/drafts/pzn/csr-variation' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div class="hero">VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    await runExperiment(document);

    const [source] = fetchDecision.mock.calls[0];
    expect(source).toContain('ixp?');
    expect(source).toContain('experimentId=385944');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/drafts/pzn/csr-variation.plain.html',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(document.querySelector('main').innerHTML).toContain('VARIATION');
    expect(document.querySelector('main').innerHTML).not.toContain('BASE');
  });

  it('fetches the same-origin pathname (not a doubled URL) when the variation fragment is an absolute URL', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({
      action: 'replace',
      fidelity: 'page',
      fragment: 'https://main--intuit-erp--aemsites.aem.live/fragments/pzn/financial-services',
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

  it('leaves the baseline on a control decision', async () => {
    setMeta('experiment-id', '385944');
    fetchDecision.mockResolvedValue({ control: true });
    await runExperiment(document);
    expect(document.querySelector('main').innerHTML).toContain('BASE');
  });

  it('is a no-op (no fetchDecision call) when only bare experiment metadata is present', async () => {
    setMeta('experiment', 'true');
    await runExperiment(document);
    expect(fetchDecision).not.toHaveBeenCalled();
    expect(document.querySelector('main').innerHTML).toContain('BASE');
  });

  it('bounds the whole decision+swap chain with ONE shared deadline, so a hanging swap never clobbers the page late', async () => {
    vi.useFakeTimers();
    try {
      setMeta('experiment-id', '385944');
      fetchDecision.mockResolvedValue({ action: 'replace', fidelity: 'page', fragment: '/drafts/pzn/csr-variation' });
      // Simulates a connection that is accepted but never completes on its own:
      // the promise only settles if the shared controller's signal fires 'abort'
      // (mirrors real fetch+AbortSignal behavior).
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
});
