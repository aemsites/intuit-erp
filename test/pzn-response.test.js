import { describe, it, expect } from 'vitest';
import {
  entryForSlot, recommendationOf, pznRecord, pznFragment,
} from '../scripts/personalization/pzn-response.js';

// A real-shape 200 batch entry: recommendations nest under `.recommendation[]`.
function entry(placement, rec, status = 200) {
  return {
    data: { recommendations: status === 200 ? { recommendation: [rec] } : { fallback: true } },
    placement,
    experience: 'ttcom',
    status,
  };
}

const REC = {
  id: '07f78bf0-91c3-11f1-91cd-7b62967e699e',
  offerId: '07f78bf0-91c3-11f1-91cd-7b62967e699e',
  copyData: { template: 'content', pznblock: 'fragments/pzn/slot1-hospitality', contentId: '1223344' },
  accessPoint: 'SBSEGQBMContentAemPznIxpTest',
  experimentId: '384992',
  experimentVersion: 1,
  treatmentId: '836449',
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
  it('returns the first recommendation from the nested .recommendation[] (real endpoint)', () => {
    expect(recommendationOf(entry('p', REC))).toBe(REC);
  });

  it('also handles a bare recommendations[] array (mock/alt shape)', () => {
    const arrEntry = {
      data: { recommendations: [REC] }, placement: 'p', experience: 'ttcom', status: 200,
    };
    expect(recommendationOf(arrEntry)).toBe(REC);
  });

  it('returns null for a 204 (fallback) entry', () => {
    expect(recommendationOf(entry('p', null, 204))).toBeNull();
  });

  it('returns null for a null entry', () => {
    expect(recommendationOf(null)).toBeNull();
  });
});

describe('pznFragment', () => {
  it('prefers copyData.pznblock (the EDS fragment path)', () => {
    expect(pznFragment(REC)).toBe('fragments/pzn/slot1-hospitality');
  });

  it('falls back to copyData.contentId when pznblock is absent (mock)', () => {
    expect(pznFragment({ copyData: { contentId: '/fragments/pzn/x' } })).toBe('/fragments/pzn/x');
  });

  it('returns null when neither is present', () => {
    expect(pznFragment({ copyData: {} })).toBeNull();
    expect(pznFragment(null)).toBeNull();
  });
});

describe('pznRecord', () => {
  it('builds the normalized record from a recommendation (id, contentId, experiment fields)', () => {
    expect(pznRecord(REC)).toEqual({
      personalization_placement: 'SBSEGQBMContentAemPznIxpTest',
      personalization_id: '07f78bf0-91c3-11f1-91cd-7b62967e699e',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      content_id: '1223344',
      externalContentIdentifier: '1223344',
      model_name: undefined,
      model_version: undefined,
      experiment_id: '384992',
      experiment_version: 1,
      experiment_treatment: '836449',
      inference_handler: undefined,
    });
  });

  it('omits experiment fields when the slot is not under an experiment', () => {
    const rec = {
      id: 'x', accessPoint: 'AP', copyData: { pznblock: '/f', contentId: 'cid' },
    };
    expect(pznRecord(rec)).toMatchObject({
      personalization_id: 'x',
      content_id: 'cid',
      experiment_id: undefined,
      experiment_treatment: undefined,
    });
  });

  it('returns null without accessPoint or id (guard)', () => {
    expect(pznRecord({ id: 'x', copyData: {} })).toBeNull();
    expect(pznRecord({ accessPoint: 'x', copyData: {} })).toBeNull();
    expect(pznRecord(null)).toBeNull();
  });
});
