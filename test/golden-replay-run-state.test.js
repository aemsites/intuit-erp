import {
  describe, expect, it,
} from 'vitest';
import {
  mkdtempSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createReplayRunState, nextReplayScenario, recordPageFailure, recordScenarioOutcome,
  replayCoverageSummary, validateReplayResume, writeReplayCheckpoint,
} from '../scripts/diff/golden-replay-run-state.mjs';

const scenario = (scenarioId, page, classification = {}) => ({
  scenarioId,
  page,
  classification: {
    interaction: 'interactive', duplicate: false, variant: false, disposition: 'pending-stage-inventory',
    ...classification,
  },
});

const manifest = () => ({
  schemaVersion: 1,
  manifestContentHash: `sha256:${'a'.repeat(64)}`,
  goldenMappingHash: `sha256:${'b'.repeat(64)}`,
  goldenIdentityLock: { identitySha256: 'c'.repeat(64), payloadManifest: { sha256: 'd'.repeat(64) } },
  scenarios: [
    scenario('hero', '/one'),
    scenario('repeat', '/one', { duplicate: true }),
    scenario('chat', '/two', { interaction: 'passive', structuralException: true, disposition: 'passive' }),
    scenario('variant', '/two', { variant: true }),
  ],
});

const binding = () => ({
  origin: 'https://stage.erp.intuit.com',
  profileId: 'dedicated-stage',
  chromeVersion: '151.0.0.0',
  harnessVersion: '0.3.0',
  sourceHashes: { runner: `sha256:${'e'.repeat(64)}` },
  consentState: 'resolved',
  authenticationState: 'authenticated',
  authorizationRef: 'customer-authorized Adobe Migration Test',
});

describe('complete golden replay run state', () => {
  it('keeps the full denominator and starts passive scenarios explicitly disposed', () => {
    const state = createReplayRunState(manifest(), binding());
    expect(state.outcomes).toHaveLength(4);
    expect(state.outcomes.find(({ scenarioId }) => scenarioId === 'chat')).toMatchObject({ status: 'passive' });
    expect(replayCoverageSummary(state, manifest())).toMatchObject({
      total: 4, captured: 0, pending: 3, passive: 1, duplicate: 1, variant: 1,
    });
  });

  it('resumes at the first unfinished scenario without repeating completed work', () => {
    const source = manifest();
    let state = createReplayRunState(source, binding());
    state = recordScenarioOutcome(state, source, 'hero', { status: 'captured', pageCasId: '/one' });
    expect(nextReplayScenario(state, source)).toMatchObject({ scenarioId: 'repeat' });
    expect(validateReplayResume(state, source, binding())).toBe(state);
    expect(() => recordScenarioOutcome(state, source, 'hero', { status: 'captured' })).toThrow(/already completed/i);
    expect(recordScenarioOutcome(state, source, 'hero', { status: 'captured' }, { rerun: true }))
      .toMatchObject({ outcomes: expect.arrayContaining([expect.objectContaining({ scenarioId: 'hero', attempts: 2 })]) });
  });

  it('records the actual number of qualification attempts for a terminal outcome', () => {
    const source = manifest();
    const state = recordScenarioOutcome(createReplayRunState(source, binding()), source, 'hero', {
      status: 'blocked', reason: 'persistent transient', attempts: 2,
    });
    expect(state.outcomes.find(({ scenarioId }) => scenarioId === 'hero')).toMatchObject({ attempts: 2 });
  });

  it('refuses resume after manifest, golden, browser, consent, or source drift', () => {
    const source = manifest();
    const state = createReplayRunState(source, binding());
    const mutations = [
      [() => ({ ...source, manifestContentHash: `sha256:${'9'.repeat(64)}` }), binding()],
      [() => ({ ...source, goldenIdentityLock: { ...source.goldenIdentityLock, identitySha256: '9'.repeat(64) } }), binding()],
      [() => source, { ...binding(), chromeVersion: '152.0.0.0' }],
      [() => source, { ...binding(), consentState: 'unresolved' }],
      [() => source, { ...binding(), authenticationState: 'anonymous' }],
      [() => source, { ...binding(), sourceHashes: { runner: `sha256:${'9'.repeat(64)}` } }],
    ];
    mutations.forEach(([nextManifest, nextBinding]) => {
      expect(() => validateReplayResume(state, nextManifest(), nextBinding)).toThrow(/resume binding changed/i);
    });
  });

  it('records a page failure without discarding earlier results or shrinking coverage', () => {
    const source = manifest();
    let state = createReplayRunState(source, binding());
    state = recordScenarioOutcome(state, source, 'hero', { status: 'captured', pageCasId: '/one' });
    state = recordPageFailure(state, source, '/two', 'authentication readiness failed');
    expect(replayCoverageSummary(state, source)).toMatchObject({
      total: 4, captured: 1, blocked: 1, passive: 1, pending: 1,
    });
    expect(state.outcomes).toHaveLength(4);
    expect(state.pageFailures).toEqual([expect.objectContaining({ pathname: '/two' })]);
  });

  it('writes a mode-0600 checkpoint that round-trips after every outcome', () => {
    const directory = mkdtempSync(join(tmpdir(), 'golden-replay-state-'));
    try {
      const path = join(directory, 'run.json');
      const source = manifest();
      const state = recordScenarioOutcome(
        createReplayRunState(source, binding()), source, 'hero', { status: 'captured', pageCasId: '/one' },
      );
      writeReplayCheckpoint(path, state);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(state);
      expect((Number(statSync(path).mode) & 0o777)).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
