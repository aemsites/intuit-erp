import { describe, it, expect } from 'vitest';
import {
  DA_SOURCE_WRITE_METHOD,
  applyOverride,
  mergeOverride,
  resolveEditorPath,
  trackingRowsForPath,
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
  it('opens the current DA document by default while preserving direct-app path overrides', () => {
    expect(resolveEditorPath({ contextPath: '/accounting/multi-entity' }))
      .toBe('/accounting/multi-entity');
    expect(resolveEditorPath({
      contextPath: '/accounting/multi-entity',
      search: '?path=/pricing/enterprise&ref=main',
    })).toBe('/pricing/enterprise');
    expect(resolveEditorPath({ contextPath: '/accounting/multi-entity.html?foo=bar' }))
      .toBe('/accounting/multi-entity');
    expect(resolveEditorPath({ contextPath: '/accounting/multi-entity/index' }))
      .toBe('/accounting/multi-entity');
    expect(resolveEditorPath({ contextPath: '/accounting/multi-entity/index.html' }))
      .toBe('/accounting/multi-entity');
  });

  it('builds the searchable editor list from global and current-page tracking rows', () => {
    const sheet = {
      data: [
        { path: '*', id: 'footer:company', 'wa-link': 'global-company' },
        {
          path: '/accounting/multi-entity',
          id: 'hero:take-the-tour',
          'ui-object-detail': 'Take the tour',
          action: 'engaged',
        },
        { path: '/pricing', id: 'hero:buy-now', action: 'engaged' },
      ],
    };

    expect(trackingRowsForPath(sheet, '/accounting/multi-entity/index')).toEqual([
      expect.objectContaining({
        id: 'footer:company',
        label: 'footer:company',
        block: 'footer',
        path: '/accounting/multi-entity',
        scope: 'global',
        editable: true,
        override: { 'wa-link': 'global-company' },
      }),
      expect.objectContaining({
        id: 'hero:take-the-tour',
        label: 'Take the tour',
        block: 'hero',
        path: '/accounting/multi-entity',
        scope: 'page',
        editable: true,
        override: {
          'ui-object-detail': 'Take the tour',
          action: 'engaged',
        },
      }),
    ]);
  });

  it('uses POST when replacing an existing DA Source JSON file', () => {
    expect(DA_SOURCE_WRITE_METHOD).toBe('POST');
  });

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

  it('removes a row when DA normalized its other blank cells to empty strings', () => {
    const normalized = {
      ':type': 'sheet',
      total: 1,
      data: [{
        path: '/accounting',
        id: 'cta:pricing',
        object: 'poc-value',
        action: '',
        'wa-link': '',
        legacy: '',
      }],
    };

    const out = applyOverride(normalized, {
      path: '/accounting',
      id: 'cta:pricing',
      values: { object: '' },
    });

    expect(out.total).toBe(0);
    expect(out.data).toEqual([]);
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
