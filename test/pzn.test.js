import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
  applyFragment: vi.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { collectSlots, runPersonalization } from '../scripts/pzn.js';
// eslint-disable-next-line import/first
import { fetchDecision, applyFragment } from '../scripts/personalization/decision.js';

afterEach(() => vi.clearAllMocks());

function main(html) {
  const m = document.createElement('main');
  m.innerHTML = html;
  return m;
}

describe('collectSlots', () => {
  it('finds pzn-<placement> elements and extracts the placement', () => {
    const m = main('<div class="pzn-mktgplacement block"><p>base</p></div><div class="hero"></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].placement).toBe('mktgplacement');
    expect(slots[0].el.classList.contains('pzn-mktgplacement')).toBe(true);
  });

  it('returns [] when there are no pzn- slots', () => {
    expect(collectSlots(main('<div class="hero"></div>'))).toEqual([]);
  });
});

describe('runPersonalization', () => {
  it('batches all placements into one /api/de call and applies each decision', async () => {
    const m = main('<div class="pzn-alpha"></div><div class="pzn-beta"></div>');
    fetchDecision.mockResolvedValue([
      { placement: 'ALPHA', action: 'replace', fidelity: 'block', fragment: 'fragments/pzn/a' },
    ]);
    await runPersonalization(m);

    expect(fetchDecision).toHaveBeenCalledTimes(1);
    const [source, opts] = fetchDecision.mock.calls[0];
    expect(source).toBe('de');
    expect(opts.method).toBe('POST');
    expect(opts.body.slots).toEqual([{ placement: 'alpha' }, { placement: 'beta' }]);

    // matched case-insensitively (decision ALPHA -> slot alpha)
    expect(applyFragment).toHaveBeenCalledTimes(1);
    expect(applyFragment.mock.calls[0][0]).toBe(m.querySelector('.pzn-alpha'));
    expect(applyFragment.mock.calls[0][1]).toBe('fragments/pzn/a');
  });

  it('does nothing when there are no slots (no api call)', async () => {
    await runPersonalization(main('<div class="hero"></div>'));
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('leaves the baseline when the api returns null / empty', async () => {
    fetchDecision.mockResolvedValue(null);
    await runPersonalization(main('<div class="pzn-alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();
  });
});
