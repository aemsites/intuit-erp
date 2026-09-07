import { describe, expect, it } from 'vitest';
import { measurementProblems } from '../scripts/diff/appvars-diff.mjs';
import { martechVerificationProblems } from '../scripts/diff/martech-diff.mjs';

describe('customer-facing browser verification', () => {
  it('rejects appVars runs that did not measure every selected target', () => {
    const report = {
      pages: {
        homepage: { local: { status: 'OK' } },
        construction: { local: { status: 'SKIPPED', reason: 'server down' } },
      },
    };

    expect(measurementProblems(report, ['homepage', 'construction'], ['local']))
      .toEqual(['construction @ local: server down']);
  });

  it('rejects skipped or baseline-less martech measurements', () => {
    expect(martechVerificationProblems('homepage', 'local', {
      status: 'SKIPPED', reason: 'server down',
    }, { status: 'OK' })).toEqual(['homepage @ local: server down']);

    expect(martechVerificationProblems('homepage', 'local', {
      status: 'OK', utagLoaded: true, vendors: [], tagUids: [], udoKeys: [],
    }, null)).toEqual(['homepage @ local: no usable baseline']);
  });

  it('permits documented differences between production and local martech profiles', () => {
    const baseline = {
      status: 'OK',
      vendors: ['fullstory', 'ga4', 'o11y-rum'],
      tagUids: [1, 2],
      udoKeys: ['baseline_only'],
    };
    const healthy = {
      status: 'OK',
      utagLoaded: true,
      vendors: ['ga4', 'new-dev-vendor'],
      tagUids: [2, 3],
      udoKeys: ['local_only'],
    };

    expect(martechVerificationProblems('homepage', 'local', healthy, baseline)).toEqual([]);
  });

  it('rejects a measured page where Tealium never loaded', () => {
    expect(martechVerificationProblems('homepage', 'local', {
      status: 'OK', utagLoaded: false, vendors: [], tagUids: [], udoKeys: [],
    }, {
      status: 'OK', vendors: [], tagUids: [], udoKeys: [],
    })).toEqual(['homepage @ local: Tealium did not load']);
  });
});
