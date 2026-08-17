import { describe, it, expect } from 'vitest';
import { stampPzn, stampExperiment } from '../scripts/personalization/stamp.js';

function el() {
  return document.createElement('div');
}

describe('stampExperiment', () => {
  it('mirrors the experiment fields to data-experiment-id/-version + data-treatment-id', () => {
    const d = el();
    stampExperiment(d, { experiment_id: 385944, experiment_version: 7, experiment_treatment: 39927 });
    expect(d.getAttribute('data-experiment-id')).toBe('385944');
    expect(d.getAttribute('data-experiment-version')).toBe('7');
    expect(d.getAttribute('data-treatment-id')).toBe('39927');
  });

  it('omits attributes whose source value is missing/empty (never writes a blank attr)', () => {
    const d = el();
    stampExperiment(d, { experiment_id: 385944, experiment_version: undefined, experiment_treatment: '' });
    expect(d.getAttribute('data-experiment-id')).toBe('385944');
    expect(d.hasAttribute('data-experiment-version')).toBe(false);
    expect(d.hasAttribute('data-treatment-id')).toBe(false);
  });

  it('keeps a legitimate 0 (only undefined/null/"" are dropped)', () => {
    const d = el();
    stampExperiment(d, { experiment_id: 0, experiment_version: 7, experiment_treatment: 39927 });
    expect(d.getAttribute('data-experiment-id')).toBe('0');
  });

  it('is a no-op for a null element or null record', () => {
    expect(() => stampExperiment(null, { experiment_id: 1 })).not.toThrow();
    const d = el();
    stampExperiment(d, null);
    expect(d.hasAttribute('data-experiment-id')).toBe(false);
  });
});

describe('stampPzn', () => {
  it('stamps placement + id and any experiment identity on the same record', () => {
    const d = el();
    stampPzn(d, {
      personalization_placement: 'sbsegQbmRetail',
      personalization_id: 'rec-1',
      experiment_id: 385944,
      experiment_version: 7,
      experiment_treatment: 39927,
    });
    expect(d.getAttribute('data-pzn-placement')).toBe('sbsegQbmRetail');
    expect(d.getAttribute('data-pzn-id')).toBe('rec-1');
    expect(d.getAttribute('data-experiment-id')).toBe('385944');
    expect(d.getAttribute('data-experiment-version')).toBe('7');
    expect(d.getAttribute('data-treatment-id')).toBe('39927');
  });

  it('stamps only placement + id when the offer carries no experiment', () => {
    const d = el();
    stampPzn(d, { personalization_placement: 'p', personalization_id: 'rec-1' });
    expect(d.getAttribute('data-pzn-placement')).toBe('p');
    expect(d.getAttribute('data-pzn-id')).toBe('rec-1');
    expect(d.hasAttribute('data-experiment-id')).toBe(false);
  });
});
