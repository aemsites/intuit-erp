import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

// PERF_ON is decided at module load, so stub location before importing a fresh copy.
const ORIGINAL_LOCATION = window.location;

function stubLocation(search) {
  Object.defineProperty(window, 'location', {
    value: {
      href: ORIGINAL_LOCATION.href,
      origin: ORIGINAL_LOCATION.origin,
      protocol: ORIGINAL_LOCATION.protocol,
      host: ORIGINAL_LOCATION.host,
      hostname: ORIGINAL_LOCATION.hostname,
      pathname: ORIGINAL_LOCATION.pathname,
      hash: '',
      search,
    },
    configurable: true,
    writable: true,
  });
}

// jsdom has no PerformanceObserver — stub so the reporter IIFE can register.
function installPerformanceObserverMock() {
  if (globalThis.PerformanceObserver?.__experiencePerfMock) return;
  const observers = [];
  globalThis.PerformanceObserver = class {
    static __experiencePerfMock = true;

    constructor(callback) {
      this.callback = callback;
      this.types = [];
      observers.push(this);
    }

    observe({ type } = {}) {
      if (type) this.types.push(type);
    }

    disconnect() { /* no-op */ }

    static notify(type, entry) {
      observers.forEach((o) => {
        if (o.types.includes(type)) o.callback({ getEntries: () => [entry] });
      });
    }
  };
}

function hookMeasureObserver() {
  const orig = performance.measure.bind(performance);
  vi.spyOn(performance, 'measure').mockImplementation((name, ...args) => {
    const entry = orig(name, ...args);
    globalThis.PerformanceObserver.notify('measure', entry);
    return entry;
  });
}

