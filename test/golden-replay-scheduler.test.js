import {
  describe, expect, it,
} from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildQualificationScenario, captureDeploymentFingerprint, disposeUnreplayableScenarios,
  qualificationFailureReason, recoveryTargetUrl, replayReadiness, runQualificationProcess, shouldRetryQualification,
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
      strategy: 'semantic', role: 'button', accessibleName: 'Watch now',
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
      locator: { role: 'button', name: 'Watch now', exact: true },
    });
    expect(() => buildQualificationScenario(manifest().scenarios[2])).toThrow(/not proposed/i);
  });

  it('checkpoints missing and ambiguous dispositions without shrinking the denominator', () => {
    const source = manifest();
    const initial = createReplayRunState(source, binding);
    const state = disposeUnreplayableScenarios(initial, source);
    expect(state.outcomes.map(({ status }) => status)).toEqual([
      'pending', 'pending', 'missing', 'unreproducible', 'passive',
    ]);
    expect(state.coverage).toMatchObject({ total: 5, pending: 2, missing: 1, unreproducible: 1, passive: 1 });
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
    capture.pages[0].events[0].payload.properties.page_cas_id = '/wrong';
    expect(() => validateQualificationCapture(capture, sourceScenario, binding.authorizationRef))
      .toThrow(/page_cas_id/i);
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

  it('recovers a poisoned target only by navigating to the exact reviewed stage page', () => {
    const origin = 'https://stage.erp.intuit.com';
    expect(recoveryTargetUrl('https://quickbooks.intuit.com/', origin, '/events'))
      .toBe('https://stage.erp.intuit.com/events');
    expect(recoveryTargetUrl('https://stage.erp.intuit.com/events', origin, '/events')).toBeNull();
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
