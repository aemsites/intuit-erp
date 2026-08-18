import { describe, it, expect } from 'vitest';
import { stampCta, stampTracking } from '../scripts/tracking/stamp.js';

const el = () => document.createElement('a');

describe('stampCta', () => {
  it('writes managed attributes, including an empty ui-access-point (opt-in)', () => {
    const a = el();
    stampCta(a, {
      'data-object': 'content', 'data-ui-object': 'button', 'data-ui-access-point': '', 'data-tracking': 'button',
    });
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object')).toBe('button');
    expect(a.getAttribute('data-tracking')).toBe('button');
    expect(a.hasAttribute('data-ui-access-point')).toBe(true);
    expect(a.getAttribute('data-ui-access-point')).toBe('');
  });

  it('is idempotent and removes managed attrs absent from the new map (wa-link correction)', () => {
    const a = el();
    // sync derived pass: full path
    stampCta(a, { 'data-object': 'content', 'data-ui-object': 'button', 'data-tracking': 'button' });
    expect(a.hasAttribute('data-object')).toBe(true);
    // async sheet pass: resolves to the wa-link path -> object must go away
    stampCta(a, { 'data-wa-link': 'ies:demo', 'data-tracking': 'button' });
    expect(a.hasAttribute('data-object')).toBe(false);
    expect(a.getAttribute('data-wa-link')).toBe('ies:demo');
  });

  it('adds survey attributes (additive)', () => {
    const a = el();
    stampCta(a, { 'data-tracking': 'button', 'data-survey-name': 'nps' });
    expect(a.getAttribute('data-survey-name')).toBe('nps');
  });

  it('is a no-op for a null element or null attrs', () => {
    expect(() => stampCta(null, { 'data-object': 'x' })).not.toThrow();
    const a = el();
    stampCta(a, null);
    expect(a.hasAttribute('data-object')).toBe(false);
  });
});

describe('stampTracking', () => {
  it('stamps a data-tracking segment on a block/section', () => {
    const d = document.createElement('div');
    stampTracking(d, 'cta_block');
    expect(d.getAttribute('data-tracking')).toBe('cta_block');
  });
  it('is a no-op for a blank value', () => {
    const d = document.createElement('div');
    stampTracking(d, '');
    expect(d.hasAttribute('data-tracking')).toBe(false);
  });
});
