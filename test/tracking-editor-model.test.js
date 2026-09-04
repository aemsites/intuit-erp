import { describe, it, expect } from 'vitest';
import {
  DA_SOURCE_WRITE_METHOD,
  applyOverride,
  comparisonRows,
  mergeOverride,
  resolveDocumentPath,
  resolveEditorPath,
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

  it('formats the DA document path with its repo and canonical trailing slash', () => {
    expect(resolveDocumentPath({
      repo: 'intuit-erp',
      path: '/accounting/multi-entity/index',
    })).toBe('/intuit-erp/accounting/multi-entity/');
  });

  it('uses POST when replacing an existing DA Source JSON file', () => {
    expect(DA_SOURCE_WRITE_METHOD).toBe('POST');
  });

  it('compares automatic and effective values without object key-order noise', () => {
    expect(comparisonRows({
      object: 'content',
      action: 'interacted',
      'custom-properties': { link_name: 'button-pricing', audience: 'small-business' },
    }, {
      object: 'content',
      action: 'engaged',
      'custom-properties': { audience: 'small-business', link_name: 'button-pricing' },
    }, ['object', 'action', 'custom-properties'])).toEqual([
      {
        field: 'object', automatic: 'content', effective: 'content', changed: false,
      },
      {
        field: 'action', automatic: 'interacted', effective: 'engaged', changed: true,
      },
      {
        field: 'custom-properties',
        automatic: { link_name: 'button-pricing', audience: 'small-business' },
        effective: { audience: 'small-business', link_name: 'button-pricing' },
        changed: false,
      },
    ]);
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
