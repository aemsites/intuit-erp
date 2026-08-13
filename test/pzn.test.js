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
  it('finds data-pzn sections and reads the placement verbatim; whole-section target', () => {
    const m = main('<div data-pzn="sbsegQbmRetail"><p>base</p></div><div class="hero"></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].placement).toBe('sbsegQbmRetail');
    expect(slots[0].el).toBe(m.querySelector('[data-pzn]'));
  });

  it('scopes to the named block when data-pzn-block is set', () => {
    const m = main('<div data-pzn="x" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div><div class="hero" data-block-name="hero"></div></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
  });

  it('matches the root section itself', () => {
    const m = main('<div data-pzn="alpha"></div>');
    const section = m.querySelector('[data-pzn]');
    const slots = collectSlots(section);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(section);
  });

  it('excludes the skipped section', () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    const slots = collectSlots(m, first);
    expect(slots.map((s) => s.placement)).toEqual(['beta']);
  });

  it('drops a block-scoped tag whose block is not found', () => {
    const m = main('<div data-pzn="x" data-pzn-block="missing"><div class="hero" data-block-name="hero"></div></div>');
    expect(collectSlots(m)).toEqual([]);
  });

  it('returns [] when there are no data-pzn sections', () => {
    expect(collectSlots(main('<div class="hero"></div>'))).toEqual([]);
  });
});

describe('runPersonalization', () => {
  it('batches all placements into one /api/de call and applies each decision', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    fetchDecision.mockResolvedValue([
      { placement: 'ALPHA', action: 'replace', fidelity: 'block', fragment: 'fragments/pzn/a' },
    ]);
    await runPersonalization(m);

    expect(fetchDecision).toHaveBeenCalledTimes(1);
    const [source, opts] = fetchDecision.mock.calls[0];
    expect(source).toBe('de');
    expect(opts.method).toBe('POST');
    expect(opts.body.slots).toEqual([{ placement: 'alpha' }, { placement: 'beta' }]);

    // matched case-insensitively (decision ALPHA -> section alpha)
    expect(applyFragment).toHaveBeenCalledTimes(1);
    expect(applyFragment.mock.calls[0][0]).toBe(m.querySelector('[data-pzn="alpha"]'));
    expect(applyFragment.mock.calls[0][1]).toBe('fragments/pzn/a');
  });

  it('applies a block-scoped decision to the named block, not the section', async () => {
    const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    fetchDecision.mockResolvedValue([
      { placement: 'alpha', action: 'replace', fidelity: 'block', fragment: 'fragments/pzn/a' },
    ]);
    await runPersonalization(m);
    expect(applyFragment).toHaveBeenCalledWith(m.querySelector('[data-block-name="cards"]'), 'fragments/pzn/a');
  });

  it('applies a decision to every section sharing the same placement', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="alpha"></div>');
    fetchDecision.mockResolvedValue([
      { placement: 'alpha', action: 'replace', fidelity: 'block', fragment: 'fragments/pzn/a' },
    ]);
    await runPersonalization(m);
    // one deduped placement in the batch, applied to both sections
    expect(fetchDecision.mock.calls[0][1].body.slots).toEqual([{ placement: 'alpha' }]);
    expect(applyFragment).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no slots (no api call)', async () => {
    await runPersonalization(main('<div class="hero"></div>'));
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('leaves the baseline when the api returns null / empty', async () => {
    fetchDecision.mockResolvedValue(null);
    await runPersonalization(main('<div data-pzn="alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();
  });

  it('honors { skip } to exclude a section', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    fetchDecision.mockResolvedValue([]);
    await runPersonalization(m, { skip: first });
    expect(fetchDecision.mock.calls[0][1].body.slots).toEqual([{ placement: 'beta' }]);
  });
});
