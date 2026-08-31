import {
  describe, expect, it,
} from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildQualificationScenario, captureDeploymentFingerprint, capturePageFingerprint,
  disposeUnreplayableScenarios, isRunBindingDrift, parseArgs,
  nextSelectedReplayScenario, qualificationFailureReason, recoveryTargetUrl, replayReadiness, runQualificationProcess,
  selectLineageQualificationScenario, shouldRetryQualification,
  validateQualificationCapture,
} from '../scripts/diff/golden-replay-scheduler.mjs';
import { createReplayRunState } from '../scripts/diff/golden-replay-run-state.mjs';

const binding = {
  origin: 'https://stage.erp.intuit.com',
  profileId: 'dedicated-stage',
  chromeVersion: '151',
  harnessVersion: 'complete-golden-v1',
  sourceHashes: { scheduler: 'sha256:one' },
  consentState: 'resolved',
  authenticationState: 'authenticated',
  authorizationRef: 'customer-authorized Adobe Migration Test',
};

const scenario = (scenarioId, status, locator = {}) => ({
  scenarioId,
  page: '/events',
  goldenRef: { payloadFile: `payloads/${scenarioId}.json` },
  runtimeAssets: ['/blocks/event-cards/event-cards.js'],
  classification: { interaction: status === 'passive' ? 'passive' : 'interactive' },
  locator: { status, ...locator },
  preconditions: {},
  interaction: { type: status === 'passive' ? 'passive' : 'click', preventNavigation: true },
});

const manifest = () => ({
  schemaVersion: 1,
  manifestContentHash: 'sha256:manifest',
  goldenMappingHash: 'sha256:mapping',
  goldenIdentityLock: { identitySha256: 'identity' },
  scenarios: [
    scenario('tracked', 'proposed', {
      strategy: 'data-track-id', value: 'cards:register',
      evidence: { candidate: { role: 'link', accessibleName: 'Register' } },
    }),
    scenario('semantic', 'proposed', {
      strategy: 'semantic', region: 'main', role: 'button', accessibleName: 'Watch now',
    }),
    scenario('missing', 'missing', { evidence: { diagnosis: 'sheet-target-not-rendered' } }),
    scenario('ambiguous', 'ambiguous', { evidence: { diagnosis: 'semantic-duplicate' } }),
    scenario('chat', 'passive'),
  ],
});

