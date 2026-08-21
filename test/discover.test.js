import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/byo.js', () => ({
  resolveDecisions: vi.fn(),
  getAssignment: vi.fn(),
  renderDecision: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  collectPznEntries, collectExpTargets, dispatchAuthoredPersonalization, dispatchAuthoredExperiments,
} from '../scripts/personalization/discover.js';
// eslint-disable-next-line import/first
import { resolveDecisions, getAssignment, renderDecision } from '../scripts/personalization/byo.js';

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectPznEntries', () => {
  it('collects a whole-section data-pzn target', () => {
    document.body.innerHTML = '<main><div data-pzn="hero-slot"><div><div><h2>Default</h2></div></div></div></main>';
    const main = document.querySelector('main');
    const section = document.querySelector('[data-pzn]');
    const [entry] = collectPznEntries(main);
    expect(entry.el).toBe(section);
    expect(entry.placement).toBe('hero-slot');
    expect(typeof entry.selector).toBe('string');
  });

  it('scopes to the block whose class matches data-pzn-block, not the whole section', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot" data-pzn-block="pzn-hero">
          <div><div class="pzn-hero"><div>Default hero</div></div></div>
        </div>
      </main>`;
    const target = document.querySelector('.pzn-hero');
    const [entry] = collectPznEntries(document.querySelector('main'));
    expect(entry.el).toBe(target);
  });

  it('matches a block by class even after decoration adds extra classes (e.g. "block")', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot" data-pzn-block="pzn-hero">
          <div><div class="pzn-hero block" data-block-name="pzn-hero">Decorated</div></div>
        </div>
      </main>`;
    const target = document.querySelector('.pzn-hero');
    const [entry] = collectPznEntries(document.querySelector('main'));
    expect(entry.el).toBe(target);
  });

  it('treats the root itself as a candidate when it carries data-pzn (the eager, single-section call)', () => {
    document.body.innerHTML = '<div data-pzn="hero-slot"><div>content</div></div>';
    const section = document.body.firstElementChild;
    const [entry] = collectPznEntries(section);
    expect(entry.el).toBe(section);
  });

  it('excludes a `skip` element and its subtree (the lazy, rest-of-page call)', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot"><div>hero</div></div>
        <div data-pzn="offer-slot"><div>offer</div></div>
      </main>`;
    const main = document.querySelector('main');
    const skip = main.children[0];
    const entries = collectPznEntries(main, skip);
    expect(entries).toHaveLength(1);
    expect(entries[0].placement).toBe('offer-slot');
  });

  it('drops a pzn target that also carries data-exp on the SAME whole-section target (IXP wins)', () => {
    document.body.innerHTML = '<main><div data-pzn="hero-slot" data-exp="exp-1"><div>x</div></div></main>';
    expect(collectPznEntries(document.querySelector('main'))).toHaveLength(0);
  });

  it('drops a pzn target that also carries data-exp scoped to the SAME block (IXP wins)', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot" data-pzn-block="pzn-hero" data-exp="exp-1" data-exp-block="pzn-hero">
          <div><div class="pzn-hero">x</div></div>
        </div>
      </main>`;
    expect(collectPznEntries(document.querySelector('main'))).toHaveLength(0);
  });

  it('keeps a pzn target independent when data-exp is scoped to a DIFFERENT block in the same section', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot" data-pzn-block="pzn-hero" data-exp="exp-1" data-exp-block="pzn-offer">
          <div><div class="pzn-hero">hero</div></div>
          <div><div class="pzn-offer">offer</div></div>
        </div>
      </main>`;
    const entries = collectPznEntries(document.querySelector('main'));
    expect(entries).toHaveLength(1);
    expect(entries[0].el).toBe(document.querySelector('.pzn-hero'));
  });

  it('mints a distinct selector per entry', () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot"><div>hero</div></div>
        <div data-pzn="offer-slot"><div>offer</div></div>
      </main>`;
    const [a, b] = collectPznEntries(document.querySelector('main'));
    expect(a.selector).not.toBe(b.selector);
  });

  it('skips a section with an empty/missing data-pzn value', () => {
    document.body.innerHTML = '<main><div data-pzn=""><div>x</div></div></main>';
    expect(collectPznEntries(document.querySelector('main'))).toHaveLength(0);
  });
});

