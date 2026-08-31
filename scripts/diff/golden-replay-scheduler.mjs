#!/usr/bin/env node
/**
 * Resumable complete-customer-golden scheduler. It delegates each proposed
 * interaction to the independently qualified one-page runner, checkpoints the
 * terminal outcome, and preserves missing/ambiguous/passive dispositions.
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-console, no-restricted-syntax, max-len, no-await-in-loop, no-plusplus, no-underscore-dangle */
import { chromium } from 'playwright';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCdpEndpoint } from './live-replay-harness.mjs';
import { validateGoldenReplayManifest } from './golden-replay-manifest.mjs';
import {
  createReplayRunState, nextReplayScenario, recordScenarioOutcome,
  requestScenarioReruns, validateReplayResume, writeReplayCheckpoint,
} from './golden-replay-run-state.mjs';

const EXACT_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_CDP = 'http://127.0.0.1:9339';
const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_LOCK = '.jig/click-tracking-harness/evidence/customer-golden-identity-lock.json';
const DEFAULT_MANIFEST = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const DEFAULT_STATE = 'scripts/diff/fixtures/local/clicktrack-golden-replay-run.json';
const DEFAULT_EVIDENCE = 'scripts/diff/fixtures/local/complete-golden-replay';
const RUNNER_PATH = resolve('scripts/diff/live-replay-runner.mjs');
const SCENARIO_TIMEOUT_MS = 120000;
const PROCESS_KILL_GRACE_MS = 5000;
const MAX_QUALIFICATION_ATTEMPTS = 2;
const HARNESS_VERSION = 'complete-golden-v1';
const SOURCE_FILES = [
  'scripts/diff/golden-replay-scheduler.mjs',
  'scripts/diff/golden-replay-run-state.mjs',
  'scripts/diff/live-replay-runner.mjs',
  'scripts/diff/live-replay-harness.mjs',
];

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const safeError = (value) => [...String(value || 'unknown error')].map((character) => {
  const code = character.codePointAt(0);
  return code <= 31 || (code >= 127 && code <= 159) || /\p{Bidi_Control}/u.test(character) ? '?' : character;
}).join('').replace(/([?#]).*$/, '');

export function recoveryTargetUrl(currentUrl, origin, pathname) {
  if (origin !== EXACT_ORIGIN) throw new Error(`exact stage origin is required: ${EXACT_ORIGIN}`);
  const target = new URL(pathname, origin);
  if (target.origin !== EXACT_ORIGIN || target.pathname !== pathname) {
    throw new Error(`reviewed stage pathname is invalid: ${pathname}`);
  }
  if (typeof currentUrl !== 'string') return target.href;
  return target.href;
}

export function qualificationFailureReason(error, journal, scenarioId) {
  const outcome = journal?.scenarioOutcomes?.find((candidate) => candidate.scenarioId === scenarioId);
  if (journal?.source === 'authenticated-one-page-replay-journal'
    && journal?.origin === EXACT_ORIGIN && journal?.status === 'refused'
    && outcome?.status === 'refused' && outcome.reason) {
    return safeError(outcome.reason);
  }
  return safeError(error?.message);
}

export function shouldRetryQualification(reason) {
  return /bound target must be|preflight refused: (?:consent|utag|webAnalytics\.track|analytics\._dispatch)|authenticated stage browser preflight failed|timed out waiting for serialized lineage|scenario qualification timed out|page\.waitForFunction: Timeout|target (?:origin|preparation)|unexpected cross-origin navigation|cleanup/i.test(String(reason || ''));
}

export function isRunBindingDrift(reason) {
  return /lineage qualification binding does not match|uniform (?:page )?deployment identity changed/i
    .test(String(reason || ''));
}

export function replayReadiness(scope) {
  const currentScope = scope || window;
  const visibleBanner = [...currentScope.document.querySelectorAll('#onetrust-banner-sdk, [id*="onetrust-banner" i]')]
    .some((element) => {
      const style = currentScope.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  const ecs = currentScope.intuit?.tracking?.ecs;
  return (typeof currentScope.OneTrust === 'object' || typeof currentScope.OneTrust === 'function')
    && !visibleBanner && typeof currentScope.utag === 'object'
    && typeof ecs?.webAnalytics?.track === 'function'
    && typeof ecs?.analytics?._dispatch === 'function';
}

export function runQualificationProcess(args, {
  spawnImpl = spawn,
  timeoutMs = SCENARIO_TIMEOUT_MS,
  killGraceMs = PROCESS_KILL_GRACE_MS,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  return new Promise((accept, reject) => {
    let child;
    try {
      child = spawnImpl(process.execPath, [RUNNER_PATH, ...args], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let timedOut = false;
    let killTimer;
    let timer;
    let stderrTail = '';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (error) reject(error);
      else accept();
    };
    child.stdout?.on('data', (chunk) => stdout.write(chunk));
    child.stderr?.on('data', (chunk) => {
      stderr.write(chunk);
      stderrTail = `${stderrTail}${chunk}`.slice(-4096);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      if (timedOut) {
        finish(new Error(`scenario qualification timed out after ${timeoutMs}ms`));
      } else if (code === 0) finish();
      else finish(new Error(stderrTail.trim() || `scenario qualification exited ${code ?? signal}`));
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
  });
}

export function buildQualificationScenario(scenario, {
  lineageMode = 'capture', lineageQualification = '',
} = {}) {
  if (scenario.locator?.status !== 'proposed') throw new Error(`scenario locator is not proposed: ${scenario.scenarioId}`);
  const candidate = scenario.locator.evidence?.candidate || {};
  const role = scenario.locator.role || candidate.role || (candidate.tag === 'A' ? 'link' : 'button');
  const name = scenario.locator.accessibleName || candidate.accessibleName || '';
  if (!role || !name) throw new Error(`scenario locator lacks accessible identity: ${scenario.scenarioId}`);
  return {
    schemaVersion: 1,
    scenarioId: scenario.scenarioId,
    page: scenario.page,
    runtimeAssets: scenario.runtimeAssets || [],
    goldenRef: scenario.goldenRef,
    locator: {
      ...(scenario.locator.strategy === 'data-track-id' ? { trackId: scenario.locator.value } : {}),
      ...((scenario.locator.region || candidate.region) ? { region: scenario.locator.region || candidate.region } : {}),
      role,
      name,
      exact: true,
      ...(['tag', 'href', 'block', 'requireNoBlock', 'occurrence', 'occurrenceEvidence']
        .reduce((fields, key) => (Object.hasOwn(scenario.locator, key)
          ? { ...fields, [key]: scenario.locator[key] } : fields), {})),
    },
    preconditions: scenario.preconditions || {},
    setupSteps: scenario.setupSteps || [],
    interaction: {
      type: 'click',
      preventNavigation: scenario.interaction?.preventNavigation !== false,
      testText: 'Adobe Migration Test',
      activationCount: lineageMode === 'capture' ? 1 : 3,
    },
    lineage: {
      mode: lineageMode,
      ...(lineageQualification ? { qualificationArtifact: lineageQualification } : {}),
    },
  };
}

export function selectLineageQualificationScenario(manifest) {
  const candidates = manifest.scenarios.filter((scenario) => scenario.locator?.status === 'proposed'
    && (scenario.locator.role || scenario.locator.evidence?.candidate?.role) === 'link'
    && !(scenario.setupSteps || []).length
    && !Object.keys(scenario.preconditions || {}).length);
  const selected = candidates.find((scenario) => {
    try { return new URL(scenario.locator.href).origin !== EXACT_ORIGIN; } catch { return false; }
  }) || candidates[0];
  if (!selected) throw new Error('complete replay has no stateless reviewed link for lineage qualification');
  return selected;
}

export function disposeUnreplayableScenarios(initial, manifest) {
  let state = initial;
  const byId = new Map(state.outcomes.map((outcome) => [outcome.scenarioId, outcome]));
  for (const scenario of manifest.scenarios) {
    if (byId.get(scenario.scenarioId)?.status === 'pending') {
      if (scenario.locator?.status === 'missing') {
        state = recordScenarioOutcome(state, manifest, scenario.scenarioId, {
          status: 'missing',
          reason: scenario.locator.evidence?.diagnosis || 'reviewed stage locator is missing',
        });
      } else if (scenario.locator?.status === 'ambiguous') {
        state = recordScenarioOutcome(state, manifest, scenario.scenarioId, {
          status: 'unreproducible',
          reason: scenario.locator.evidence?.diagnosis || 'reviewed stage locator is ambiguous',
        });
      } else if (scenario.locator?.status === 'blocked') {
        state = recordScenarioOutcome(state, manifest, scenario.scenarioId, {
          status: 'blocked',
          reason: scenario.locator.evidence?.diagnosis || 'reviewed stage page is blocked',
        });
      }
    }
  }
  return state;
}

export function captureDeploymentFingerprint(capture) {
  const global = capture.provenance?.global || {};
  const identity = {
    origin: global.origin,
    browser: global.browser,
    deployedHashes: global.deployedHashes,
    tealium: global.tealium,
    trackerResources: global.trackerResources,
  };
  return sha256(JSON.stringify(canonical(identity)));
}

export function capturePageFingerprint(capture) {
  const page = capture.pages?.[0] || {};
  const sameOriginScripts = [...(page.provenance?.sameOriginScripts || [])]
    .sort((left, right) => JSON.stringify(canonical(left)).localeCompare(JSON.stringify(canonical(right))));
  const identity = {
    pathname: page.pathname,
    document: page.provenance?.document,
    interactionInventoryHash: page.provenance?.interactionInventoryHash,
    sameOriginScripts,
  };
  return sha256(JSON.stringify(canonical(identity)));
}

export function validateQualificationCapture(capture, scenario, authorizationRef, manifestBinding, lineageQualification) {
  const page = capture.pages?.[0];
  const event = page?.events?.find((candidate) => candidate.scenarioId === scenario.scenarioId);
  const outcome = page?.outcomes?.find((candidate) => candidate.scenarioId === scenario.scenarioId);
  if (lineageQualification
    && (capture.qualification?.lineageMode !== 'capture'
      || capture.qualification?.lineageQualification?.artifactSha256 !== lineageQualification.sha256)) {
    throw new Error(`qualification lineage qualification is invalid: ${scenario.scenarioId}`);
  }
  if (capture.status !== 'complete' || capture.golden?.scenarioId !== scenario.scenarioId
    || capture.golden?.payloadFile !== scenario.goldenRef.payloadFile
    || capture.qualification?.transportPolicy !== 'observe'
    || capture.qualification?.authorizationRef !== authorizationRef
    || (manifestBinding && (capture.qualification?.completeGoldenManifest?.contentHash !== manifestBinding.contentHash
      || capture.qualification?.completeGoldenManifest?.mappingHash !== manifestBinding.mappingHash))
    || page?.pathname !== scenario.page || !event?.payload || outcome?.status !== 'captured') {
    throw new Error(`qualification capture is invalid: ${scenario.scenarioId}`);
  }
  const pageCasId = event.payload.properties?.page_cas_id;
  if (pageCasId !== scenario.page) throw new Error(`qualification page_cas_id is invalid: ${scenario.scenarioId}`);
  return {
    payload: event.payload,
    pageCasId,
    messageId: outcome.messageId,
    invocationId: outcome.invocationId,
    locator: outcome.locator,
  };
}

function validateLineageProofCapture(capture, scenario, authorizationRef, manifestBinding, bytes) {
  if (capture.status !== 'complete' || capture.qualification?.lineageMode !== 'proof'
    || capture.qualification?.authorizationRef !== authorizationRef
    || capture.qualification?.completeGoldenManifest?.contentHash !== manifestBinding.contentHash
    || capture.qualification?.completeGoldenManifest?.mappingHash !== manifestBinding.mappingHash) {
    throw new Error('lineage qualification capture is invalid');
  }
  validateQualificationCapture(capture, scenario, authorizationRef, manifestBinding);
  return {
    scenarioId: scenario.scenarioId,
    artifact: { path: '', sha256: sha256(bytes) },
    targetId: capture.qualification.targetId,
    profileId: capture.qualification.profileId,
    chromeVersion: capture.qualification.chromeVersion,
    qualifiedAt: capture.qualification.qualifiedAt,
    expiresAt: capture.qualification.expiresAt,
    deploymentFingerprint: captureDeploymentFingerprint(capture),
  };
}

function atomicWrite(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return target;
}

async function browserBinding(options) {
  const browser = await chromium.connectOverCDP(validateCdpEndpoint(options.cdp));
  try {
    const contexts = browser.contexts();
    if (contexts.length !== 1 || contexts[0].pages().length !== 1) throw new Error('dedicated CDP must have one context and one target');
    const page = contexts[0].pages()[0];
    const preflight = await page.evaluate(() => {
      const loginUi = Boolean(document.querySelector('input[type="password"], form[action*="login" i], [data-testid*="login" i]'));
      const consentBanner = Boolean(document.querySelector('#onetrust-banner-sdk:not([style*="display: none"])'));
      return {
        origin: window.location.origin,
        authenticated: !loginUi,
        consentState: (typeof window.OneTrust === 'object' || typeof window.OneTrust === 'function') && !consentBanner
          ? 'resolved' : 'unresolved',
        utagReady: typeof window.utag === 'object',
        trackerReady: typeof window.intuit?.tracking?.ecs?.webAnalytics?.track === 'function',
        enqueueReady: typeof window.intuit?.tracking?.ecs?.analytics?._dispatch === 'function',
      };
    });
    if (preflight.origin !== options.origin || !preflight.authenticated || preflight.consentState !== 'resolved'
      || !preflight.utagReady || !preflight.trackerReady || !preflight.enqueueReady) {
      throw new Error('authenticated stage browser preflight failed');
    }
    return {
      origin: options.origin,
      profileId: options.profileId,
      chromeVersion: await browser.version(),
      harnessVersion: HARNESS_VERSION,
      sourceHashes: Object.fromEntries(SOURCE_FILES.map((path) => [path, sha256(readFileSync(path))])),
      consentState: preflight.consentState,
      authenticationState: 'authenticated',
      authorizationRef: options.authorizationRef,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function prepareTarget(options, pathname) {
  const browser = await chromium.connectOverCDP(validateCdpEndpoint(options.cdp));
  try {
    const contexts = browser.contexts();
    if (contexts.length !== 1 || contexts[0].pages().length !== 1) throw new Error('dedicated CDP must have one context and one target');
    const page = contexts[0].pages()[0];
    const recoveryUrl = recoveryTargetUrl(page.url(), options.origin, pathname);
    if (recoveryUrl) await page.goto(recoveryUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__adobeMigrationReplay == null
      && window.__adobeMigrationReplayTarget == null, null, { timeout: 15000 });
    await page.waitForFunction(replayReadiness, null, { timeout: 45000 });
    const prepared = new URL(page.url());
    if (prepared.origin !== options.origin || prepared.pathname !== pathname) {
      throw new Error(`dedicated target preparation failed: ${pathname}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export function parseArgs(argv) {
  const options = {
    cdp: DEFAULT_CDP,
    origin: EXACT_ORIGIN,
    profileId: 'intuit-erp-clicktrack',
    golden: DEFAULT_GOLDEN,
    identityLock: DEFAULT_LOCK,
    manifest: DEFAULT_MANIFEST,
    out: DEFAULT_STATE,
    evidenceDir: DEFAULT_EVIDENCE,
    authorizationRef: '',
    maxScenarios: Infinity,
    retentionDays: 30,
    rerunScenarioIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--cdp') options.cdp = argv[++index];
    else if (argv[index] === '--origin') options.origin = argv[++index];
    else if (argv[index] === '--profile-id') options.profileId = argv[++index];
    else if (argv[index] === '--golden') options.golden = argv[++index];
    else if (argv[index] === '--identity-lock') options.identityLock = argv[++index];
    else if (argv[index] === '--manifest') options.manifest = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--evidence-dir') options.evidenceDir = argv[++index];
    else if (argv[index] === '--authorization-ref') options.authorizationRef = argv[++index];
    else if (argv[index] === '--max-scenarios') options.maxScenarios = Number(argv[++index]);
    else if (argv[index] === '--retention-days') options.retentionDays = Number(argv[++index]);
    else if (argv[index] === '--rerun-scenario') options.rerunScenarioIds.push(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.origin !== EXACT_ORIGIN) throw new Error(`exact stage origin is required: ${EXACT_ORIGIN}`);
  if (!options.authorizationRef) throw new Error('--authorization-ref is required');
  if (!(options.maxScenarios === Infinity || (Number.isInteger(options.maxScenarios) && options.maxScenarios > 0))) {
    throw new Error('--max-scenarios must be a positive integer');
  }
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const golden = JSON.parse(readFileSync(options.golden, 'utf8'));
  const identityLock = JSON.parse(readFileSync(options.identityLock, 'utf8'));
  validateGoldenReplayManifest(manifest, golden, identityLock);
  const binding = await browserBinding(options);
  let state;
  if (existsSync(options.out)) {
    state = JSON.parse(readFileSync(options.out, 'utf8'));
    validateReplayResume(state, manifest, binding);
  } else {
    state = createReplayRunState(manifest, binding);
  }
  if (options.rerunScenarioIds.length) {
    state = requestScenarioReruns(state, manifest, options.rerunScenarioIds);
  }
  state = disposeUnreplayableScenarios(state, manifest);
  writeReplayCheckpoint(options.out, state);
  const pendingReplay = nextReplayScenario(state, manifest);
  const lineagePath = resolve(options.evidenceDir, 'live-replay-lineage-qualification.json');
  if (pendingReplay && !state.lineageQualification) {
    const proofScenario = selectLineageQualificationScenario(manifest);
    const proofDefinition = buildQualificationScenario(proofScenario, { lineageMode: 'proof' });
    const proofScenarioPath = resolve(options.evidenceDir, `scenario-${proofScenario.scenarioId}.json`);
    atomicWrite(proofScenarioPath, proofDefinition);
    await prepareTarget(options, proofScenario.page);
    await runQualificationProcess([
      'qualify', '--cdp', options.cdp, '--origin', options.origin,
      '--profile-id', options.profileId, '--scenario', proofScenarioPath,
      '--scenario-root', resolve(options.evidenceDir),
      '--manifest-content-hash', manifest.manifestContentHash,
      '--golden-mapping-hash', manifest.goldenMappingHash,
      '--golden', resolve(options.golden), '--out', lineagePath,
      '--transport', 'observe', '--authorization-ref', options.authorizationRef,
      '--evidence-dir', resolve(options.evidenceDir), '--retention-days', String(options.retentionDays),
      '--lineage-mode', 'proof',
    ]);
    const proofBytes = readFileSync(lineagePath);
    const qualification = validateLineageProofCapture(
      JSON.parse(proofBytes.toString('utf8')),
      proofScenario,
      options.authorizationRef,
      { contentHash: manifest.manifestContentHash, mappingHash: manifest.goldenMappingHash },
      proofBytes,
    );
    qualification.artifact.path = lineagePath;
    state = {
      ...state,
      lineageQualification: qualification,
      deployment: {
        fingerprint: qualification.deploymentFingerprint,
        establishedByScenarioId: `lineage-proof:${proofScenario.scenarioId}`,
      },
    };
    writeReplayCheckpoint(options.out, state);
  } else if (pendingReplay) {
    const proofBytes = readFileSync(state.lineageQualification.artifact.path);
    if (sha256(proofBytes) !== state.lineageQualification.artifact.sha256) {
      throw new Error('lineage qualification artifact changed during resume');
    }
  }
  let attempted = 0;
  while (nextReplayScenario(state, manifest) && attempted < options.maxScenarios) {
    const scenario = nextReplayScenario(state, manifest);
    const qualificationScenario = buildQualificationScenario(scenario, {
      lineageMode: 'capture', lineageQualification: state.lineageQualification.artifact.path,
    });
    const scenarioPath = resolve(options.evidenceDir, `scenario-${scenario.scenarioId}.json`);
    const capturePath = resolve(options.evidenceDir, `live-replay-${scenario.scenarioId}.json`);
    atomicWrite(scenarioPath, qualificationScenario);
    let terminalResult;
    for (let qualificationAttempt = 1; qualificationAttempt <= MAX_QUALIFICATION_ATTEMPTS; qualificationAttempt += 1) {
      try {
        await prepareTarget(options, scenario.page);
        await runQualificationProcess([
          'qualify', '--cdp', options.cdp, '--origin', options.origin,
          '--profile-id', options.profileId, '--scenario', scenarioPath,
          '--scenario-root', resolve(options.evidenceDir),
          '--manifest-content-hash', manifest.manifestContentHash,
          '--golden-mapping-hash', manifest.goldenMappingHash,
          '--golden', resolve(options.golden), '--out', capturePath,
          '--transport', 'observe', '--authorization-ref', options.authorizationRef,
          '--evidence-dir', resolve(options.evidenceDir), '--retention-days', String(options.retentionDays),
          '--lineage-mode', 'capture', '--lineage-qualification', state.lineageQualification.artifact.path,
        ]);
        const captureBytes = readFileSync(capturePath);
        const capture = JSON.parse(captureBytes.toString('utf8'));
        const linked = validateQualificationCapture(capture, scenario, options.authorizationRef, {
          contentHash: manifest.manifestContentHash,
          mappingHash: manifest.goldenMappingHash,
        }, state.lineageQualification.artifact);
        const deploymentFingerprint = captureDeploymentFingerprint(capture);
        if (state.deployment?.fingerprint && state.deployment.fingerprint !== deploymentFingerprint) {
          throw new Error('uniform deployment identity changed during the complete-golden run');
        }
        if (!state.deployment) {
          state = {
            ...state,
            deployment: {
              fingerprint: deploymentFingerprint,
              establishedByScenarioId: scenario.scenarioId,
            },
          };
        }
        const pageDeploymentFingerprint = capturePageFingerprint(capture);
        const previousPageFingerprint = state.pageDeployments?.[scenario.page];
        if (previousPageFingerprint && previousPageFingerprint !== pageDeploymentFingerprint) {
          throw new Error('uniform page deployment identity changed during the complete-golden run');
        }
        state = {
          ...state,
          pageDeployments: { ...(state.pageDeployments || {}), [scenario.page]: pageDeploymentFingerprint },
        };
        terminalResult = {
          status: 'captured',
          attempts: qualificationAttempt,
          ...linked,
          artifact: { path: capturePath, sha256: sha256(captureBytes) },
          deploymentFingerprint,
          pageDeploymentFingerprint,
        };
        break;
      } catch (error) {
        if (isRunBindingDrift(error.message)) {
          writeReplayCheckpoint(options.out, state);
          throw error;
        }
        let refusalJournal = null;
        try { refusalJournal = JSON.parse(readFileSync(capturePath, 'utf8')); } catch { /* fallback below */ }
        const reason = qualificationFailureReason(error, refusalJournal, scenario.scenarioId);
        if (isRunBindingDrift(reason)) {
          writeReplayCheckpoint(options.out, state);
          throw new Error(reason);
        }
        const retry = qualificationAttempt < MAX_QUALIFICATION_ATTEMPTS && shouldRetryQualification(reason);
        if (!retry) {
          terminalResult = { status: 'blocked', reason, attempts: qualificationAttempt };
          break;
        }
      }
    }
    state = recordScenarioOutcome(state, manifest, scenario.scenarioId, terminalResult);
    attempted += 1;
    writeReplayCheckpoint(options.out, state);
  }
  console.log(JSON.stringify({
    output: options.out,
    status: state.status,
    attempted,
    coverage: state.coverage,
    nextScenarioId: state.resume.nextScenarioId,
  }, null, 2));
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(safeError(error.message)); process.exitCode = 1; });
}
