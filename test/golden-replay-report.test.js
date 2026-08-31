import {
  describe, expect, it, vi,
} from 'vitest';
import { JSDOM } from 'jsdom';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGoldenReplayReport, main, renderGoldenReplayHtml,
} from '../scripts/diff/golden-replay-report.mjs';
import { createGoldenReplayManifest } from '../scripts/diff/golden-replay-manifest.mjs';
import { goldenHash } from '../scripts/diff/oracle-lib.mjs';
import { createGoldenIdentityLock } from '../scripts/diff/trustworthy-offline-verdict.mjs';

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
const canonicalDeviationRegistry = JSON.parse(readFileSync(
  'scripts/diff/fixtures/clicktrack-deviation-registry.json',
  'utf8',
));
const bind = (manifest, state) => {
  manifest.manifestContentHash = 'manifest-content';
  manifest.goldenMappingHash = 'golden-mapping';
  return {
    ...state,
    binding: { manifest: { contentHash: 'manifest-content', mappingHash: 'golden-mapping' } },
  };
};

const scenarioSet = (total, reproducedPassing) => {
  const ids = Array.from({ length: total }, (_, index) => `scenario-${String(index + 1).padStart(3, '0')}`);
  const golden = { entries: ids.map((scenarioId) => entry(
    `payloads/${scenarioId}.json`, `/${scenarioId}`,
    { object: 'content', action: 'interacted', page_cas_id: `/${scenarioId}` },
  )) };
  const manifest = { scenarios: ids.map((scenarioId) => ({
    scenarioId,
    page: `/${scenarioId}`,
    goldenRef: { payloadFile: `payloads/${scenarioId}.json` },
  })) };
  const state = bind(manifest, {
    status: 'complete', coverage: { total, pending: 0 }, resume: { nextScenarioId: null },
    outcomes: ids.map((scenarioId, index) => (index < reproducedPassing ? {
      scenarioId,
      status: 'captured',
      payload: {
        type: 'track', event: 'content:interacted',
        properties: { object: 'content', action: 'interacted', page_cas_id: `/${scenarioId}` },
      },
    } : { scenarioId, status: 'missing', reason: 'not-reproduced' })),
  });
  return { golden, manifest, state };
};

const buildTestReport = (inputs) => buildGoldenReplayReport({
  ...inputs,
  expectedScenarioTotal: inputs.manifest.scenarios.length,
});

const writeCliFixture = (directory) => {
  const cliEntry = (payloadFile, page) => ({
    page,
    payloadFile,
    event: 'content:interacted',
    fullPayload: {
      type: 'track',
      event: 'content:interacted',
      properties: { object: 'content', action: 'interacted', page_cas_id: page },
      context: { page: { path: page, url: `https://erp.intuit.com${page}` } },
    },
  });
  const golden = { entries: Array.from({ length: 161 }, (_, index) => {
    const id = `scenario-${String(index + 1).padStart(3, '0')}`;
    return cliEntry(`payloads/${id}.json`, `/${id}`);
  }) };
  golden.integrity = { payloads: golden.entries.length, sha256: goldenHash(golden) };
  const identityLock = createGoldenIdentityLock(golden);
  const manifest = createGoldenReplayManifest(golden, identityLock);
  const state = {
    status: 'complete',
    coverage: { total: 161, pending: 0 },
    resume: { nextScenarioId: null },
    binding: {
      manifest: {
        contentHash: manifest.manifestContentHash,
        mappingHash: manifest.goldenMappingHash,
      },
    },
    outcomes: manifest.scenarios.map((scenario, index) => (index < 159 ? {
      scenarioId: scenario.scenarioId,
      status: 'captured',
      payload: golden.entries[index].fullPayload,
    } : { scenarioId: scenario.scenarioId, status: 'missing', reason: 'not-reproduced' })),
  };
  const paths = Object.fromEntries(['golden', 'manifest', 'identityLock', 'deviations', 'state']
    .map((name) => [name, join(directory, `${name}.json`)]));
  writeFileSync(paths.golden, JSON.stringify(golden));
  writeFileSync(paths.manifest, JSON.stringify(manifest));
  writeFileSync(paths.identityLock, JSON.stringify(identityLock));
  writeFileSync(paths.deviations, JSON.stringify(registry()));
  writeFileSync(paths.state, JSON.stringify(state));
  return paths;
};

