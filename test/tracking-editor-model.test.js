import { describe, it, expect } from 'vitest';
import {
  applyOverride,
  mergeOverride,
  validateOverride,
} from '../tools/plugins/tracking/model.js';

const SHEET = {
  ':type': 'sheet',
  total: 2,
  data: [
    { path: '*', id: 'footer:company', 'wa-link': 'global-company', owner: 'preserve-me' },
    { path: '/accounting', id: 'cta:pricing', action: 'engaged' },
  ],
};

describe('tracking editor sheet model', () => {
  it('creates a sparse page-scoped row and preserves unrelated rows and columns', () => {
    const out = applyOverride(SHEET, {
      path: '/accounting',
      id: 'page:contact',
      values: {
        object: '',
        'object-detail': 'sales contact',
        'wa-link': 'campaign-contact',
      },
    });

    expect(out.total).toBe(3);
    expect(out.data[0]).toEqual(SHEET.data[0]);
    expect(out.data[2]).toEqual({
      path: '/accounting',
      id: 'page:contact',
      'object-detail': 'sales contact',
      'wa-link': 'campaign-contact',
    });
    expect(SHEET.total).toBe(2);
  });

  it('removes a row when its last supported override is cleared', () => {
    const out = applyOverride(SHEET, {
      path: '/accounting',
      id: 'cta:pricing',
      values: { action: '' },
    });

    expect(out.total).toBe(1);
    expect(out.data.some((row) => row.id === 'cta:pricing')).toBe(false);
  });

  it('preserves non-editor columns when clearing supported values', () => {
    const out = applyOverride(SHEET, {
      path: '*',
      id: 'footer:company',
      values: { 'wa-link': '' },
    });

    expect(out.data[0]).toEqual({ path: '*', id: 'footer:company', owner: 'preserve-me' });
  });

  it('validates key/value fields before they reach the runtime parser', () => {
    expect(validateOverride({
      'custom-properties': 'link_name=button-pricing\naudience=small-business',
      survey: 'answer=true',
    })).toEqual({});

    expect(validateOverride({
      'custom-properties': 'link_name=broken|value',
      survey: 'missing-equals',
    })).toEqual({
      'custom-properties': 'Keys and values cannot contain "|" or ",".',
      survey: 'Use one key=value pair per line.',
    });
  });

  it('merges onto the latest sheet when unrelated fields changed', () => {
    const latest = structuredClone(SHEET);
    latest.data[1]['object-detail'] = 'changed elsewhere';

    const result = mergeOverride({
      base: SHEET,
      latest,
      change: {
        path: '/accounting',
        id: 'cta:pricing',
        values: { action: 'interacted' },
      },
    });

    expect(result.conflicts).toEqual([]);
    expect(result.sheet.data[1]).toMatchObject({
      action: 'interacted',
      'object-detail': 'changed elsewhere',
    });
  });

  it('refuses a same-field concurrent edit instead of silently overwriting it', () => {
    const latest = structuredClone(SHEET);
    latest.data[1].action = 'started';

    const result = mergeOverride({
      base: SHEET,
      latest,
      change: {
        path: '/accounting',
        id: 'cta:pricing',
        values: { action: 'interacted' },
      },
    });

    expect(result.conflicts).toEqual(['action']);
    expect(result.sheet).toBeNull();
  });
});
