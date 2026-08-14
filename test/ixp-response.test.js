import { describe, it, expect } from 'vitest';
import {
  isRedirect, isReplace, ixpContentPath, ixpRecord,
} from '../scripts/personalization/ixp-response.js';

const VARIATION_KEY = 'intuit.com.integration.variation.html';

function assignment(partial) {
  return {
    experimentId: 15972,
    experimentVersion: 7,
    id: 39927,
    experimentType: 'REDIRECT',
    payload: '',
    assetLocation: null,
    control: false,
    ...partial,
  };
}

describe('isRedirect / isReplace', () => {
  it('classifies redirect types (non-control)', () => {
    expect(isRedirect(assignment({ experimentType: 'REDIRECT' }))).toBe(true);
    expect(isRedirect(assignment({ experimentType: 'MAB_REDIRECT' }))).toBe(true);
    expect(isRedirect(assignment({ experimentType: 'REPLACE_WEB_CONTENT' }))).toBe(false);
    expect(isRedirect(assignment({ experimentType: 'REDIRECT', control: true }))).toBe(false);
  });

  it('classifies replace types (non-control)', () => {
    expect(isReplace(assignment({ experimentType: 'REPLACE_WEB_CONTENT' }))).toBe(true);
    expect(isReplace(assignment({ experimentType: 'MAB_WEB_CONTENT' }))).toBe(true);
    expect(isReplace(assignment({ experimentType: 'REDIRECT' }))).toBe(false);
    expect(isReplace(assignment({ experimentType: 'REPLACE_WEB_CONTENT', control: true }))).toBe(false);
  });
});

describe('ixpContentPath', () => {
  it('reads the variation URL from a redirect payload', () => {
    const a = assignment({ experimentType: 'REDIRECT', payload: JSON.stringify({ [VARIATION_KEY]: '/x-variant' }) });
    expect(ixpContentPath(a)).toBe('/x-variant');
  });

  it('reads assetLocation from a replace assignment', () => {
    const a = assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/exp/a' });
    expect(ixpContentPath(a)).toBe('/fragments/exp/a');
  });

  it('returns null for control, unmapped, or malformed payload', () => {
    expect(ixpContentPath(assignment({ control: true }))).toBeNull();
    expect(ixpContentPath(assignment({ experimentType: 'DEFAULT' }))).toBeNull();
    expect(ixpContentPath(assignment({ experimentType: 'REDIRECT', payload: 'not json' }))).toBeNull();
    expect(ixpContentPath(assignment({ experimentType: 'REDIRECT', payload: JSON.stringify({ other: '/y' }) }))).toBeNull();
  });
});

describe('ixpRecord', () => {
  it('builds a treatment record with the resolved replacement path', () => {
    const a = assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/exp/a' });
    expect(ixpRecord(a, '/current/page')).toEqual({
      experiment_id: 15972,
      experiment_version: 7,
      experiment_treatment: 39927,
      original_content_id: '/current/page',
      replacement_content_id: '/fragments/exp/a',
    });
  });

  it('builds a control record WITHOUT a replacement_content_id', () => {
    const a = assignment({ control: true });
    expect(ixpRecord(a, '/current/page')).toEqual({
      experiment_id: 15972,
      experiment_version: 7,
      experiment_treatment: 39927,
      original_content_id: '/current/page',
    });
  });

  it('returns null when experiment identity is incomplete (guard)', () => {
    expect(ixpRecord(assignment({ experimentId: undefined }), '/p')).toBeNull();
    expect(ixpRecord(assignment({ experimentVersion: undefined }), '/p')).toBeNull();
    expect(ixpRecord(assignment({ id: undefined }), '/p')).toBeNull();
    expect(ixpRecord(null, '/p')).toBeNull();
  });
});
