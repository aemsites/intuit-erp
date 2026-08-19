import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  ensureAppVars, recordPzn, recordPznPage, recordIxp, flushAppVars, resetAnalytics,
} from '../scripts/personalization/analytics.js';

beforeEach(() => {
  resetAnalytics();
  delete window.appVars;
  // Make the idle-deferred flush run synchronously for deterministic assertions.
  window.requestIdleCallback = (cb) => { cb(); return 0; };
});
afterEach(() => {
  delete window.requestIdleCallback;
  resetAnalytics();
  delete window.appVars;
});

describe('ensureAppVars', () => {
  it('creates window.appVars when absent and reuses it when present', () => {
    const created = ensureAppVars();
    expect(created).toBe(window.appVars);
    window.appVars.existing = 1;
    expect(ensureAppVars()).toBe(created);
    expect(window.appVars.existing).toBe(1);
  });
});

describe('recordPzn', () => {
  const rec = (id) => ({ personalization_id: id, content_id: `c-${id}` });

  it('emits pznRecDetailsArr as a real array and pznPageRecDetailsArr as []', () => {
    recordPzn([rec('a')]);
    expect(Array.isArray(window.appVars.pznRecDetailsArr)).toBe(true);
    expect(window.appVars.pznRecDetailsArr).toEqual([rec('a')]);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([]);
    // the legacy JSON-string twin (pznData) is no longer emitted
    expect(window.appVars.pznData).toBeUndefined();
  });

  it('accumulates across calls (phases) and dedups by personalization_id', () => {
    recordPzn([rec('a')]);
    recordPzn([rec('a'), rec('b')]); // 'a' repeats
    expect(window.appVars.pznRecDetailsArr).toEqual([rec('a'), rec('b')]);
  });
});

describe('recordPznPage', () => {
  const rec = (id) => ({ personalization_id: id, content_id: `c-${id}` });

  it('emits pznPageRecDetailsArr as its own real array, independent of block/section pzn', () => {
    recordPzn([rec('block')]);
    recordPznPage([rec('page')]);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([rec('page')]);
    expect(window.appVars.pznRecDetailsArr).toEqual([rec('block')]);
  });

  it('accumulates across phases and dedups by personalization_id', () => {
    recordPznPage([rec('page')]);
    recordPznPage([rec('page'), rec('other')]); // 'page' repeats
    expect(window.appVars.pznPageRecDetailsArr).toEqual([rec('page'), rec('other')]);
  });

  it('is cleared by resetAnalytics', () => {
    recordPznPage([rec('page')]);
    resetAnalytics();
    flushAppVars();
    expect(window.appVars.pznPageRecDetailsArr).toEqual([]);
  });
});

describe('recordIxp', () => {
  const rec = (id) => ({ experiment_id: id, experiment_treatment: id * 10 });

  it('emits ixpDetailsArr as a real array and dedups by experiment_id across phases', () => {
    recordIxp([rec(1)]);
    recordIxp([rec(1), rec(2)]);
    expect(Array.isArray(window.appVars.ixpDetailsArr)).toBe(true);
    expect(window.appVars.ixpDetailsArr).toEqual([rec(1), rec(2)]);
  });

  it('skips null/undefined records', () => {
    recordIxp([null, rec(3), undefined]);
    expect(window.appVars.ixpDetailsArr).toEqual([rec(3)]);
  });
});

describe('flushAppVars', () => {
  it('is idempotent and reflects the current buffers', () => {
    recordPzn([{ personalization_id: 'a' }]);
    flushAppVars();
    flushAppVars();
    expect(window.appVars.pznRecDetailsArr).toHaveLength(1);
  });
});