describe('collectExpTargets', () => {
  it('collects a whole-section data-exp target', () => {
    document.body.innerHTML = '<main><div data-exp="exp-1"><div>content</div></div></main>';
    const section = document.querySelector('[data-exp]');
    const [target] = collectExpTargets(document.querySelector('main'));
    expect(target.el).toBe(section);
    expect(target.id).toBe('exp-1');
  });

  it('scopes to the block whose class matches data-exp-block', () => {
    document.body.innerHTML = `
      <main>
        <div data-exp="exp-1" data-exp-block="cards">
          <div><div class="cards"><div>a</div></div></div>
        </div>
      </main>`;
    const target = document.querySelector('.cards');
    const [entry] = collectExpTargets(document.querySelector('main'));
    expect(entry.el).toBe(target);
  });

  it('treats the root itself as a candidate when it carries data-exp', () => {
    document.body.innerHTML = '<div data-exp="exp-1"><div>content</div></div>';
    const section = document.body.firstElementChild;
    const [target] = collectExpTargets(section);
    expect(target.el).toBe(section);
  });

  it('collects multiple independent data-exp targets across the whole root in one pass', () => {
    document.body.innerHTML = `
      <main>
        <div data-exp="exp-1"><div>a</div></div>
        <div data-exp="exp-2"><div>b</div></div>
      </main>`;
    const targets = collectExpTargets(document.querySelector('main'));
    expect(targets.map((t) => t.id)).toEqual(['exp-1', 'exp-2']);
  });
});

