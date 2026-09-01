import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

// The reporter lives behind `if (PERF_ON)` in experience.js, and PERF_ON is read from
// location.search at module load — so stub the search string, then import a fresh copy.
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

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: ORIGINAL_LOCATION, configurable: true, writable: true,
  });
  if (window.hlx) delete window.hlx.experiencePerf;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('experience perf reporter', () => {
  it('captures exp: measures via observer and dumps them via console.table when ?perf=on', async () => {
    stubLocation('?perf=on');
    performance.clearMarks?.();
    performance.clearMeasures?.();
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});

    // Import registers the observers; create the measure afterwards so the LIVE observer captures
    // it, then let the async observer callback flush before reporting.
    await import('../scripts/experience.js');
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
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});

    await import('../scripts/experience.js');
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

  it('does nothing without the flag', async () => {
    stubLocation('');
    await import('../scripts/experience.js');
    expect(window.hlx?.experiencePerf).toBeUndefined();
  });
});
