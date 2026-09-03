import { describe, expect, it } from 'vitest';
import {
  checkPageBeacon,
  summarizePageBeacon,
} from '../scripts/diff/appvars-diff.mjs';

describe('appvars page-view parity', () => {
  it('requires personalization_details when the measured appVars contains PZN records', () => {
    const capture = {
      appVars: {
        counts: {
          pznPageRecDetailsArr: 0,
          pznRecDetailsArr: 1,
        },
      },
      pageBeacon: {
        present: true,
        hasPdKey: false,
        pdCount: 0,
      },
    };

    expect(checkPageBeacon(capture, null)).toMatchObject({
      relevant: true,
      ok: false,
      pznOk: false,
      expectedPdCount: 1,
    });
  });

  it('summarizes the page event carrying PZN when an earlier page event lacks it', () => {
    const summary = summarizePageBeacon([
      { type: 'page', properties: { screen: 'construction' } },
      {
        type: 'page',
        properties: {
          personalization_details: [{ personalization_id: 'offer-1' }],
          experiment_ids: '111:2:333',
        },
      },
    ]);

    expect(summary).toEqual({
      present: true,
      count: 2,
      hasPdKey: true,
      pdCount: 1,
      pdRecordKeys: ['personalization_id'],
      hasExperimentIds: true,
    });
  });

  it('uses the final page event so an earlier enriched event cannot hide a later gap', () => {
    const summary = summarizePageBeacon([
      {
        type: 'page',
        properties: {
          personalization_details: [{ personalization_id: 'offer-1' }],
          experiment_ids: '111:2:333',
        },
      },
      { type: 'page', properties: { screen: 'construction' } },
    ]);

    expect(summary).toMatchObject({
      present: true,
      count: 2,
      hasPdKey: false,
      pdCount: 0,
      hasExperimentIds: false,
    });
  });

  it('requires experiment_ids when measured appVars contains IXP records', () => {
    const capture = {
      appVars: {
        counts: {
          pznPageRecDetailsArr: 0,
          pznRecDetailsArr: 0,
          ixpDetailsArr: 1,
        },
      },
      pageBeacon: {
        present: true,
        hasPdKey: false,
        pdCount: 0,
        hasExperimentIds: false,
      },
    };

    expect(checkPageBeacon(capture, null)).toMatchObject({
      relevant: true,
      ok: false,
      expectsIxp: true,
      ixpOk: false,
      appVarsIxpCount: 1,
    });
  });

  it('rejects an empty-array experiment_ids value', () => {
    const pageBeacon = summarizePageBeacon([{
      type: 'page',
      properties: { experiment_ids: [] },
    }]);
    const result = checkPageBeacon({
      appVars: { counts: { ixpDetailsArr: 1 } },
      pageBeacon,
    }, null);

    expect(pageBeacon.hasExperimentIds).toBe(false);
    expect(result).toMatchObject({ relevant: true, ok: false, ixpOk: false });
  });
});
