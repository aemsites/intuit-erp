import { describe, it, expect } from 'vitest';
import { entryForSlot, recommendationOf, pznRecord } from '../scripts/personalization/pzn-response.js';

// A real-shape 200 batch entry (data.recommendations is an array).
function entry(placement, rec, status = 200) {
  return {
    data: { recommendations: status === 200 ? [rec] : { fallback: true } },
    placement,
    experience: 'ttcom',
    status,
  };
}

const REC = {
  id: 'f4ec4470-d4b1-11f0-8958-fda566379886',
  copyData: { template: 'content', contentId: 'c1mX51ufI' },
  accessPoint: 'CGTTCOMMContentTTLCArticles',
  model_name: null,
  model_version: null,
  inference_handle: null,
};

describe('entryForSlot', () => {
  const response = {
    ttcom_CGTTCOMMContentTTLCArticles_en_US: entry('CGTTCOMMContentTTLCArticles', REC),
    ttcom_CGTTCOMMContentTTLCWrapper_en_US: entry('CGTTCOMMContentTTLCWrapper', null, 204),
  };

  it('matches the entry by its echoed placement (case-insensitive)', () => {
    const hit = entryForSlot(response, 'cgttcommcontentttlcarticles');
    expect(hit.placement).toBe('CGTTCOMMContentTTLCArticles');
  });

  it('returns null when no placement matches', () => {
    expect(entryForSlot(response, 'nope')).toBeNull();
  });

  it('returns null for a non-object response', () => {
    expect(entryForSlot(null, 'x')).toBeNull();
    expect(entryForSlot('{}', 'x')).toBeNull();
  });
});

describe('recommendationOf', () => {
  it('returns the first recommendation for a 200 entry', () => {
    expect(recommendationOf(entry('p', REC))).toBe(REC);
  });

  it('returns null for a 204 (fallback) entry', () => {
    expect(recommendationOf(entry('p', null, 204))).toBeNull();
  });

  it('returns null for a null entry', () => {
    expect(recommendationOf(null)).toBeNull();
  });
});

describe('pznRecord', () => {
  it('builds the normalized record from a recommendation (contentId → both id fields)', () => {
    expect(pznRecord(REC)).toEqual({
      personalization_placement: 'CGTTCOMMContentTTLCArticles',
      personalization_id: 'f4ec4470-d4b1-11f0-8958-fda566379886',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      content_id: 'c1mX51ufI',
      externalContentIdentifier: 'c1mX51ufI',
      model_name: null,
      model_version: null,
      experiment_id: undefined,
      experiment_version: undefined,
      experiment_treatment: undefined,
      inference_handler: null,
    });
  });

  it('carries experiment fields when the slot is under an experiment', () => {
    const rec = {
      ...REC,
      experimentId: '314899',
      experimentVersion: 8,
      treatmentId: '689258',
    };
    expect(pznRecord(rec)).toMatchObject({
      experiment_id: '314899',
      experiment_version: 8,
      experiment_treatment: '689258',
    });
  });

  it('returns null without accessPoint or id (guard)', () => {
    expect(pznRecord({ id: 'x', copyData: {} })).toBeNull();
    expect(pznRecord({ accessPoint: 'x', copyData: {} })).toBeNull();
    expect(pznRecord(null)).toBeNull();
  });
});
