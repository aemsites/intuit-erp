import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildGoldenReplayReport, renderGoldenReplayHtml } from '../scripts/diff/golden-replay-report.mjs';

const entry = (payloadFile, page, properties) => ({
  page,
  payloadFile,
  event: 'content:interacted',
  key: properties['data-wa-link'] || '(loose)',
  fullPayload: { type: 'track', event: 'content:interacted', properties },
});

const adjudication = (field, policy, classification = 'expected-migration') => ({
  id: `${field}-${policy}`,
  classification,
  scope: { location: 'properties', field, scenarioId: '*' },
  policy,
  rationale: 'Reviewed migration behavior.',
  evidence: 'CLICK-TRACKING.md',
  owner: 'Adobe Migration Test',
  reviewDate: '2026-08-30',
});

const registry = (...entries) => ({ schemaVersion: 1, entries });
const bind = (manifest, state) => {
  manifest.manifestContentHash = 'manifest-content';
  manifest.goldenMappingHash = 'golden-mapping';
  return {
    ...state,
    binding: { manifest: { contentHash: 'manifest-content', mappingHash: 'golden-mapping' } },
  };
};

describe('complete golden replay report', () => {
  it('separates exact, expected-policy, bug, and coverage deviations by scenario identity', () => {
    const golden = { entries: [
      entry('payloads/one.json', '/events', {
        object: 'content', action: 'interacted', ui_object: 'link',
        page_cas_id: 'CMSabc123', url: 'https://erp.intuit.com/events/',
      }),
      entry('payloads/two.json', '/missing', { object: 'content', action: 'interacted' }),
    ] };
    const manifest = { scenarios: [
      { scenarioId: 'one', page: '/events', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {} },
      { scenarioId: 'two', page: '/missing', goldenRef: { payloadFile: 'payloads/two.json' }, classification: {} },
    ] };
    const state = { status: 'complete', coverage: { total: 2, pending: 0 }, resume: { nextScenarioId: null }, outcomes: [
      {
        scenarioId: 'one', pathname: '/events', status: 'captured', pageCasId: '/events',
        payload: {
          type: 'track', event: 'content:interacted',
          properties: {
            object: 'content', action: 'interacted', ui_object: 'button',
            page_cas_id: '/events', url: 'https://stage.erp.intuit.com/events',
          },
        },
      },
      { scenarioId: 'two', pathname: '/missing', status: 'missing', reason: 'sheet-target-not-rendered' },
    ] };

    const deviations = registry(
      adjudication('page_cas_id', 'pathname-policy'),
      adjudication('url', 'normalized-equivalence'),
    );
    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.pageCasId).toMatchObject({ captured: 1, exactPathname: 1, percent: 100, verdict: 'PASS' });
    expect(report.fields.find((row) => row.scenarioId === 'one' && row.field === 'page_cas_id'))
      .toMatchObject({
        category: 'expected-migration', policy: 'pathname-policy', match: true,
        golden: 'CMSabc123', expected: '/events', got: '/events',
        adjudication: expect.objectContaining({ owner: 'Adobe Migration Test', reviewDate: '2026-08-30' }),
      });
    expect(report.fields.find((row) => row.scenarioId === 'one' && row.field === 'url'))
      .toMatchObject({
        category: 'expected-migration', policy: 'normalized-equivalence', match: true,
        golden: 'https://erp.intuit.com/events/', expected: 'https://erp.intuit.com/events',
        got: 'https://stage.erp.intuit.com/events', rawMatch: false,
      });
    expect(report.fields.find((row) => row.scenarioId === 'one' && row.field === 'ui_object'))
      .toMatchObject({ category: 'stage-bug', match: false, expected: 'link', got: 'button' });
    expect(report.events.find((row) => row.scenarioId === 'two'))
      .toMatchObject({ category: 'capture-state', status: 'missing', reason: 'sheet-target-not-rendered' });
    const html = renderGoldenReplayHtml(report);
    expect(html).toContain('Raw exact score');
    expect(html).toContain('Policy-adjusted score');
    expect(html).toContain('Actionable bugs');
    expect(html).toContain('Open investigations');
    expect(html).toContain('Context presence');
    expect(html).toContain('Scenario coverage');
    expect(html).toContain('Raw equality');
    expect(html).toContain('Policy equality');
    expect(html).toContain('Presence');
  });

  it('keeps environment attribution and fragment-limited URL evidence out of confirmed bugs', () => {
    const golden = { entries: [entry('payloads/one.json', '/events', {
      object: 'content', action: 'interacted',
      url: 'https://erp.intuit.com/events/#',
      channel_cookie_90day: 'cid:|sc:|ext:|int:erp.intuit.com|',
    })] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/events', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/events', status: 'captured', pageCasId: '/events',
        payload: { type: 'track', event: 'content:interacted', properties: {
          object: 'content', action: 'interacted',
          url: 'https://stage.erp.intuit.com/events',
          channel_cookie_90day: 'cid:|sc:|ext:QOE-COM|int:stage.erp.intuit.com|',
        } },
      }],
    };

    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state) });
    expect(report.fields.find((row) => row.field === 'url'))
      .toMatchObject({ category: 'open-investigation', policy: 'url-fragment-evidence-limited', match: false });
    expect(report.fields.find((row) => row.field === 'channel_cookie_90day'))
      .toMatchObject({ category: 'environment-session-context', policy: 'environment-attribution', match: false });
    expect(report.summary.fieldCounts).toMatchObject({ 'open-investigation': 1, 'stage-bug': 0 });
    expect(report.summary.policyAdjusted).toMatchObject({
      score: 100, verdict: 'BLOCKED', investigations: 1,
    });
  });

  it('lists immutable raw equality, policy equality, and frozen presence separately', () => {
    const golden = { entries: [{
      page: '/events', payloadFile: 'payloads/one.json', event: 'content:interacted', key: 'hero',
      fullPayload: {
        type: 'track', event: 'content:interacted', messageId: 'prod-message',
        properties: {
          object: 'content', action: 'interacted', page_cas_id: 'CMSabc123',
          channel_cookie_90day: 'cid:|sc:|ext:|int:erp.intuit.com|',
        },
      },
    }] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/events', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/events', status: 'captured', pageCasId: '/events',
        payload: {
          type: 'track', event: 'content:interacted', messageId: 'stage-message',
          properties: {
            object: 'content', action: 'interacted', page_cas_id: '/events',
            channel_cookie_90day: 'cid:|sc:|ext:QOE-COM|int:stage.erp.intuit.com|',
          },
        },
      }],
    };

    const deviations = registry(adjudication('page_cas_id', 'pathname-policy'));
    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.fields.find((row) => row.field === 'page_cas_id')).toMatchObject({
      golden: 'CMSabc123', expected: '/events', got: '/events', rawMatch: false, policyMatch: true,
    });
    expect(report.fields.find((row) => row.field === 'channel_cookie_90day')).toMatchObject({
      rawMatch: false, policyMatch: null, category: 'environment-session-context',
    });
    expect(report.fields.find((row) => row.field === 'messageId')).toMatchObject({
      golden: 'prod-message', expected: '‹present + shape only›', got: 'stage-message',
      rawMatch: false, policyMatch: null, presence: true, category: 'environment-session-context',
    });
    expect(report.summary.rawExact.axes.field.groups['envelope.messageId'])
      .toEqual({ matched: 0, total: 1, percent: 0 });
  });

  it('keeps accepted deviations out of raw equality and scores the weakest adjusted axis', () => {
    const golden = { entries: [
      entry('payloads/one.json', '/one', {
        object: 'content', action: 'interacted', ui_object: 'link', page_cas_id: 'CMS1',
      }),
      entry('payloads/two.json', '/two', {
        object: 'content', action: 'interacted', ui_object: 'link', page_cas_id: 'CMS2',
      }),
    ] };
    const manifest = { scenarios: [
      { scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {} },
      { scenarioId: 'two', page: '/two', goldenRef: { payloadFile: 'payloads/two.json' }, classification: {} },
    ] };
    const stagePayload = (page, uiObject) => ({
      type: 'track', event: 'content:interacted',
      properties: {
        object: 'content', action: 'interacted', ui_object: uiObject, page_cas_id: page,
      },
    });
    const state = {
      status: 'complete', coverage: { total: 2, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [
        { scenarioId: 'one', pathname: '/one', status: 'captured', pageCasId: '/one', payload: stagePayload('/one', 'button') },
        { scenarioId: 'two', pathname: '/two', status: 'captured', pageCasId: '/two', payload: stagePayload('/two', 'link') },
      ],
    };

    const deviations = registry(adjudication('page_cas_id', 'pathname-policy'));
    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.rawExact).toMatchObject({
      score: 0,
      axes: { page: { score: 66.7 }, event: { score: 75 }, component: { score: 75 }, field: { score: 0 } },
    });
    expect(report.summary.policyAdjusted).toMatchObject({
      score: 50, verdict: 'FAIL', weakest: 'field=50%',
      axes: { page: { score: 83.3 }, event: { score: 91.7 }, component: { score: 91.7 }, field: { score: 50 } },
    });
  });

  it('fails the separate required-presence gate without counting context gaps as bugs', () => {
    const golden = { entries: [{
      page: '/one', payloadFile: 'payloads/one.json', event: 'content:interacted', key: 'hero',
      fullPayload: {
        type: 'track', event: 'content:interacted', messageId: 'prod-message',
        properties: { object: 'content', action: 'interacted', page_cas_id: 'CMS1' },
      },
    }] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/one', status: 'captured', pageCasId: '/one',
        payload: {
          type: 'track', event: 'content:interacted',
          properties: { object: 'content', action: 'interacted', page_cas_id: '/one' },
        },
      }],
    };

    const deviations = registry(adjudication('page_cas_id', 'pathname-policy'));
    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.presence).toEqual({ present: 0, total: 1, gaps: 1, percent: 0, verdict: 'FAIL' });
    expect(report.summary.context).toMatchObject({ rows: 1, differences: 1, missingPresence: 1 });
    expect(report.summary.fieldCounts).toMatchObject({ 'environment-session-context': 1, 'stage-bug': 0 });
    expect(report.summary.policyAdjusted).toMatchObject({ score: 100, verdict: 'PASS' });
    expect(report.summary.closureVerdict).toBe('FAIL');
  });

  it('hard-fails one captured event whose page_cas_id is not its pathname', () => {
    const golden = { entries: [entry('payloads/one.json', '/one', {
      object: 'content', action: 'interacted', page_cas_id: 'CMS1',
      url: 'https://erp.intuit.com/one/#',
    })] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/one', status: 'captured', pageCasId: '/one',
        payload: {
          type: 'track', event: 'content:interacted',
          properties: {
            object: 'content', action: 'interacted', page_cas_id: '/wrong',
            url: 'https://stage.erp.intuit.com/one',
          },
        },
      }],
    };

    const deviations = registry(adjudication('page_cas_id', 'pathname-policy'));
    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.pageCasId).toMatchObject({
      captured: 1, exactPathname: 0, percent: 0, verdict: 'FAIL', failures: ['one'],
    });
    expect(report.summary.policyAdjusted.investigations).toBe(1);
    expect(report.summary.policyAdjusted.verdict).toBe('BLOCKED');
    expect(report.summary.closureVerdict).toBe('FAIL');
  });

  it('lists empty and unknown production-carried fields instead of silently dropping them', () => {
    const golden = { entries: [{
      ...entry('payloads/one.json', '/one', {
        object: 'content', action: 'interacted', page_cas_id: 'CMS1', project_asset_id: '',
        customer_extra: null,
      }),
    }] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/one', status: 'captured',
        payload: {
          type: 'track', event: 'content:interacted',
          properties: { object: 'content', action: 'interacted', page_cas_id: '/one' },
        },
      }],
    };

    const report = buildGoldenReplayReport({
      golden, manifest, state: bind(manifest, state), deviations: registry(adjudication('page_cas_id', 'pathname-policy')),
    });
    expect(report.fields.find((row) => row.field === 'project_asset_id')).toMatchObject({
      golden: '', got: '‹absent›', presence: false, category: 'stage-bug',
    });
    expect(report.fields.find((row) => row.field === 'customer_extra')).toMatchObject({
      golden: 'null', got: '‹absent›', presence: false, category: 'open-investigation',
    });
  });

  it('accepts a genuine mismatch only through an exact-scenario adjudication', () => {
    const golden = { entries: [entry('payloads/one.json', '/one', {
      object: 'content', action: 'interacted', ui_object: 'link', page_cas_id: 'CMS1',
    })] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'payloads/one.json' }, classification: {},
    }] };
    const state = {
      status: 'complete', coverage: { total: 1, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', pathname: '/one', status: 'captured',
        payload: { type: 'track', event: 'content:interacted', properties: {
          object: 'content', action: 'interacted', ui_object: 'button', page_cas_id: '/one',
        } },
      }],
    };
    const deviations = registry(
      adjudication('page_cas_id', 'pathname-policy'),
      {
        ...adjudication('ui_object', 'value-mismatch', 'approved-golden-correction'),
        scope: { location: 'properties', field: 'ui_object', scenarioId: 'one' },
        rationale: 'Customer approved the corrected semantic value for this scenario.',
        evidence: 'customer-review-2026-08-30',
      },
    );

    const report = buildGoldenReplayReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.fields.find((row) => row.field === 'ui_object')).toMatchObject({
      golden: 'link', got: 'button', rawMatch: false, policyMatch: true,
      category: 'approved-golden-correction',
      adjudication: expect.objectContaining({ owner: 'Adobe Migration Test' }),
    });
    expect(report.summary.actionableBugs).toBe(0);
  });

  it('rejects complete replay evidence without a manifest binding', () => {
    const golden = { entries: [entry('one.json', '/one', { object: 'content', action: 'interacted' })] };
    const manifest = {
      manifestContentHash: 'manifest-content', goldenMappingHash: 'golden-mapping',
      scenarios: [{ scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'one.json' } }],
    };
    const state = {
      status: 'complete', coverage: { pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{ scenarioId: 'one', status: 'captured', payload: { properties: {} } }],
    };
    expect(() => buildGoldenReplayReport({ golden, manifest, state }))
      .toThrow('complete replay binding is required');
  });

  it('scopes status and field filters to their own report tab', () => {
    const golden = { entries: [entry('one.json', '/one', {
      object: 'content', action: 'interacted', page_cas_id: 'CMS1',
    })] };
    const manifest = { scenarios: [{
      scenarioId: 'one', page: '/one', goldenRef: { payloadFile: 'one.json' }, classification: {},
    }] };
    const state = bind(manifest, {
      status: 'complete', coverage: { pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [{
        scenarioId: 'one', status: 'captured', payload: {
          type: 'track', event: 'content:interacted',
          properties: { object: 'content', action: 'interacted', page_cas_id: '/one' },
        },
      }],
    });
    const report = buildGoldenReplayReport({
      golden, manifest, state, deviations: registry(adjudication('page_cas_id', 'pathname-policy')),
    });
    const dom = new JSDOM(renderGoldenReplayHtml(report), { runScripts: 'dangerously' });
    const { document, Event } = dom.window;
    const status = document.getElementById('status');
    status.value = 'captured';
    status.dispatchEvent(new Event('change'));
    document.getElementById('fields-tab').click();
    expect(document.querySelectorAll('#fields tbody tr')).toHaveLength(report.fields.length);
    const field = document.getElementById('field');
    field.value = 'page_cas_id';
    field.dispatchEvent(new Event('change'));
    document.getElementById('events-tab').click();
    expect(document.querySelectorAll('#events tbody tr')).toHaveLength(report.events.length);
  });
});