describe('dispatchAuthoredPersonalization', () => {
  it('is a no-op when nothing carries data-pzn', async () => {
    document.body.innerHTML = '<main><div><p>plain content</p></div></main>';
    await dispatchAuthoredPersonalization(document.querySelector('main'));
    expect(resolveDecisions).not.toHaveBeenCalled();
    expect(renderDecision).not.toHaveBeenCalled();
  });

  it('resolves every discovered entry in ONE batched resolveDecisions call, then applies via renderDecision (fragment scope)', async () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot"><div>hero</div></div>
        <div data-pzn="offer-slot"><div>offer</div></div>
      </main>`;
    resolveDecisions.mockImplementation(async (entries) => Object.fromEntries(
      entries.map((e) => [e.selector, { url: `/fragments/pzn/${e.placement}` }]),
    ));

    await dispatchAuthoredPersonalization(document.querySelector('main'));

    expect(resolveDecisions).toHaveBeenCalledTimes(1);
    const [entriesArg] = resolveDecisions.mock.calls[0];
    expect(entriesArg.map((e) => e.placement)).toEqual(['hero-slot', 'offer-slot']);

    expect(renderDecision).toHaveBeenCalledTimes(2);
    const heroSection = document.querySelectorAll('[data-pzn]')[0];
    const offerSection = document.querySelectorAll('[data-pzn]')[1];
    expect(renderDecision).toHaveBeenCalledWith(heroSection, expect.objectContaining({
      url: '/fragments/pzn/hero-slot', scope: 'fragment',
    }));
    expect(renderDecision).toHaveBeenCalledWith(offerSection, expect.objectContaining({
      url: '/fragments/pzn/offer-slot', scope: 'fragment',
    }));
  });

  it('still calls renderDecision (fail-open, no url) for an entry resolveDecisions did not answer', async () => {
    document.body.innerHTML = '<main><div data-pzn="hero-slot"><div>hero</div></div></main>';
    resolveDecisions.mockResolvedValue({});

    await dispatchAuthoredPersonalization(document.querySelector('main'));

    expect(renderDecision).toHaveBeenCalledTimes(1);
    const [, decision] = renderDecision.mock.calls[0];
    expect(decision.url).toBeUndefined();
  });

  it('respects skip so a lazy pass never re-dispatches the eager section', async () => {
    document.body.innerHTML = `
      <main>
        <div data-pzn="hero-slot"><div>hero</div></div>
        <div data-pzn="offer-slot"><div>offer</div></div>
      </main>`;
    resolveDecisions.mockResolvedValue({});
    const main = document.querySelector('main');
    const eagerSection = main.children[0];

    await dispatchAuthoredPersonalization(main, { skip: eagerSection });

    const [entriesArg] = resolveDecisions.mock.calls[0];
    expect(entriesArg).toHaveLength(1);
    expect(entriesArg[0].placement).toBe('offer-slot');
  });

  it('fails open (never throws, never calls renderDecision) when resolveDecisions rejects', async () => {
    document.body.innerHTML = '<main><div data-pzn="hero-slot"><div>hero</div></div></main>';
    resolveDecisions.mockRejectedValue(new Error('boom'));

    await expect(dispatchAuthoredPersonalization(document.querySelector('main'))).resolves.toBeUndefined();
    expect(renderDecision).not.toHaveBeenCalled();
  });

  it('is bounded — resolves even when resolveDecisions never settles', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<main><div data-pzn="hero-slot"><div>hero</div></div></main>';
      resolveDecisions.mockImplementation(() => new Promise(() => {}));

      const pending = dispatchAuthoredPersonalization(document.querySelector('main'));
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toBeUndefined();
      expect(renderDecision).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dispatchAuthoredExperiments', () => {
  it('is a no-op when nothing carries data-exp', async () => {
    document.body.innerHTML = '<main><div><p>plain content</p></div></main>';
    await dispatchAuthoredExperiments(document.querySelector('main'));
    expect(getAssignment).not.toHaveBeenCalled();
    expect(renderDecision).not.toHaveBeenCalled();
  });

  it('calls getAssignment per target then renderDecision with section scope', async () => {
    document.body.innerHTML = '<main><div data-exp="exp-1"><div>hero</div></div></main>';
    getAssignment.mockResolvedValue('challenger-1');

    await dispatchAuthoredExperiments(document.querySelector('main'));

    expect(getAssignment).toHaveBeenCalledWith('exp-1');
    expect(renderDecision).toHaveBeenCalledWith(document.querySelector('[data-exp]'), {
      scope: 'section',
      config: { id: 'exp-1' },
    });
  });

  it('dispatches every distinct data-exp target across the whole root in one pass', async () => {
    document.body.innerHTML = `
      <main>
        <div data-exp="exp-1"><div>a</div></div>
        <div data-exp="exp-2"><div>b</div></div>
      </main>`;
    getAssignment.mockResolvedValue(null);

    await dispatchAuthoredExperiments(document.querySelector('main'));

    expect(getAssignment).toHaveBeenCalledWith('exp-1');
    expect(getAssignment).toHaveBeenCalledWith('exp-2');
    expect(renderDecision).toHaveBeenCalledTimes(2);
  });

  it('still calls renderDecision (fail-open, section scope) even when getAssignment self-buckets (null)', async () => {
    document.body.innerHTML = '<main><div data-exp="exp-1"><div>hero</div></div></main>';
    getAssignment.mockResolvedValue(null);

    await dispatchAuthoredExperiments(document.querySelector('main'));

    expect(renderDecision).toHaveBeenCalledWith(document.querySelector('[data-exp]'), {
      scope: 'section',
      config: { id: 'exp-1' },
    });
  });

  it('fails open (never throws, never calls renderDecision) when getAssignment rejects', async () => {
    document.body.innerHTML = '<main><div data-exp="exp-1"><div>hero</div></div></main>';
    getAssignment.mockRejectedValue(new Error('boom'));

    await expect(dispatchAuthoredExperiments(document.querySelector('main'))).resolves.toBeUndefined();
    expect(renderDecision).not.toHaveBeenCalled();
  });

  it('is bounded — resolves even when getAssignment never settles', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<main><div data-exp="exp-1"><div>hero</div></div></main>';
      getAssignment.mockImplementation(() => new Promise(() => {}));

      const pending = dispatchAuthoredExperiments(document.querySelector('main'));
      await vi.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toBeUndefined();
      expect(renderDecision).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
