/**
 * Pure resumable-state contract for complete customer-golden replay. Browser
 * execution records one terminal outcome at a time and atomically checkpoints.
 */
/* eslint-disable no-restricted-syntax, max-len, no-use-before-define */
import {
  chmodSync, mkdirSync, renameSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const TERMINAL = new Set(['captured', 'blocked', 'passive', 'unreproducible', 'missing']);

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const fingerprint = (value) => JSON.stringify(canonical(value));
const clone = (value) => JSON.parse(JSON.stringify(value));

function resumeBinding(manifest, binding) {
  return {
    manifest: {
      schemaVersion: manifest.schemaVersion,
      contentHash: manifest.manifestContentHash,
      mappingHash: manifest.goldenMappingHash,
    },
    goldenIdentityLock: manifest.goldenIdentityLock,
    browser: {
      origin: binding.origin,
      profileId: binding.profileId,
      chromeVersion: binding.chromeVersion,
    },
    harness: {
      version: binding.harnessVersion,
      sourceHashes: binding.sourceHashes,
    },
    consentState: binding.consentState,
    authenticationState: binding.authenticationState,
    authorizationRef: binding.authorizationRef,
  };
}

function refreshState(state, manifest) {
  const updated = { ...state, updatedAt: new Date().toISOString() };
  updated.coverage = replayCoverageSummary(updated, manifest);
  updated.resume = {
    completedScenarioIds: updated.outcomes.filter(({ status }) => TERMINAL.has(status))
      .map(({ scenarioId }) => scenarioId),
    nextScenarioId: nextReplayScenario(updated, manifest)?.scenarioId || null,
    canResume: true,
  };
  updated.status = updated.resume.nextScenarioId ? 'in-progress' : 'complete';
  return updated;
}

export function replayCoverageSummary(state, manifest) {
  const outcomeById = new Map((state.outcomes || []).map((outcome) => [outcome.scenarioId, outcome]));
  const statusCount = (status) => manifest.scenarios.filter(({ scenarioId }) => outcomeById.get(scenarioId)?.status === status).length;
  return {
    total: manifest.scenarios.length,
    captured: statusCount('captured'),
    pending: statusCount('pending'),
    blocked: statusCount('blocked'),
    passive: statusCount('passive'),
    unreproducible: statusCount('unreproducible'),
    missing: statusCount('missing'),
    duplicate: manifest.scenarios.filter(({ classification }) => classification?.duplicate).length,
    variant: manifest.scenarios.filter(({ classification }) => classification?.variant).length,
  };
}

export function nextReplayScenario(state, manifest) {
  const outcomeById = new Map((state.outcomes || []).map((outcome) => [outcome.scenarioId, outcome]));
  return manifest.scenarios.find(({ scenarioId }) => outcomeById.get(scenarioId)?.status === 'pending') || null;
}

export function createReplayRunState(manifest, binding, { previousRunId = null } = {}) {
  const startedAt = new Date().toISOString();
  const state = {
    schemaVersion: 1,
    source: 'authenticated-complete-golden-replay',
    runId: randomUUID(),
    previousRunId,
    startedAt,
    updatedAt: startedAt,
    status: 'in-progress',
    binding: resumeBinding(manifest, binding),
    pageFailures: [],
    outcomes: manifest.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      pathname: scenario.page,
      status: scenario.classification?.interaction === 'passive' ? 'passive' : 'pending',
      attempts: 0,
      classification: {
        duplicate: Boolean(scenario.classification?.duplicate),
        variant: Boolean(scenario.classification?.variant),
      },
    })),
  };
  return refreshState(state, manifest);
}

export function validateReplayResume(state, manifest, binding) {
  if (!state || state.source !== 'authenticated-complete-golden-replay') throw new Error('resume state is invalid');
  if (fingerprint(state.binding) !== fingerprint(resumeBinding(manifest, binding))) {
    throw new Error('resume binding changed; start a new complete-golden run');
  }
  const expectedIds = manifest.scenarios.map(({ scenarioId }) => scenarioId);
  const actualIds = (state.outcomes || []).map(({ scenarioId }) => scenarioId);
  if (fingerprint(expectedIds) !== fingerprint(actualIds)) throw new Error('resume binding changed; scenario denominator differs');
  return state;
}

export function recordScenarioOutcome(state, manifest, scenarioId, result, { rerun = false } = {}) {
  const scenario = manifest.scenarios.find((candidate) => candidate.scenarioId === scenarioId);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
  if (!TERMINAL.has(result?.status) || result.status === 'passive') throw new Error(`invalid recorded outcome: ${result?.status}`);
  const updated = clone(state);
  const index = updated.outcomes.findIndex((outcome) => outcome.scenarioId === scenarioId);
  const previous = updated.outcomes[index];
  if (TERMINAL.has(previous.status) && !rerun) throw new Error(`scenario already completed: ${scenarioId}`);
  updated.outcomes[index] = {
    ...previous,
    ...clone(result),
    scenarioId,
    pathname: scenario.page,
    attempts: Number.isInteger(result.attempts) && result.attempts > 0
      ? result.attempts : Number(previous.attempts || 0) + 1,
    recordedAt: new Date().toISOString(),
  };
  return refreshState(updated, manifest);
}

export function requestScenarioReruns(state, manifest, scenarioIds) {
  const requested = [...new Set(scenarioIds || [])];
  const updated = clone(state);
  requested.forEach((scenarioId) => {
    const scenario = manifest.scenarios.find((candidate) => candidate.scenarioId === scenarioId);
    if (!scenario) throw new Error(`unknown rerun scenario: ${scenarioId}`);
    const index = updated.outcomes.findIndex((outcome) => outcome.scenarioId === scenarioId);
    const previous = updated.outcomes[index];
    if (previous.status === 'passive') throw new Error(`passive scenario cannot be rerun: ${scenarioId}`);
    if (!TERMINAL.has(previous.status)) throw new Error(`scenario is not completed: ${scenarioId}`);
    updated.outcomes[index] = {
      scenarioId,
      pathname: scenario.page,
      status: 'pending',
      attempts: previous.attempts,
      classification: previous.classification,
      rerunOf: { status: previous.status, recordedAt: previous.recordedAt || null },
    };
  });
  return refreshState(updated, manifest);
}

export function recordPageFailure(state, manifest, pathname, reason) {
  const updated = clone(state);
  updated.pageFailures.push({ pathname, reason: String(reason), recordedAt: new Date().toISOString() });
  const scenarioById = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  updated.outcomes = updated.outcomes.map((outcome) => {
    const scenario = scenarioById.get(outcome.scenarioId);
    if (scenario?.page !== pathname || outcome.status !== 'pending') return outcome;
    return {
      ...outcome,
      status: 'blocked',
      reason: String(reason),
      attempts: Number(outcome.attempts || 0) + 1,
      recordedAt: new Date().toISOString(),
    };
  });
  return refreshState(updated, manifest);
}

export function writeReplayCheckpoint(path, state) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return target;
}