describe('complete golden replay report', () => {
  it('rejects non-canonical default denominators, including 160 and zero scenarios', () => {
    expect(() => buildGoldenReplayReport(scenarioSet(160, 160)))
      .toThrow('canonical customer denominator must contain exactly 161 scenarios');
    expect(() => buildGoldenReplayReport(scenarioSet(0, 0)))
      .toThrow('canonical customer denominator must contain exactly 161 scenarios');
  });

  it('fails customer scenario closure when captured-field parity hides a missing scenario', () => {
    const golden = { entries: [
      entry('payloads/captured.json', '/captured', {
        object: 'content', action: 'interacted', page_cas_id: '/captured',
      }),
      entry('payloads/missing.json', '/missing', {
        object: 'content', action: 'interacted', page_cas_id: '/missing',
      }),
    ] };
    const manifest = { scenarios: [
      { scenarioId: 'captured', page: '/captured', goldenRef: { payloadFile: 'payloads/captured.json' } },
      { scenarioId: 'missing', page: '/missing', goldenRef: { payloadFile: 'payloads/missing.json' } },
    ] };
    const state = bind(manifest, {
      status: 'complete', coverage: { total: 2, pending: 0 }, resume: { nextScenarioId: null },
      outcomes: [
        {
          scenarioId: 'captured', status: 'captured',
          payload: {
            type: 'track', event: 'content:interacted',
            properties: { object: 'content', action: 'interacted', page_cas_id: '/captured' },
          },
        },
        { scenarioId: 'missing', status: 'missing', reason: 'sheet-target-not-rendered' },
      ],
    });

    const report = buildTestReport({ golden, manifest, state });
    expect(report.summary.metadataParity.adjusted.percent).toBe(100);
    expect(report.summary.scenarioClosure).toEqual({
      total: 2,
      reproducedPassing: 1,
      unresolved: 1,
      required: 2,
      percent: 50,
      threshold: 99,
      verdict: 'FAIL',
      unresolvedScenarioIds: ['missing'],
    });
    expect(report.summary.closureVerdict).toBe('FAIL');
    expect(report.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenarioId: 'captured', scenarioClosureStatus: 'reproduced-passing' }),
      expect.objectContaining({ scenarioId: 'missing', scenarioClosureStatus: 'unresolved' }),
    ]));
  });

  it('requires at least 160 of the immutable 161 scenarios for 99% closure', () => {
    const passing = buildGoldenReplayReport(scenarioSet(161, 160));
    expect(passing.summary.scenarioClosure).toMatchObject({
      total: 161, reproducedPassing: 160, required: 160, percent: 99.4, threshold: 99, verdict: 'PASS',
    });

    const failing = buildGoldenReplayReport(scenarioSet(161, 159));
    expect(failing.summary.scenarioClosure).toMatchObject({
      total: 161, reproducedPassing: 159, required: 160, percent: 98.8, threshold: 99, verdict: 'FAIL',
    });
  });

  it('keeps captured-field diagnostics from independently deciding customer closure', () => {
    const inputs = scenarioSet(161, 160);
    const unresolved = inputs.manifest.scenarios[160];
    inputs.golden.entries[160].fullPayload.properties.project_asset_id = 'asset-only-in-golden';
    inputs.state.outcomes[160] = {
      scenarioId: unresolved.scenarioId,
      status: 'captured',
      payload: {
        type: 'track', event: 'content:interacted',
        properties: {
          object: 'content', action: 'interacted', page_cas_id: unresolved.page,
        },
      },
    };

    const report = buildGoldenReplayReport(inputs);
    expect(report.summary.scenarioClosure).toMatchObject({
      reproducedPassing: 160, unresolved: 1, verdict: 'PASS',
    });
    expect(report.summary.capturedFieldDiagnostics).toMatchObject({ score: 0 });
    expect(report.summary.capturedFieldDiagnostics).not.toHaveProperty('verdict');
    expect(report.summary.metadataParity).not.toHaveProperty('verdict');
    expect(report.summary).not.toHaveProperty('policyAdjusted');
    expect(report.summary.closureVerdict).toBe('PASS');
    expect(renderGoldenReplayHtml(report)).toContain('Captured-field diagnostic');
  });

  it('labels captured-field metrics separately from customer scenario closure', () => {
    const report = buildTestReport(scenarioSet(2, 1));
    expect(report.summary.coverage).not.toHaveProperty('replayablePercent');
    expect(report.summary).not.toHaveProperty('replayableCapturePercent');

    const html = renderGoldenReplayHtml(report);
    expect(html).toContain('Customer scenario closure 1/2');
    expect(html).toContain('Captured-field exact metadata parity');
    expect(html).toContain('Captured-field accepted metadata deviations');
    expect(html).toContain('Captured-field diagnostic (exact + accepted)');
    expect(html).not.toContain('replayablePercent');
    expect(html).not.toContain('replayableCapturePercent');
  });

  it('prioritizes the largest unresolved capture and parity gaps in the concise summary', () => {
    const inputs = scenarioSet(3, 1);
    [1, 2].forEach((index) => {
      inputs.golden.entries[index].page = '/shared-gap';
      inputs.manifest.scenarios[index].page = '/shared-gap';
      inputs.state.outcomes[index].reason = 'target-not-proven';
    });

    const report = buildTestReport(inputs);
    expect(report.summary.nextGaps[0]).toEqual({
      kind: 'capture',
      page: '/shared-gap',
      status: 'missing',
      count: 2,
      scenarioIds: ['scenario-002', 'scenario-003'],
    });
    expect(renderGoldenReplayHtml(report)).toContain('Next highest-impact gaps');
    expect(renderGoldenReplayHtml(report)).toContain('/shared-gap · missing · 2');
  });

  it('writes CLI evidence before returning nonzero for a failing closure', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'golden-replay-report-'));
    const jsonOutput = join(outputDirectory, 'report.json');
    const htmlOutput = join(outputDirectory, 'report.html');
    try {
      const paths = writeCliFixture(outputDirectory);
      const args = [
        '--golden', paths.golden,
        '--manifest', paths.manifest,
        '--identity-lock', paths.identityLock,
        '--deviations', paths.deviations,
        '--state', paths.state,
        '--json-out', jsonOutput,
        '--html-out', htmlOutput,
      ];
      const result = spawnSync(process.execPath, [
        'scripts/diff/golden-replay-report.mjs',
        ...args,
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(existsSync(jsonOutput)).toBe(true);
      expect(existsSync(htmlOutput)).toBe(true);
      expect(JSON.parse(readFileSync(jsonOutput, 'utf8')).summary.closureVerdict).not.toBe('PASS');

      const originalExitCode = process.exitCode;
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const report = main(args);
        expect(report.summary.closureVerdict).not.toBe('PASS');
        expect(process.exitCode).toBe(originalExitCode);
      } finally {
        log.mockRestore();
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

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
    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.schemaVersion).toBe(3);
    expect(report.summary).not.toHaveProperty('parity');
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
    expect(report.summary.metadataParity).toEqual({
      totalFields: 7,
      exact: { fields: 4, percent: 57.1 },
      accepted: {
        fields: 2,
        percent: 28.6,
        byClassification: {
          'expected-migration': 2,
          'production-data-quality': 0,
          'approved-golden-correction': 0,
        },
        byPolicy: { 'normalized-equivalence': 1, 'pathname-policy': 1 },
      },
      adjusted: { fields: 6, percent: 85.7 },
      bugs: { fields: 1, percent: 14.3 },
      investigations: { fields: 0, percent: 0 },
      events: {
        captured: 1,
        exact: 0,
        accepted: 0,
        failing: 1,
        unscored: 0,
        exactPercent: 0,
        adjustedPercent: 0,
      },
    });
    expect(report.events.find((row) => row.scenarioId === 'one')).toMatchObject({
      metadataTotal: 7,
      metadataExact: 4,
      metadataAccepted: 2,
      metadataBugs: 1,
      metadataInvestigations: 0,
      metadataParityBasis: 'failing',
    });
    const html = renderGoldenReplayHtml(report);
    expect(html).toContain('Captured-field exact metadata parity');
    expect(html).toContain('Captured-field accepted metadata deviations');
    expect(html).toContain('Captured-field diagnostic (exact + accepted)');
    expect(html).toContain('Actionable bugs');
    expect(html).toContain('Open investigations');
    expect(html).toContain('Context presence');
    expect(html).toContain('Captured scenario coverage');
    expect(html).toContain('Raw equality');
    expect(html).toContain('Policy equality');
    expect(html).toContain('Presence');
    expect(html).toContain('Parity basis');
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

    const report = buildTestReport({ golden, manifest, state: bind(manifest, state) });
    expect(report.fields.find((row) => row.field === 'url'))
      .toMatchObject({ category: 'open-investigation', policy: 'url-fragment-evidence-limited', match: false });
    expect(report.fields.find((row) => row.field === 'channel_cookie_90day'))
      .toMatchObject({ category: 'environment-session-context', policy: 'environment-attribution', match: false });
    expect(report.summary.fieldCounts).toMatchObject({ 'open-investigation': 1, 'stage-bug': 0 });
    expect(report.summary.capturedFieldDiagnostics).toMatchObject({
      score: 100, openInvestigations: 1,
    });
    expect(report.summary.closureVerdict).toBe('FAIL');
  });

  it('accepts empty-fragment normalization only for the four adjudicated scenario fields', () => {
    const acceptedCases = [
      ['customer-accounting-business-intelligence-rep-1012e0719631', 'link_href'],
      ['customer-accounting-business-intelligence-rep-0c6dcf41ec48', 'url'],
      ['customer-accounting-business-intelligence-rep-602d8ad063b8', 'url'],
      ['customer-accounting-business-intelligence-rep-13bc3a301b0d', 'url'],
    ];
    const unrelatedCase = ['customer-accounting-business-intelligence-rep-unrelated', 'url'];
    const page = '/accounting/business-intelligence-reports';
    const goldenUrl = 'https://erp.intuit.com/accounting/business-intelligence-reports/#';
    const stageUrl = 'https://stage.erp.intuit.com/accounting/business-intelligence-reports';
    const fixture = (cases) => {
      const golden = { entries: cases.map(([scenarioId, field]) => entry(
        `payloads/${scenarioId}.json`, page,
        {
          object: 'content', action: 'interacted', page_cas_id: page, [field]: goldenUrl,
        },
      )) };
      const manifest = { scenarios: cases.map(([scenarioId]) => ({
        scenarioId,
        page,
        goldenRef: { payloadFile: `payloads/${scenarioId}.json` },
      })) };
      const state = bind(manifest, {
        status: 'complete', coverage: { total: cases.length, pending: 0 }, resume: { nextScenarioId: null },
        outcomes: cases.map(([scenarioId, field]) => ({
          scenarioId,
          pathname: page,
          status: 'captured',
          pageCasId: page,
          payload: {
            type: 'track',
            event: 'content:interacted',
            properties: {
              object: 'content', action: 'interacted', page_cas_id: page, [field]: stageUrl,
            },
          },
        })),
      });
      return { golden, manifest, state };
    };

    const unadjudicated = buildTestReport({
      ...fixture(acceptedCases),
      deviations: registry(),
    });
    expect(unadjudicated.fields.filter(({ policy }) => policy === 'url-fragment-evidence-limited'))
      .toHaveLength(4);
    expect(unadjudicated.fields.filter(({ policy }) => policy === 'url-fragment-evidence-limited'))
      .toSatisfy((rows) => rows.every(({ category }) => category === 'open-investigation'));
    expect(unadjudicated.events)
      .toSatisfy((events) => events.every(({ metadataParityBasis }) => metadataParityBasis === 'failing'));

    const adjudicated = buildTestReport({
      ...fixture([...acceptedCases, unrelatedCase]),
      deviations: canonicalDeviationRegistry,
    });
    acceptedCases.forEach(([scenarioId, field]) => {
      expect(adjudicated.fields.find((row) => row.scenarioId === scenarioId && row.field === field))
        .toMatchObject({
          category: 'expected-migration',
          policy: 'url-fragment-evidence-limited',
          adjudication: expect.objectContaining({ reviewDate: '2026-08-31' }),
        });
      expect(adjudicated.events.find((event) => event.scenarioId === scenarioId))
        .toMatchObject({
          metadataParityBasis: 'accepted-deviations',
          scenarioClosureStatus: 'reproduced-passing',
        });
    });
    expect(adjudicated.fields.find((row) => row.scenarioId === unrelatedCase[0] && row.field === 'url'))
      .toMatchObject({ category: 'open-investigation', policy: 'url-fragment-evidence-limited' });

    const wrongField = buildTestReport({
      ...fixture([[acceptedCases[0][0], 'url']]),
      deviations: canonicalDeviationRegistry,
    });
    expect(wrongField.fields.find((row) => row.field === 'url'))
      .toMatchObject({ category: 'open-investigation', policy: 'url-fragment-evidence-limited' });
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
    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
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
    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.rawExact).toMatchObject({
      score: 0,
      axes: { page: { score: 66.7 }, event: { score: 75 }, component: { score: 75 }, field: { score: 0 } },
    });
    expect(report.summary.capturedFieldDiagnostics).toMatchObject({
      score: 50, weakest: 'field=50%',
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
    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.presence).toEqual({ present: 0, total: 1, gaps: 1, percent: 0, verdict: 'FAIL' });
    expect(report.summary.context).toMatchObject({ rows: 1, differences: 1, missingPresence: 1 });
    expect(report.summary.fieldCounts).toMatchObject({ 'environment-session-context': 1, 'stage-bug': 0 });
    expect(report.summary.capturedFieldDiagnostics).toMatchObject({ score: 100 });
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
    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
    expect(report.summary.pageCasId).toMatchObject({
      captured: 1, exactPathname: 0, percent: 0, verdict: 'FAIL', failures: ['one'],
    });
    expect(report.summary.capturedFieldDiagnostics.openInvestigations).toBe(1);
    expect(report.summary.capturedFieldDiagnostics).not.toHaveProperty('verdict');
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

    const report = buildTestReport({
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

    const report = buildTestReport({ golden, manifest, state: bind(manifest, state), deviations });
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
    expect(() => buildTestReport({ golden, manifest, state }))
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
    const report = buildTestReport({
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