describe('complete golden replay scheduler', () => {
  it('converts reviewed manifest locators to bounded one-page qualification scenarios', () => {
    const [tracked, semantic] = manifest().scenarios;
    expect(buildQualificationScenario(tracked)).toMatchObject({
      scenarioId: 'tracked',
      locator: { trackId: 'cards:register', role: 'link', name: 'Register', exact: true },
      interaction: { testText: 'Adobe Migration Test', preventNavigation: true },
    });
    expect(buildQualificationScenario(semantic)).toMatchObject({
      locator: { region: 'main', role: 'button', name: 'Watch now', exact: true },
    });
    expect(() => buildQualificationScenario(manifest().scenarios[2])).toThrow(/not proposed/i);
  });

  it('carries stable block, occurrence, setup, and lineage-proof constraints into a one-click capture', () => {
    const reviewed = scenario('reviewed', 'proposed', {
      strategy: 'semantic', region: 'widget', role: 'link', accessibleName: 'Visit support page',
      block: '', requireNoBlock: true, occurrence: 2,
      occurrenceEvidence: { stableConstraint: 'two identical authored controls in widget' },
    });
    reviewed.setupSteps = [{ type: 'click', locator: { trackId: 'talk-to-sales:talk-to-sales' } }];
    const built = buildQualificationScenario(reviewed, {
      lineageMode: 'capture', lineageQualification: '/tmp/lineage-proof.json',
    });
    expect(built).toMatchObject({
      locator: {
        region: 'widget', role: 'link', name: 'Visit support page', block: '', requireNoBlock: true,
        occurrence: 2, occurrenceEvidence: { stableConstraint: expect.any(String) },
      },
      setupSteps: [{ type: 'click' }],
      lineage: { mode: 'capture', qualificationArtifact: '/tmp/lineage-proof.json' },
      interaction: { activationCount: 1 },
    });
  });

  it('chooses a stateless reviewed link for one-time lineage qualification', () => {
    const source = manifest();
    source.scenarios[0].locator.href = 'https://stage.erp.intuit.com/';
    source.scenarios[1].locator.role = 'link';
    source.scenarios[1].locator.accessibleName = 'Watch now';
    source.scenarios[1].locator.href = 'https://www.intuit.com/';
    expect(selectLineageQualificationScenario(source)).toMatchObject({ scenarioId: 'semantic' });

    source.scenarios[0].setupSteps = [{ type: 'click' }];
    expect(selectLineageQualificationScenario(source)).toMatchObject({ scenarioId: 'semantic' });
    source.scenarios[1].locator.role = 'button';
    expect(() => selectLineageQualificationScenario(source)).toThrow(/stateless reviewed link/i);
  });

  it('checkpoints missing and ambiguous dispositions without shrinking the denominator', () => {
    const source = manifest();
    source.scenarios.push(scenario('blocked-page', 'blocked', { evidence: { diagnosis: 'page authentication failed' } }));
    const initial = createReplayRunState(source, binding);
    const state = disposeUnreplayableScenarios(initial, source);
    expect(state.outcomes.map(({ status }) => status)).toEqual([
      'pending', 'pending', 'missing', 'unreproducible', 'passive', 'blocked',
    ]);
    expect(state.coverage).toMatchObject({ total: 6, pending: 2, blocked: 1, missing: 1, unreproducible: 1, passive: 1 });
  });

  it('extracts one linked payload and fingerprints only uniform deployment identity', () => {
    const sourceScenario = manifest().scenarios[0];
    const capture = {
      status: 'complete',
      golden: { scenarioId: 'tracked', payloadFile: 'payloads/tracked.json' },
      qualification: { transportPolicy: 'observe', authorizationRef: binding.authorizationRef },
      provenance: { global: {
        capturedAt: 'time-one', runId: 'child-one', origin: binding.origin,
        harness: { sourceHashes: { scenario: 'different-per-child' } },
        browser: { name: 'Chrome', version: '151', profileId: 'dedicated-stage', targetId: 'target-one' },
        deployedHashes: { 'tracking.js': 'sha256:tracking' },
        tealium: { profileUrl: 'https://tags.tiqcdn.com/utag/intuit/erp/prod/utag.js', contentHash: 'sha256:utag' },
        trackerResources: { policyVersion: 1, resources: [{ role: 'sender', contentHash: 'sha256:sender' }] },
      } },
      pages: [{
        pathname: '/events',
        events: [{ scenarioId: 'tracked', payload: { event: 'content:interacted', properties: { page_cas_id: '/events' } } }],
        outcomes: [{ scenarioId: 'tracked', status: 'captured', messageId: 'message-one', invocationId: 'invoke-one' }],
      }],
    };
    expect(validateQualificationCapture(capture, sourceScenario, binding.authorizationRef)).toMatchObject({
      pageCasId: '/events', messageId: 'message-one', payload: { event: 'content:interacted' },
    });
    const first = captureDeploymentFingerprint(capture);
    capture.provenance.global.capturedAt = 'time-two';
    capture.provenance.global.runId = 'child-two';
    capture.provenance.global.harness.sourceHashes.scenario = 'changed';
    expect(captureDeploymentFingerprint(capture)).toBe(first);
    const firstPage = capturePageFingerprint(capture);
    capture.pages[0].provenance = {
      document: { contentHash: 'sha256:document-two' },
      interactionInventoryHash: 'sha256:inventory-two',
      sameOriginScripts: [
        { url: '/scripts/tracking.js', contentHash: 'sha256:tracking-two' },
        { url: '/blocks/cards/cards.js', contentHash: 'sha256:cards-two' },
      ],
    };
    expect(captureDeploymentFingerprint(capture)).toBe(first);
    expect(capturePageFingerprint(capture)).not.toBe(firstPage);
    const pageFingerprint = capturePageFingerprint(capture);
    capture.pages[0].provenance.sameOriginScripts.reverse();
    expect(capturePageFingerprint(capture)).toBe(pageFingerprint);
    capture.pages[0].events[0].payload.properties.page_cas_id = '/wrong';
    expect(() => validateQualificationCapture(capture, sourceScenario, binding.authorizationRef))
      .toThrow(/page_cas_id/i);
  });

  it('requires every scenario capture to cite the one bound lineage-proof artifact', () => {
    const sourceScenario = manifest().scenarios[0];
    const capture = {
      status: 'complete',
      golden: { scenarioId: 'tracked', payloadFile: 'payloads/tracked.json' },
      qualification: {
        transportPolicy: 'observe', authorizationRef: binding.authorizationRef,
        lineageMode: 'capture', lineageQualification: { artifactSha256: 'sha256:proof' },
      },
      pages: [{
        pathname: '/events',
        events: [{ scenarioId: 'tracked', payload: { properties: { page_cas_id: '/events' } } }],
        outcomes: [{ scenarioId: 'tracked', status: 'captured', messageId: 'message', invocationId: 'invoke' }],
      }],
    };
    expect(validateQualificationCapture(
      capture, sourceScenario, binding.authorizationRef, null, { sha256: 'sha256:proof' },
    )).toMatchObject({ messageId: 'message' });
    capture.qualification.lineageQualification.artifactSha256 = 'sha256:other';
    expect(() => validateQualificationCapture(
      capture, sourceScenario, binding.authorizationRef, null, { sha256: 'sha256:proof' },
    )).toThrow(/lineage qualification/i);
  });

  it('terminates a stuck one-page qualification at the scenario deadline', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    const spawnImpl = () => child;
    await expect(runQualificationProcess(['qualify'], {
      spawnImpl,
      timeoutMs: 5,
      killGraceMs: 5,
      stdout: { write() {} },
      stderr: { write() {} },
    })).rejects.toThrow(/scenario qualification timed out after 5ms/i);
  });

  it('resets every scenario by navigating to the exact reviewed stage page', () => {
    const origin = 'https://stage.erp.intuit.com';
    expect(recoveryTargetUrl('https://quickbooks.intuit.com/', origin, '/events'))
      .toBe('https://stage.erp.intuit.com/events');
    expect(recoveryTargetUrl('https://stage.erp.intuit.com/events', origin, '/events'))
      .toBe('https://stage.erp.intuit.com/events');
    expect(recoveryTargetUrl('https://stage.erp.intuit.com/events#schedule', origin, '/events'))
      .toBe('https://stage.erp.intuit.com/events');
    expect(recoveryTargetUrl('https://stage.erp.intuit.com/events?source=test', origin, '/events'))
      .toBe('https://stage.erp.intuit.com/events');
    expect(() => recoveryTargetUrl('https://stage.erp.intuit.com/events', 'https://example.com', '/events'))
      .toThrow(/exact stage origin/i);
  });

  it('uses the refused child journal reason instead of truncated process stderr', () => {
    const journal = {
      source: 'authenticated-one-page-replay-journal',
      origin: 'https://stage.erp.intuit.com',
      status: 'refused',
      scenarioOutcomes: [{ scenarioId: 'tracked', status: 'refused', reason: 'preflight refused: consent' }],
    };
    expect(qualificationFailureReason(new Error('{\n  "verdict": "REFUSED"'), journal, 'tracked'))
      .toBe('preflight refused: consent');
    expect(qualificationFailureReason(new Error('scenario qualification timed out after 5ms'), null, 'tracked'))
      .toBe('scenario qualification timed out after 5ms');
  });

  it('retries transient browser and tracker conditions but not reviewed locator failures', () => {
    expect(shouldRetryQualification('bound target must be https://stage.erp.intuit.com/events')).toBe(true);
    expect(shouldRetryQualification('preflight refused: consent')).toBe(true);
    expect(shouldRetryQualification('timed out waiting for serialized lineage: tracked')).toBe(true);
    expect(shouldRetryQualification('scenario qualification timed out after 120000ms')).toBe(true);
    expect(shouldRetryQualification('scenario locator resolved 0 elements')).toBe(false);
    expect(shouldRetryQualification('scenario locator resolved 2 elements')).toBe(false);
  });

  it('treats proof or deployment drift as a run-level refusal', () => {
    expect(isRunBindingDrift('lineage qualification binding does not match capture deployment/browser/session')).toBe(true);
    expect(isRunBindingDrift('uniform deployment identity changed during the complete-golden run')).toBe(true);
    expect(isRunBindingDrift('uniform page deployment identity changed during the complete-golden run')).toBe(true);
    expect(isRunBindingDrift('scenario locator resolved 0 elements')).toBe(false);
  });

  it('accepts explicit repeatable completed-scenario rerun requests', () => {
    expect(parseArgs(['--authorization-ref', 'Adobe Migration Test', '--rerun-scenario', 'one', '--rerun-scenario', 'two']))
      .toMatchObject({ rerunScenarioIds: ['one', 'two'] });
  });

  it('can bound a replay run to explicitly selected scenario ids', () => {
    const source = manifest();
    const state = disposeUnreplayableScenarios(createReplayRunState(source, binding), source);
    expect(parseArgs(['--authorization-ref', 'Adobe Migration Test', '--only-scenario', 'semantic']))
      .toMatchObject({ selectedScenarioIds: ['semantic'] });
    expect(nextSelectedReplayScenario(state, source, ['semantic']))
      .toMatchObject({ scenarioId: 'semantic' });
    expect(nextSelectedReplayScenario(state, source, [])).toMatchObject({ scenarioId: 'tracked' });
    expect(() => nextSelectedReplayScenario(state, source, ['not-in-manifest']))
      .toThrow(/selected scenario is not in manifest/i);
  });

  it('does not release a scenario until consent and every tracker layer are ready', () => {
    const scope = {
      document: { querySelectorAll: () => [] },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      OneTrust: {},
      utag: {},
      intuit: { tracking: { ecs: { webAnalytics: { track() {} }, analytics: { _dispatch() {} } } } },
    };
    expect(replayReadiness(scope)).toBe(true);
    scope.document.querySelectorAll = () => [{}];
    expect(replayReadiness(scope)).toBe(false);
    scope.document.querySelectorAll = () => [];
    scope.OneTrust = undefined;
    expect(replayReadiness(scope)).toBe(false);
  });
});
