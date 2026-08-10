import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
}));

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
    expect(globalThis.fetch).toHaveBeenCalledWith('/drafts/pzn/csr-variation.plain.html');
    expect(document.querySelector('main').innerHTML).toContain('VARIATION');
    expect(document.querySelector('main').innerHTML).not.toContain('BASE');
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
});