// PERF_ENABLED is decided at module load via Math.random() < PERF_SAMPLE_RATE.
function stubSampled(sampled = true) {
  vi.spyOn(Math, 'random').mockReturnValue(sampled ? 0 : 0.99);
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: ORIGINAL_LOCATION, configurable: true, writable: true,
  });
  if (window.hlx) delete window.hlx.experiencePerf;
  delete window.coreServiceAdapter;
  delete globalThis.PerformanceObserver;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('experience perf reporter', () => {
  it('captures exp: measures via observer and dumps them via console.table when ?perf=on', async () => {
    stubLocation('?perf=on');
    installPerformanceObserverMock();
    performance.clearMarks?.();
    performance.clearMeasures?.();
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});

    // Import registers the observers; create the measure afterwards so the LIVE observer captures
    // it, then let the async observer callback flush before reporting.
    await import('../scripts/experience.js');
    hookMeasureObserver();
    performance.mark('exp:demo:start');
    performance.mark('exp:demo:end');
    performance.measure('exp:demo', 'exp:demo:start', 'exp:demo:end');
    await new Promise((r) => { setTimeout(r, 20); });

    expect(typeof window.hlx.experiencePerf.report).toBe('function');
    const rows = window.hlx.experiencePerf.report();
    expect(rows).toHaveProperty('exp:demo');
    expect(rows['exp:demo']).toHaveProperty('ms');
    expect(table).toHaveBeenCalled();
  });

  it('survives a resource-timing buffer clear (data captured live, not read from the buffer)', async () => {
    stubLocation('?perf=on');
    installPerformanceObserverMock();
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});

    await import('../scripts/experience.js');
    hookMeasureObserver();
    performance.mark('exp:kept:start');
    performance.mark('exp:kept:end');
    performance.measure('exp:kept', 'exp:kept:start', 'exp:kept:end');
    await new Promise((r) => { setTimeout(r, 20); });
    // Simulate a martech/RUM script wiping the shared timeline after our entry fired.
    performance.clearMeasures?.();
    performance.clearMarks?.();

    const rows = window.hlx.experiencePerf.report();
    expect(rows).toHaveProperty('exp:kept'); // still present — captured live, not re-read
    expect(table).toHaveBeenCalled();
  });

  it('captures consent-window and privacy-safe layout-shift attribution', async () => {
    stubLocation('?perf=on');
    installPerformanceObserverMock();
    vi.spyOn(console, 'table').mockImplementation(() => {});
    await import('../scripts/experience.js');

    const banner = document.createElement('div');
    banner.id = 'onetrust-banner-sdk';
    globalThis.PerformanceObserver.notify('measure', {
      name: 'consent:total', startTime: 100, duration: 200,
    });
    globalThis.PerformanceObserver.notify('layout-shift', {
      startTime: 150,
      value: 0.015,
      hadRecentInput: false,
      sources: [{ node: banner }],
    });
    globalThis.PerformanceObserver.notify('measure', { name: 'exp:skip-in-use', startTime: 0, duration: 400 });

    expect(window.hlx.experiencePerf.collect()).toMatchObject({
      inUseSkips: 1,
      consentTotalMs: 200,
      cls: 0.015,
      onetrustDirectShift: 0.015,
      consentWindowShift: 0.015,
      topLayoutShiftSource: 'div#onetrust-banner-sdk',
    });
  });

  it('installs collection on sampled page views (console report remains ?perf=on only)', async () => {
    stubLocation('');
    stubSampled(true);
    installPerformanceObserverMock();
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});
    await import('../scripts/experience.js');
    expect(typeof window.hlx.experiencePerf.report).toBe('function');
    expect(typeof window.hlx.experiencePerf.collect).toBe('function');
    expect(window.hlx.experiencePerf.collect()).toMatchObject({ event: 'experience-perf' });
    expect(table).not.toHaveBeenCalled();
  });

  it('skips collection on unsampled page views', async () => {
    stubLocation('');
    stubSampled(false);
    installPerformanceObserverMock();
    await import('../scripts/experience.js');
    expect(window.hlx?.experiencePerf).toBeUndefined();
  });

  it('sends experience-perf to Splunk on sampled page views', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - t0);
    stubLocation('');
    stubSampled(true);
    installPerformanceObserverMock();
    const info = vi.fn();
    window.coreServiceAdapter = { logger: { info } };
    await import('../scripts/experience.js');
    globalThis.PerformanceObserver.notify('measure', {
      name: 'consent:total', startTime: 3000, duration: 800,
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(info).toHaveBeenCalledWith('experience-perf', expect.objectContaining({
      event: 'experience-perf',
      sampleRate: 0.1,
      consentTotalMs: 800,
    }));
    vi.useRealTimers();
  });

  it('holds the Splunk report for a consent stack that finishes after 6 s, up to a cap', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - t0);
    try {
      stubLocation('');
      stubSampled(true);
      installPerformanceObserverMock();
      const info = vi.fn();
      window.coreServiceAdapter = { logger: { info } };
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(8000);
      expect(info).not.toHaveBeenCalled();
      globalThis.PerformanceObserver.notify('measure', {
        name: 'consent:total', startTime: 7000, duration: 1000,
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(info).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(info).toHaveBeenCalledOnce();
      expect(info.mock.calls[0][1]).toMatchObject({ consentTotalMs: 1000 });
      await vi.advanceTimersByTimeAsync(20000);
      expect(info).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the full consent render tail when consent finishes just before 6 s', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - t0);
    try {
      stubLocation('');
      stubSampled(true);
      installPerformanceObserverMock();
      const info = vi.fn();
      window.coreServiceAdapter = { logger: { info } };
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(5900);
      globalThis.PerformanceObserver.notify('measure', {
        name: 'consent:total', startTime: 4900, duration: 1000,
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(info).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(info).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the Splunk report at the cap, or when the page is hidden after 6 s', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - t0);
    try {
      stubLocation('');
      stubSampled(true);
      installPerformanceObserverMock();
      const info = vi.fn();
      window.coreServiceAdapter = { logger: { info } };
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(2000);
      window.dispatchEvent(new Event('pagehide'));
      expect(info).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(17999);
      expect(info).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(info).toHaveBeenCalledOnce();

      vi.resetModules();
      info.mockClear();
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(7000);
      expect(info).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('pagehide'));
      expect(info).toHaveBeenCalledWith('experience-perf', expect.anything());

      vi.resetModules();
      info.mockClear();
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(7000);
      expect(info).not.toHaveBeenCalled();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(info).toHaveBeenCalledWith('experience-perf', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends at 6 s when martech is off and no consent stack will load', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - t0);
    try {
      stubLocation('');
      stubSampled(true);
      installPerformanceObserverMock();
      const info = vi.fn();
      window.coreServiceAdapter = { logger: { info } };
      await import('../scripts/experience.js');
      await vi.advanceTimersByTimeAsync(3000);
      globalThis.PerformanceObserver.notify('measure', {
        name: 'consent:skipped', startTime: 0, duration: 3000,
      });
      await vi.advanceTimersByTimeAsync(2999);
      expect(info).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(info).toHaveBeenCalledOnce();
      expect(info.mock.calls[0][1].consentTotalMs).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
