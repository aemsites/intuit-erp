import { describe, expect, it } from 'vitest';
import { buildOfflineGoldenReplayAnalysis } from '../scripts/diff/golden-replay-offline-analysis.mjs';

const payload = (properties) => ({
  type: 'track', event: `${properties.object}:${properties.action}`, properties,
});
const deviations = {
  schemaVersion: 1,
  entries: [{
    id: 'page-cas-pathname', classification: 'expected-migration',
    scope: { location: 'properties', field: 'page_cas_id', scenarioId: '*' },
    policy: 'pathname-policy', rationale: 'Reviewed migration behavior.',
    evidence: 'CLICK-TRACKING.md', owner: 'Adobe Migration Test', reviewDate: '2026-08-30',
  }],
};
const bind = (manifest, state) => {
  manifest.manifestContentHash = 'manifest-content';
  manifest.goldenMappingHash = 'golden-mapping';
  return {
    ...state,
    binding: { manifest: { contentHash: 'manifest-content', mappingHash: 'golden-mapping' } },
  };
};

describe('offline golden replay analysis', () => {
  it('preserves the denominator and drafts only missing authored residue', () => {
    const golden = { entries: [
      {
        page: '/one', payloadFile: 'payloads/one.json', event: 'content:interacted', key: 'hero',
        fullPayload: payload({
          object: 'content', action: 'interacted', object_detail: 'hero|schedule_call',
          ui_object: 'button', ui_access_point: 'cta_block', 'data-wa-link': 'hero-schedule-call',
          icom_user_action: 'hero-schedule-call [cmo|mktg|corp|enterprise|one]',
          page_cas_id: 'CMS1',
        }),
      },
      {
        page: '/two', payloadFile: 'payloads/two.json', event: 'content:interacted', key: 'footer',
        fullPayload: payload({ object: 'content', action: 'interacted', page_cas_id: 'CMS2' }),
      },
      {
        page: '/video', payloadFile: 'payloads/video.json', event: 'video:engaged', key: 'cards',
        fullPayload: payload({
          object: 'video', action: 'engaged', ui_object: 'video_link',
          ui_access_point: 'page', page_cas_id: 'CMS3',
        }),
      },
    ] };
    const manifest = { scenarios: [
      { scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' } },
      { scenarioId: 'two', page: '/two', goldenRef: { payloadFile: 'payloads/two.json' } },
      { scenarioId: 'video', page: '/video', goldenRef: { payloadFile: 'payloads/video.json' } },
    ] };
    const state = {
      status: 'in-progress', coverage: { total: 3, captured: 2, missing: 1, pending: 0 },
      outcomes: [
        {
          scenarioId: 'one', pathname: '/one', status: 'captured', pageCasId: '/one',
          locator: { trackId: 'hero:schedule-a-call' },
          payload: payload({
            object: 'content', action: 'interacted', ui_object: 'button',
            ui_access_point: 'rw2_hero', page_cas_id: '/one',
          }),
        },
        { scenarioId: 'two', pathname: '/two', status: 'missing', reason: 'sheet-target-not-rendered' },
        {
          scenarioId: 'video', pathname: '/video', status: 'captured', pageCasId: '/video',
          locator: { trackId: 'cards:youtube-playlist' },
          payload: payload({
            object: 'content', action: 'interacted', ui_object: 'link',
            ui_access_point: 'rw_cards_container', page_cas_id: '/video',
          }),
        },
      ],
    };

    const analysis = buildOfflineGoldenReplayAnalysis({ golden, manifest, state: bind(manifest, state), deviations });
    expect(analysis.summary).toMatchObject({ total: 3, captured: 2, missing: 1, pageCasIdExact: 2 });
    expect(analysis.sheetCorrectionDraft).toEqual([expect.objectContaining({
      path: '/one', id: 'hero:schedule-a-call',
      'object-detail': 'hero|schedule_call', 'wa-link': 'hero-schedule-call',
    })]);
    expect(analysis.sheetCorrectionDraft[0]).not.toHaveProperty('ui-access-point');
    expect(analysis.semanticOverrideDraft).toEqual([{
      path: '/video',
      id: 'cards:youtube-playlist',
      object: 'video',
      action: 'engaged',
      'ui-object': 'video_link',
      'ui-access-point': 'page',
    }]);
    expect(analysis.reviewItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenarioId: 'one', field: 'ui_access_point' }),
    ]));
    expect(analysis.dispositions).toEqual([
      expect.objectContaining({
        scenarioId: 'two', status: 'missing', reason: 'sheet-target-not-rendered', bucket: 'target-absent',
      }),
    ]);
  });

  it('keeps frozen-presence and channel context gaps out of click review items', () => {
    const golden = { entries: [{
      page: '/one', payloadFile: 'payloads/one.json', event: 'content:interacted', key: 'hero',
      fullPayload: {
        type: 'track', event: 'content:interacted', messageId: 'prod-message',
        properties: {
          object: 'content', action: 'interacted', ui_object: 'link', page_cas_id: 'CMS1',
          channel_cookie_90day: 'cid:|sc:|ext:|int:erp.intuit.com|',
        },
      },
    }] };
    const manifest = { scenarios: [{ scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' } }] };
    const state = {
      status: 'complete', coverage: { total: 1, captured: 1, pending: 0 },
      outcomes: [{
        scenarioId: 'one', pathname: '/one', status: 'captured', pageCasId: '/one',
        payload: payload({
          object: 'content', action: 'interacted', ui_object: 'button', page_cas_id: '/one',
          channel_cookie_90day: 'cid:|sc:|ext:QOE-COM|int:stage.erp.intuit.com|',
        }),
      }],
    };

    const analysis = buildOfflineGoldenReplayAnalysis({ golden, manifest, state: bind(manifest, state), deviations });
    expect(analysis.summary).toMatchObject({
      clickMetadataReviewItems: 1, clickMetadataBugs: 1,
      clickMetadataInvestigations: 0, environmentContextRows: 2,
      environmentMissingPresence: 1,
    });
    expect(analysis.reviewItems).toEqual([
      expect.objectContaining({ field: 'ui_object', category: 'stage-bug' }),
    ]);
    expect(analysis.environmentGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'messageId', category: 'environment-session-context' }),
      expect.objectContaining({ field: 'channel_cookie_90day', category: 'environment-session-context' }),
    ]));
  });

  it('rejects duplicate outcomes that omit a manifest scenario', () => {
    const golden = { entries: [
      { page: '/one', payloadFile: 'one.json', event: 'content:interacted', fullPayload: payload({ object: 'content', action: 'interacted' }) },
      { page: '/two', payloadFile: 'two.json', event: 'content:interacted', fullPayload: payload({ object: 'content', action: 'interacted' }) },
    ] };
    const manifest = { scenarios: [
      { scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'one.json' } },
      { scenarioId: 'two', page: '/two', goldenRef: { payloadFile: 'two.json' } },
    ] };
    const state = {
      coverage: { total: 2 },
      outcomes: [
        { scenarioId: 'one', status: 'missing', pathname: '/one' },
        { scenarioId: 'one', status: 'missing', pathname: '/one' },
      ],
    };
    expect(() => buildOfflineGoldenReplayAnalysis({ golden, manifest, state: bind(manifest, state), deviations }))
      .toThrow('offline analysis scenario identity is invalid');
  });

  it('rejects offline evidence without a manifest binding', () => {
    const golden = { entries: [{
      page: '/one', payloadFile: 'one.json', event: 'content:interacted',
      fullPayload: payload({ object: 'content', action: 'interacted' }),
    }] };
    const manifest = {
      manifestContentHash: 'manifest-content', goldenMappingHash: 'golden-mapping',
      scenarios: [{ scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'one.json' } }],
    };
    const state = { outcomes: [{ scenarioId: 'one', status: 'missing', pathname: '/one' }] };
    expect(() => buildOfflineGoldenReplayAnalysis({ golden, manifest, state, deviations }))
      .toThrow('offline analysis binding is required');
  });
});
