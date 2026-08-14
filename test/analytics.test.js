import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  ensureAppVars, recordPzn, recordIxp, flushAppVars, resetAnalytics,
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

  it('serializes pznData + pznRecDetailsArr and sets pznPageRecDetailsArr to "[]"', () => {
    recordPzn([rec('a')]);
    expect(window.appVars.pznData).toEqual([rec('a')]);
    expect(JSON.parse(window.appVars.pznRecDetailsArr)).toEqual([rec('a')]);
    expect(window.appVars.pznPageRecDetailsArr).toBe('[]');
  });

  it('accumulates across calls (phases) and dedups by personalization_id', () => {
    recordPzn([rec('a')]);
    recordPzn([rec('a'), rec('b')]); // 'a' repeats
    expect(JSON.parse(window.appVars.pznRecDetailsArr)).toEqual([rec('a'), rec('b')]);
  });
});

describe('recordIxp', () => {
  const rec = (id) => ({ experiment_id: id, experiment_treatment: id * 10 });

  it('serializes ixpDetailsArr and dedups by experiment_id across phases', () => {
    recordIxp([rec(1)]);
    recordIxp([rec(1), rec(2)]);
    expect(JSON.parse(window.appVars.ixpDetailsArr)).toEqual([rec(1), rec(2)]);
  });

  it('skips null/undefined records', () => {
    recordIxp([null, rec(3), undefined]);
    expect(JSON.parse(window.appVars.ixpDetailsArr)).toEqual([rec(3)]);
  });
});

describe('flushAppVars', () => {
  it('is idempotent and reflects the current buffers', () => {
    recordPzn([{ personalization_id: 'a' }]);
    flushAppVars();
    flushAppVars();
    expect(JSON.parse(window.appVars.pznRecDetailsArr)).toHaveLength(1);
  });
});
