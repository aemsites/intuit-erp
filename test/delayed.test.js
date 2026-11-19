import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [],
  tealium: null,
  trackingFails: false,
}));

vi.mock('../scripts/scripts.js', () => ({
  getTealium: () => mocks.tealium,
  getExperienceTracking: async () => {
    if (mocks.trackingFails) throw new Error('pzn failed');
    mocks.calls.push('pzn-flushed');
  },
}));
vi.mock('../plugins/tealium-martech/src/index.js', () => ({
  whenConsentResolved: (fn) => { mocks.calls.push('consent-check'); fn(); },
}));
vi.mock('../scripts/of1-intent.js', () => ({
  initOf1Intent: () => mocks.calls.push('of1'),
}));

function fakeTealium({
  lazyFails = false, consentKnown = true, viewHeld = false, loadPhase = 'lazy',
} = {}) {
  let loadUtag;
  let sendView;
  const tealium = {
    enabled: true,
    loadPhase,
    utagReady: new Promise((resolve) => { loadUtag = resolve; }),
    viewSent: new Promise((resolve) => { sendView = resolve; }),
    lazy: vi.fn(async () => {
      mocks.calls.push('lazy');
      if (lazyFails) throw new Error('consent stack failed');
      if (consentKnown) {
        tealium.consentReady = true;
        if (loadPhase !== 'delayed') {
          loadUtag();
          if (!viewHeld) sendView();
        }
      }
    }),
    delayed: vi.fn(() => {
      mocks.calls.push('delayed');
      if (loadPhase === 'delayed') loadUtag();
    }),
  };
  tealium.loadUtag = () => { loadUtag(); sendView(); };
  tealium.sendView = sendView;
  return tealium;
}

async function runDelayed() {
  await import('../scripts/delayed.js');
  await vi.advanceTimersByTimeAsync(0);
}

describe('delayed.js martech order', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.calls = [];
    mocks.tealium = null;
    mocks.trackingFails = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.hlx;
  });

  it('flushes personalization, loads Tealium, starts OF1, then sends delayed_ready after a gap', async () => {
    mocks.tealium = fakeTealium();
    await runDelayed();
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy', 'consent-check', 'of1']);

    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.tealium.delayed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.calls.at(-1)).toBe('delayed');
  });

  it('keeps going when personalization tracking fails', async () => {
    mocks.tealium = fakeTealium();
    mocks.trackingFails = true;
    await runDelayed();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.calls).toEqual(['lazy', 'consent-check', 'of1', 'delayed']);
  });

  it('sends nothing more when the consent stack fails, since utag never loads', async () => {
    mocks.tealium = fakeTealium({ lazyFails: true });
    await runDelayed();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy']);
  });

  it('leaves OF1 off after a later consent decision, and keeps the gap after the initial view', async () => {
    mocks.tealium = fakeTealium({ consentKnown: false });
    await runDelayed();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy']);

    mocks.tealium.loadUtag();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy']);
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.tealium.delayed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.calls.at(-1)).toBe('delayed');
  });

  it('times delayed_ready from the initial view when Tealium consent holds it back', async () => {
    mocks.tealium = fakeTealium({ viewHeld: true });
    await runDelayed();
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy', 'consent-check', 'of1']);
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.tealium.delayed).not.toHaveBeenCalled();

    mocks.tealium.sendView();
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.tealium.delayed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.calls.at(-1)).toBe('delayed');
  });

  it('keeps the legacy delayed phase holding utag until delayed_ready', async () => {
    mocks.tealium = fakeTealium({ loadPhase: 'delayed' });
    await runDelayed();
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.calls).toEqual(['pzn-flushed', 'lazy', 'delayed', 'consent-check', 'of1']);
  });

  // The real consent gate gives up without utag.js, so this only checks the hand-off.
  it('hands OF1 to the consent gate and marks consent skipped when martech is off', async () => {
    const measure = vi.spyOn(performance, 'measure');
    await runDelayed();
    expect(mocks.calls).toEqual(['consent-check', 'of1']);
    expect(measure).toHaveBeenCalledWith('consent:skipped');
    measure.mockRestore();
  });

  it('does not mark consent skipped when martech runs', async () => {
    mocks.tealium = fakeTealium();
    const measure = vi.spyOn(performance, 'measure');
    await runDelayed();
    expect(measure).not.toHaveBeenCalledWith('consent:skipped');
    measure.mockRestore();
  });
});
