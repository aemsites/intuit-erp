#!/usr/bin/env node
/**
 * Qualify and replay one customer-golden interaction in a dedicated,
 * authenticated Chrome profile connected through loopback-only CDP.
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-console, no-restricted-syntax, no-restricted-globals, no-underscore-dangle, no-await-in-loop, no-plusplus, no-continue, no-void, consistent-return, max-len */
import { chromium } from 'playwright';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  REPLAY_INVOCATION_MARKER_KEY, REPLAY_LINEAGE_POLICY_VERSION, canonicalReplayPath, installReplayPageHook,
  replayPathMatches, validateCdpEndpoint, validateQualification,
} from './live-replay-harness.mjs';
import { POLICY } from './oracle-lib.mjs';

const HARNESS_VERSION = '0.2.8';
const TRACKER_POLICY_VERSION = '1';
const EVIDENCE_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_CDP = 'http://127.0.0.1:9229';
const DEFAULT_PROFILE = resolve(homedir(), '.intuit-erp-clicktrack', 'chrome-profile');
const MARKER_GUARD_ROUTE = '**/*';

export function requestBodyContainsReplayMarker(request) {
  const body = request?.postDataBuffer?.();
  if (body) return body.includes(REPLAY_INVOCATION_MARKER_KEY);
  const text = request?.postData?.();
  return typeof text === 'string' && text.includes(REPLAY_INVOCATION_MARKER_KEY);
}
const DEFAULT_SCENARIO = 'scripts/diff/fixtures/clicktrack-qualification-scenario.json';
const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_OUT = 'scripts/diff/fixtures/local/live-replay-qualification.json';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPLAY_ORIGINAL_TARGET_KEY = '__adobeMigrationReplayOriginalTarget';
const HARNESS_SOURCE_FILES = {
  'live-replay-harness.mjs': resolve('scripts/diff/live-replay-harness.mjs'),
  'live-replay-runner.mjs': resolve('scripts/diff/live-replay-runner.mjs'),
  'clicktrack-qualification-scenario.json': resolve(DEFAULT_SCENARIO),
};

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
const cleanUrl = (value) => {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
};
const harnessSourceHashes = (scenarioPath = DEFAULT_SCENARIO) => Object.fromEntries(Object.entries({
  ...HARNESS_SOURCE_FILES,
  'clicktrack-qualification-scenario.json': resolve(scenarioPath),
})
  .map(([name, path]) => [name, sha256(readFileSync(path))]));

function parseArgs(argv) {
  const options = {
    command: argv[0] && !argv[0].startsWith('--') ? argv[0] : 'qualify',
    cdp: DEFAULT_CDP,
    origin: DEFAULT_ORIGIN,
    profileDir: DEFAULT_PROFILE,
    profileId: 'intuit-erp-clicktrack',
    scenario: DEFAULT_SCENARIO,
    scenarioRoot: '',
    manifestContentHash: '',
    goldenMappingHash: '',
    golden: DEFAULT_GOLDEN,
    out: DEFAULT_OUT,
    transport: 'observe',
    authorizationRef: '',
    abortAuthorizationRef: '',
    chromeExecutable: DEFAULT_CHROME,
    port: 9229,
    print: false,
    evidenceDir: dirname(DEFAULT_OUT),
    retentionDays: 30,
    lineageMode: '',
    lineageQualification: '',
  };
  const start = options.command === 'qualify' && argv[0]?.startsWith('--') ? 0 : 1;
  for (let index = start; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cdp') options.cdp = argv[++index];
    else if (argument === '--origin') options.origin = argv[++index];
    else if (argument === '--profile-dir') options.profileDir = resolve(argv[++index]);
    else if (argument === '--profile-id') options.profileId = argv[++index];
    else if (argument === '--scenario') options.scenario = argv[++index];
    else if (argument === '--scenario-root') options.scenarioRoot = resolve(argv[++index]);
    else if (argument === '--manifest-content-hash') options.manifestContentHash = argv[++index];
    else if (argument === '--golden-mapping-hash') options.goldenMappingHash = argv[++index];
    else if (argument === '--golden') options.golden = argv[++index];
    else if (argument === '--out') options.out = argv[++index];
    else if (argument === '--transport') options.transport = argv[++index];
    else if (argument === '--authorization-ref') options.authorizationRef = argv[++index];
    else if (argument === '--abort-authorization-ref') options.abortAuthorizationRef = argv[++index];
    else if (argument === '--chrome-executable') options.chromeExecutable = argv[++index];
    else if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--print') options.print = true;
    else if (argument === '--evidence-dir') options.evidenceDir = resolve(argv[++index]);
    else if (argument === '--retention-days') options.retentionDays = Number(argv[++index]);
    else if (argument === '--lineage-mode') options.lineageMode = argv[++index];
    else if (argument === '--lineage-qualification') options.lineageQualification = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function purgeEvidence(directory, { now = Date.now(), retentionDays = 30 } = {}) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error('retention days must be from 1 through 365');
  }
  if (!existsSync(directory)) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const deleted = [];
  for (const name of readdirSync(directory)) {
    if (!/^live-replay-[a-z0-9._-]+\.json$/i.test(name)) continue;
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs >= cutoff) continue;
    unlinkSync(path);
    deleted.push(path);
  }
  return deleted;
}

function createRunJournal(options, scenario, previous) {
  return {
    schemaVersion: 1,
    source: 'authenticated-one-page-replay-journal',
    status: 'in-progress',
    attempt: Number(previous?.attempt || 0) + 1,
    previousRunId: previous?.runId || previous?.provenance?.global?.runId || null,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    origin: options.origin,
    transportPolicy: options.transport,
    authorizationRef: options.authorizationRef,
    scenarioOutcomes: [{ scenarioId: scenario.scenarioId, status: 'pending' }],
    resume: { completedScenarioIds: [], nextScenarioId: scenario.scenarioId, canResume: true },
  };
}

function launchArguments(options) {
  if (options.origin !== DEFAULT_ORIGIN) throw new Error(`exact stage origin is required: ${DEFAULT_ORIGIN}`);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error('debugging port must be an integer from 1024 through 65535');
  }
  const defaultChromeProfile = resolve(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  if (resolve(options.profileDir) === defaultChromeProfile) {
    throw new Error('the everyday Chrome profile cannot be used as the harness profile');
  }
  return [
    `--user-data-dir=${resolve(options.profileDir)}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${options.port}`,
    '--no-first-run',
    '--no-default-browser-check',
    `${options.origin}${canonicalReplayPath('/workforce-automation')}`,
  ];
}

function selectDedicatedOriginPage(pages, origin) {
  if (pages.length !== 1) throw new Error(`dedicated CDP expected exactly one target, got ${pages.length}`);
  const page = pages[0];
  let url;
  try { url = new URL(page.url()); } catch { throw new Error('bound target URL is invalid'); }
  if (url.origin !== origin) throw new Error(`bound target must remain on ${origin}`);
  return page;
}

function selectDedicatedPage(pages, origin, pathname) {
  const page = selectDedicatedOriginPage(pages, origin);
  const url = new URL(page.url());
  if (!replayPathMatches(url.pathname, pathname)) {
    throw new Error(`bound target must be ${origin}${canonicalReplayPath(pathname)}`);
  }
  return page;
}

function createTargetGuard(boundPage, origin) {
  const violations = [];
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return 'invalid-url';
    }
  };
  return {
    observePage(candidate) {
      if (candidate !== boundPage) violations.push(`unexpected target: ${safeUrl(candidate?.url?.() || '')}`);
    },
    observeNavigation(value) {
      try {
        if (new URL(value).origin !== origin) violations.push(`cross-origin navigation: ${safeUrl(value)}`);
      } catch {
        violations.push('invalid navigation target: invalid-url');
      }
    },
    observeClose() { violations.push('bound target lost'); },
    assert() {
      if (violations.length) throw new Error(`target isolation refused: ${violations.join(', ')}`);
    },
    snapshot: () => [...violations],
  };
}

function assertCleanReuseState(state, expectedTargetId) {
  if (state?.targetId !== expectedTargetId) throw new Error('disconnect cleanup target identity changed');
  const cleanupCounts = Object.values(state.cleanupAttestation?.cleared || {});
  if (!state.replayAbsent || !state.targetMarkerAbsent || state.wrappedFunctions?.length
    || state.cleanupAttestation?.restored !== true
    || state.cleanupAttestation?.targetMarker !== state.expectedTargetMarker
    || !cleanupCounts.length || cleanupCounts.some((count) => count !== 0)) {
    throw new Error(`disconnect cleanup failed: ${(state.wrappedFunctions || []).join(', ') || 'marker/callback survived'}`);
  }
  return state;
}

function portAvailable(port, serverFactory = createServer) {
  return new Promise((accept) => {
    const server = serverFactory();
    server.once('error', () => accept(false));
    server.once('listening', () => server.close(() => accept(true)));
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

async function launch(options) {
  const args = launchArguments(options);
  const rendered = [options.chromeExecutable, ...args].map((part) => JSON.stringify(part)).join(' ');
  if (options.print) {
    console.log(rendered);
    return;
  }
  if (!existsSync(options.chromeExecutable)) throw new Error(`Chrome executable not found: ${options.chromeExecutable}`);
  if (!await portAvailable(options.port)) throw new Error(`debugging port is already in use: ${options.port}`);
  mkdirSync(options.profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(options.chromeExecutable, args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(JSON.stringify({
    launched: true,
    cdp: `http://127.0.0.1:${options.port}`,
    profileDir: options.profileDir,
    next: 'Authenticate the opened stage page once, then run the qualify command.',
  }, null, 2));
}

function goldenScenario(golden, scenario) {
  const matches = golden.entries.filter((entry) => entry.page === scenario.page
    && entry.payloadFile === scenario.goldenRef?.payloadFile);
  if (matches.length !== 1) throw new Error(`scenario goldenRef resolved ${matches.length} entries`);
  return matches[0];
}

function assertCanonicalScenarioPath(path, approval = {}) {
  const canonical = resolve(DEFAULT_SCENARIO);
  const candidate = resolve(path);
  if (candidate === canonical) return canonical;
  const approvedHash = /^sha256:[a-f0-9]{64}$/;
  const approvedRoot = approval.scenarioRoot ? resolve(approval.scenarioRoot) : '';
  let generatedApproved = false;
  if (approvedRoot && dirname(candidate) === approvedRoot
    && /^scenario-customer-[a-z0-9-]+\.json$/.test(candidate.slice(approvedRoot.length + 1))
    && approvedHash.test(approval.manifestContentHash || '')
    && approvedHash.test(approval.goldenMappingHash || '')
    && existsSync(candidate)) {
    const stat = lstatSync(candidate);
    generatedApproved = stat.isFile() && !stat.isSymbolicLink()
      && dirname(realpathSync(candidate)) === realpathSync(approvedRoot);
  }
  if (!generatedApproved) throw new Error(`qualification scenario must be the reviewed canonical file: ${canonical}`);
  return candidate;
}

function deriveAllowlist(payload, policy = POLICY) {
  const keys = (bucket, location, object) => Object.entries(policy?.[bucket]?.[location] || {})
    .filter(([key, spec]) => spec && typeof spec === 'object' && Object.hasOwn(object || {}, key))
    .map(([key]) => key);
  const allowlist = {
    envelope: keys('gated', 'envelope', payload),
    properties: keys('gated', 'properties', payload?.properties),
    context: keys('gated', 'context', payload?.context),
    integrations: keys('gated', 'integrations', payload?.integrations),
    metadata: policy?.gated?.envelope?._metadata ? Object.keys(payload?._metadata || {}) : [],
  };
  const shapeOnly = {
    envelope: keys('presenceFrozen', 'envelope', payload),
    properties: keys('presenceFrozen', 'properties', payload?.properties),
    context: keys('presenceFrozen', 'context', payload?.context),
    integrations: keys('presenceFrozen', 'integrations', payload?.integrations),
    metadata: [],
  };
  return { allowlist, shapeOnly };
}

function activationEvidence(preflight, replay) {
  const scriptUrls = [...new Set(preflight?.scriptUrls || [])];
  const tealiumTagUids = scriptUrls.flatMap((url) => {
    const match = /\/utag\.(\d+)\.js$/.exec(url);
    return match ? [match[1]] : [];
  }).sort((left, right) => Number(left) - Number(right));
  const resources = scriptUrls
    .filter((url) => /(?:\/utag\.js|\/track-event-lib(?:-init)?\.min\.js)$/.test(url))
    .sort();
  const vendorCalls = [...new Set((replay?.evidence?.serialized || []).flatMap((entry) => (
    /^https:\/\/eventbus\.intuit\.com\/v2\/segment\/intuit-general-clickstream\/(?:t|b)$/.test(entry.requestUrl || '')
      ? ['eventbus:intuit-general-clickstream'] : []
  )))].sort();
  return { tealiumTagUids, resources, vendorCalls };
}

async function withDeadline(task, timeoutMs, label, onTimeout = () => {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(task), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function hashUrl(url, { fetchImpl = fetch, timeoutMs = EVIDENCE_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  try {
    const bytes = await withDeadline(
      async () => {
        const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
        if (!response.ok) throw new Error(`asset hash fetch failed ${response.status}: ${cleanUrl(url)}`);
        return response.arrayBuffer();
      },
      timeoutMs,
      'asset hash fetch',
      () => controller.abort(),
    );
    return sha256(Buffer.from(bytes));
  } finally {
    controller.abort();
  }
}

async function browserPreflight(page, origin, timeoutMs = EVIDENCE_FETCH_TIMEOUT_MS) {
  return withDeadline(() => page.evaluate(async ({ expectedOrigin, fetchTimeoutMs }) => {
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return `sha256:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    };
    const clean = (value) => {
      const url = new URL(value, location.href);
      return `${url.origin}${url.pathname}`;
    };
    const visible = (element) => element && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden';
    const ctaSelector = [
      'main a[href]', 'main button', 'main summary', 'main [role="button"]',
      'header a[href]', 'header button', 'header summary', 'header [role="button"]',
      'footer a[href]', 'footer button', 'footer summary', 'footer [role="button"]',
    ].join(', ');
    const trackables = [...document.querySelectorAll(ctaSelector)]
      .filter((element) => !element.closest('[data-track-skip]'))
      .map((element) => ({
        tag: element.tagName,
        id: element.getAttribute('data-track-id') || '',
        waLink: element.getAttribute('data-wa-link') || '',
        text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        href: element.getAttribute('href') ? clean(element.getAttribute('href')) : '',
      }));
    const scriptUrls = [...new Set([...document.scripts].map((script) => script.src).filter(Boolean).map(clean))];
    const loadedModuleUrls = [...new Set(performance.getEntriesByType('resource')
      .map((entry) => entry.name).filter((url) => {
        try { return new URL(url).origin === expectedOrigin && new URL(url).pathname.endsWith('.js'); } catch { return false; }
      }).map(clean))];
    const analytics = window.intuit?.tracking?.ecs?.analytics || window.analytics;
    const loginUi = document.querySelector('input[type="password"], form[action*="login" i]');
    const consentBanner = [...document.querySelectorAll('#onetrust-banner-sdk, [id*="onetrust-banner" i]')].find(visible);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    let responseText;
    try {
      responseText = await fetch(location.href, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      }).then((response) => response.text());
    } finally {
      clearTimeout(timer);
    }
    return {
      origin: location.origin,
      pathname: location.pathname,
      responseUrl: clean(location.href),
      documentResponseHash: await digest(responseText),
      interactionInventoryHash: await digest(JSON.stringify(trackables)),
      trackableCount: trackables.length,
      authenticated: !loginUi,
      consentState: (typeof window.OneTrust === 'object' || typeof window.OneTrust === 'function') && !consentBanner
        ? 'resolved' : 'unresolved',
      utagReady: typeof window.utag === 'object',
      trackerReady: typeof window.intuit?.tracking?.ecs?.webAnalytics?.track === 'function',
      enqueueReady: typeof analytics?._dispatch === 'function',
      scriptUrls,
      sameOriginScriptUrls: [...new Set([
        ...scriptUrls.filter((url) => new URL(url).origin === expectedOrigin), ...loadedModuleUrls,
      ])],
      pageCasId: window.appVars?.externalContentIdentifier || '',
      title: document.title,
    };
  }, { expectedOrigin: origin, fetchTimeoutMs: timeoutMs }), timeoutMs, 'document preflight');
}

function assertPreflight(preflight, origin, pagePath) {
  const failures = [];
  if (preflight.origin !== origin) failures.push('stage-origin');
  if (!replayPathMatches(preflight.pathname, pagePath)) failures.push('page-path');
  if (!preflight.authenticated) failures.push('authentication');
  if (preflight.consentState !== 'resolved') failures.push('consent');
  if (!preflight.utagReady) failures.push('utag');
  if (!preflight.trackerReady) failures.push('webAnalytics.track');
  if (!preflight.enqueueReady) failures.push('analytics._dispatch');
  if (!preflight.trackableCount) failures.push('trackable-inventory');
  if (failures.length) throw new Error(`preflight refused: ${failures.join(', ')}`);
}

async function collectRuntimeHashes(preflight, origin, scenario) {
  const explicit = [
    `${origin}/scripts/scripts.js`,
    `${origin}/scripts/tracking.js`,
    `${origin}/scripts/ecs-enrich.js`,
    `${origin}/tracking.json`,
  ];
  const urls = [...new Set([
    ...explicit,
    ...(scenario.runtimeAssets || []).map((path) => new URL(path, origin).href),
    ...preflight.sameOriginScriptUrls,
    ...preflight.scriptUrls.filter((url) => /(?:utag\.js|track-event-lib(?:-init)?\.min\.js)$/.test(url)),
  ])];
  const entries = await Promise.all(urls.map(async (url) => [cleanUrl(url), await hashUrl(url)]));
  return Object.fromEntries(entries);
}

function assertRuntimeHashes(preflight, hashes, origin) {
  const required = [
    `${origin}/scripts/scripts.js`,
    `${origin}/scripts/tracking.js`,
    `${origin}/scripts/ecs-enrich.js`,
    `${origin}/tracking.json`,
    preflight.scriptUrls.find((url) => /\/utag\.js$/.test(url)),
    preflight.scriptUrls.find((url) => /\/analytics\/[^/]+\/track-event-lib\.min\.js$/.test(url)),
    preflight.scriptUrls.find((url) => /\/analytics\/prod\/track-event-lib-init\.min\.js$/.test(url)),
  ];
  const missing = required.filter((url) => !url || !/^sha256:[0-9a-f]{64}$/.test(hashes[url] || ''));
  const sameOriginMissing = preflight.sameOriginScriptUrls.filter((url) => !hashes[url]);
  if (missing.length || sameOriginMissing.length) {
    throw new Error(`preflight refused: missing runtime hashes (${missing.length + sameOriginMissing.length})`);
  }
}

function qualificationBinding({
  options, browserVersion, preflight, runtimeHashes, sourceHashes, targetId, runId, scenario,
}) {
  const qualifiedAt = new Date();
  return {
    qualifiedAt: qualifiedAt.toISOString(),
    expiresAt: new Date(qualifiedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    runId,
    mode: 'dedicated',
    profileId: options.profileId,
    chromeVersion: browserVersion,
    harnessVersion: HARNESS_VERSION,
    lineagePolicyVersion: REPLAY_LINEAGE_POLICY_VERSION,
    transportMarkerGuard: {
      verified: true,
      markerKey: REPLAY_INVOCATION_MARKER_KEY,
      detected: false,
    },
    origin: options.origin,
    consentState: preflight.consentState,
    authorizationRef: options.authorizationRef,
    runtimeHashes,
    sourceHashes,
    scenarioId: scenario.scenarioId,
    scenarioDefinitionHash: sourceHashes['clicktrack-qualification-scenario.json'],
    completeGoldenManifest: options.manifestContentHash ? {
      contentHash: options.manifestContentHash,
      mappingHash: options.goldenMappingHash,
    } : null,
    targetId,
    transportPolicy: options.transport,
    lineageMode: scenario.lineage?.mode || options.lineageMode || 'proof',
  };
}

function businessIdentity(payload) {
  const properties = payload?.properties || {};
  return JSON.stringify(Object.fromEntries([
    'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point', 'page_cas_id',
  ].map((key) => [key, properties[key]])));
}

async function waitForSerialized(page, scenarioId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evidence = await page.evaluate(async () => window.__adobeMigrationReplay.snapshot());
    if (evidence.serialized.some((entry) => entry.status === 'linked' && entry.scenarioId === scenarioId)) return evidence;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for serialized lineage: ${scenarioId}`);
}

function qualificationLocatorCss(locator) {
  if (!locator?.trackId) return null;
  const value = String(locator.trackId);
  if ([...value].some((character) => character.codePointAt(0) <= 31 || character.codePointAt(0) === 127)) {
    throw new Error('scenario track id contains control characters');
  }
  return `[data-track-id="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]:visible`;
}

function qualificationHrefSelector(tag, href) {
  const values = [String(href)];
  let sameOrigin = false;
  let queryPrefix = '';
  try {
    const url = new URL(href);
    sameOrigin = url.origin === DEFAULT_ORIGIN;
    if (sameOrigin) values.push(`${url.pathname}${url.search}`);
    else if (!url.search && !url.hash) queryPrefix = `${url.href}?`;
  } catch { /* Locator review validates href identity before replay. */ }
  const escaped = [...new Set(values)].map((value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  const selectors = escaped.map((value) => `${tag}[href="${value}"]`);
  if (queryPrefix) selectors.push(`${tag}[href^="${queryPrefix.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
  if (sameOrigin) selectors.push(`${tag}[href="#"]`);
  return `:is(${selectors.join(',')})`;
}

function exactTextPattern(value) {
  const words = String(value || '').trim().split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*${words.join('\\s+')}\\s*$`, 'u');
}

function qualificationLocator(page, locator) {
  const regionSelector = {
    main: 'main', header: 'header', footer: 'footer', widget: '#contact-us',
  }[locator.region];
  let root = regionSelector ? page.locator(regionSelector) : page;
  if (locator.block) {
    if (!/^[a-z0-9-]+$/.test(locator.block)) throw new Error('scenario block constraint is invalid');
    root = root.locator(`.${locator.block}.block`);
  }
  let semantic;
  if (String(locator.tag || '').toUpperCase() === 'SUMMARY') {
    semantic = root.locator('summary').filter({ hasText: exactTextPattern(locator.name) });
  } else {
    semantic = root.getByRole(locator.role, { name: locator.name, exact: locator.exact });
    if (locator.tag || locator.requireNoBlock || locator.href) {
      const tag = String(locator.tag || (locator.role === 'link' ? 'a' : '*')).toLowerCase();
      if (!/^(?:a|button|div|summary|\*)$/.test(tag)) throw new Error('scenario tag constraint is invalid');
      const noBlock = locator.requireNoBlock ? ':not(.block *)' : '';
      const target = locator.href ? qualificationHrefSelector(tag, locator.href) : tag;
      semantic = root.locator(`${target}${noBlock}`).and(semantic);
    }
  }
  const selector = qualificationLocatorCss(locator);
  let result = selector ? page.locator(selector).and(semantic) : semantic;
  if (locator.occurrence != null) {
    if (!Number.isInteger(locator.occurrence) || locator.occurrence < 1
      || !locator.occurrenceEvidence?.stableConstraint) {
      throw new Error('scenario occurrence requires stable occurrence evidence');
    }
    result = result.nth(locator.occurrence - 1);
  }
  return result;
}

async function waitForUniqueQualificationLocator(page, locator, timeoutMs = 8000, intervalMs = 250) {
  let count = await locator.count();
  for (let elapsed = 0; count !== 1 && elapsed < timeoutMs; elapsed += intervalMs) {
    await page.waitForTimeout(intervalMs);
    count = await locator.count();
  }
  if (count !== 1) throw new Error(`scenario locator resolved ${count} elements`);
  return locator;
}

function shouldAbortReplayNavigation(request, page) {
  return request.isNavigationRequest() && request.frame() === page.mainFrame();
}

async function handleReplayNavigationRoute(route, page) {
  if (shouldAbortReplayNavigation(route.request(), page)) await route.abort('aborted');
  else await route.fallback();
}

function assertReplayLineageEvidence(evidence, scenario, phase = 'capture') {
  const expectedInvocations = scenario.expected?.invocationCount ?? 1;
  const invocations = evidence.invocations
    .filter((entry) => entry.scenarioId === scenario.scenarioId);
  if (invocations.length !== expectedInvocations) {
    throw new Error(`${phase} expected ${expectedInvocations} tracker invocation(s), got ${invocations.length}`);
  }
  if (evidence.invocations.some((entry) => entry.status === 'ambiguous')
    || evidence.dispatches.some((entry) => entry.status === 'ambiguous')
    || evidence.serialized.some((entry) => entry.status === 'ambiguous')) {
    throw new Error(`${phase} found ambiguous invocation or serialization lineage`);
  }
}

async function resetUnsafeReplayTarget(page, cleanup, markerGuardDetected) {
  if (!page || page.isClosed?.() || (cleanup?.restored === true && !markerGuardDetected)) return false;
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (reloadError) {
    try {
      await page.close();
    } catch (closeError) {
      throw new AggregateError([reloadError, closeError], 'could not reset unsafe replay target');
    }
  }
  return true;
}

async function clickReplayTarget(locator, scenario, clickOptions) {
  if (scenario.locator?.role === 'link' && scenario.interaction?.preventNavigation !== false) {
    // Preserve href-derived metadata while removing the native navigation default.
    return locator.evaluate((element, targetStateKey) => {
      const nativeGet = Element.prototype.getAttribute;
      const nativeSet = Element.prototype.setAttribute;
      const originalHref = nativeGet.call(element, 'href');
      const originalUrl = window.location.href;
      if (!Object.prototype.hasOwnProperty.call(element, targetStateKey)) {
        Object.defineProperty(element, targetStateKey, {
          configurable: true,
          value: { target: nativeGet.call(element, 'target') },
        });
      }
      nativeSet.call(element, 'href', '#adobe-migration-test');
      // The initialized Intuit tracker may resume a canceled link navigation
      // after its analytics work. Presenting the replay-only activation as a
      // new-tab link keeps that vendor continuation away from the bound page.
      nativeSet.call(element, 'target', '_blank');
      Object.defineProperty(element, 'getAttribute', {
        configurable: true,
        value(name) { return String(name).toLowerCase() === 'href' ? originalHref : nativeGet.call(this, name); },
      });
      try {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        event.preventDefault();
        return element.dispatchEvent(event);
      } finally {
        delete element.getAttribute;
        nativeSet.call(element, 'href', originalHref);
        if (window.location.href !== originalUrl) window.history.replaceState(null, '', originalUrl);
      }
    }, REPLAY_ORIGINAL_TARGET_KEY);
  }
  return locator.click(clickOptions);
}

async function restoreReplayTarget(locator) {
  return locator.evaluate((element, targetStateKey) => {
    if (!Object.prototype.hasOwnProperty.call(element, targetStateKey)) return false;
    const nativeSet = Element.prototype.setAttribute;
    const nativeRemove = Element.prototype.removeAttribute;
    const { target } = element[targetStateKey];
    if (target == null) nativeRemove.call(element, 'target');
    else nativeSet.call(element, 'target', target);
    delete element[targetStateKey];
    return true;
  }, REPLAY_ORIGINAL_TARGET_KEY);
}

async function executeSetupSteps(page, steps = [], { locate = qualificationLocator } = {}) {
  const clickOptions = { force: true, noWaitAfter: true, timeout: 8000 };
  for (const step of steps) {
    if (step.type !== 'click' || !step.locator) throw new Error('unsupported replay setup step');
    const target = locate(page, step.locator);
    await waitForUniqueQualificationLocator(page, target);
    await target.click(clickOptions);
    if (step.expect?.locator) {
      const expected = locate(page, step.expect.locator);
      await expected.waitFor({ state: step.expect.state || 'visible', timeout: 8000 });
    }
  }
}

function interactionSequence(mode) {
  if (mode === 'proof') {
    return [
      { type: 'hold-transport' }, { type: 'click' }, { type: 'wait-held' }, { type: 'click' },
      { type: 'activate' }, { type: 'release-held' }, { type: 'click' }, { type: 'wait-linked' },
      { type: 'deactivate' },
    ];
  }
  if (mode === 'capture') {
    return [{ type: 'activate' }, { type: 'click' }, { type: 'wait-linked' }, { type: 'deactivate' }];
  }
  throw new Error(`unknown lineage mode: ${mode}`);
}

function validateLineageQualification(proof, binding, bytes, now = Date.now()) {
  const qualified = proof?.qualification || {};
  const comparableSources = (sources) => Object.fromEntries(Object.entries(sources || {})
    .filter(([key]) => key !== 'clicktrack-qualification-scenario.json'));
  const comparableRuntime = (hashes) => Object.fromEntries(Object.entries(hashes || {})
    .filter(([url]) => /(?:\/scripts\/(?:scripts|tracking|ecs-enrich)\.js|\/tracking\.json|\/utag\.js|\/track-event-lib(?:-init)?\.min\.js)$/.test(url)));
  const exact = (value) => JSON.stringify(Object.keys(value || {}).sort()
    .reduce((out, key) => ({ ...out, [key]: value[key] }), {}));
  const same = qualified.lineageMode === 'proof'
    && new Date(qualified.expiresAt).getTime() > now
    && [
      'mode', 'profileId', 'chromeVersion', 'harnessVersion', 'lineagePolicyVersion',
      'origin', 'consentState', 'authorizationRef', 'targetId',
    ]
      .every((key) => qualified[key] === binding[key])
    && exact(comparableRuntime(qualified.runtimeHashes)) === exact(comparableRuntime(binding.runtimeHashes))
    && exact(comparableSources(qualified.sourceHashes)) === exact(comparableSources(binding.sourceHashes))
    && exact(qualified.transportMarkerGuard) === exact(binding.transportMarkerGuard)
    && exact(qualified.completeGoldenManifest) === exact(binding.completeGoldenManifest);
  if (!same) throw new Error('lineage qualification binding does not match capture deployment/browser/session');
  return {
    artifactSha256: sha256(bytes),
    qualifiedAt: qualified.qualifiedAt,
    expiresAt: qualified.expiresAt,
    targetId: qualified.targetId,
    profileId: qualified.profileId,
    chromeVersion: qualified.chromeVersion,
    lineagePolicyVersion: qualified.lineagePolicyVersion,
  };
}

async function exerciseQualification(page, scenario, requestedLineageMode) {
  const clickOptions = { force: true, noWaitAfter: true, timeout: 8000 };
  let locator;
  let targetContained = false;
  let primaryError;
  try {
    await executeSetupSteps(page, scenario.setupSteps);
    locator = qualificationLocator(page, scenario.locator);
    await waitForUniqueQualificationLocator(page, locator);
    targetContained = scenario.locator?.role === 'link'
      && scenario.interaction?.preventNavigation !== false;
    const expectedExpanded = scenario.preconditions?.attributes?.['aria-expanded'];
    if (expectedExpanded != null && await locator.getAttribute('aria-expanded') !== expectedExpanded) {
      await clickReplayTarget(locator, scenario, clickOptions);
      await page.waitForTimeout(250);
      if (await locator.getAttribute('aria-expanded') !== expectedExpanded) {
        throw new Error(`scenario precondition failed: aria-expanded=${expectedExpanded}`);
      }
    }
    const locatorEvidence = await locator.evaluate((element) => ({
      tag: element.tagName,
      trackId: element.getAttribute('data-track-id') || '',
      waLink: element.getAttribute('data-wa-link') || '',
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }));

    const lineageMode = requestedLineageMode || scenario.lineage?.mode || 'proof';
    interactionSequence(lineageMode);
    if (lineageMode === 'capture') {
      await page.evaluate((activeScenario) => window.__adobeMigrationReplay.activate(activeScenario), {
        scenarioId: scenario.scenarioId,
        page: scenario.page,
      });
      await clickReplayTarget(locator, scenario, clickOptions);
      await waitForSerialized(page, scenario.scenarioId);
      await page.waitForTimeout(250);
      const evidence = await page.evaluate(async () => window.__adobeMigrationReplay.snapshot());
      await page.evaluate(() => window.__adobeMigrationReplay.deactivate());
      const linked = evidence.serialized.filter((entry) => entry.status === 'linked' && entry.scenarioId === scenario.scenarioId);
      assertReplayLineageEvidence(evidence, scenario, 'capture');
      if (linked.length !== 1) throw new Error(`capture expected one linked event, got ${linked.length}`);
      return { evidence, linked: linked[0], locatorEvidence };
    }

    // The one-time proof establishes that a business-identical stale request
    // cannot be linked to the active scenario window.
    await page.evaluate(() => window.__adobeMigrationReplay.holdNextTransport());
    await clickReplayTarget(locator, scenario, clickOptions);
    await page.waitForFunction(() => window.__adobeMigrationReplay.hasHeldTransport(), null, { timeout: 8000 });
    await clickReplayTarget(locator, scenario, clickOptions);
    await page.evaluate((activeScenario) => window.__adobeMigrationReplay.activate(activeScenario), {
      scenarioId: scenario.scenarioId,
      page: scenario.page,
    });
    await page.evaluate(() => window.__adobeMigrationReplay.releaseHeldTransport());
    await clickReplayTarget(locator, scenario, clickOptions);
    await waitForSerialized(page, scenario.scenarioId);
    await page.waitForTimeout(250);
    const evidence = await page.evaluate(async () => window.__adobeMigrationReplay.snapshot());
    await page.evaluate(() => window.__adobeMigrationReplay.deactivate());
    const linked = evidence.serialized.filter((entry) => entry.status === 'linked' && entry.scenarioId === scenario.scenarioId);
    const stale = evidence.serialized.filter((entry) => entry.status === 'unlinked');
    assertReplayLineageEvidence(evidence, scenario, 'qualification');
    if (linked.length !== 1) throw new Error(`qualification expected one linked event, got ${linked.length}`);
    if (!stale.some((entry) => businessIdentity(entry.payload) === businessIdentity(linked[0].payload))) {
      throw new Error('qualification did not prove a business-identical stale event was excluded');
    }
    return { evidence, linked: linked[0], locatorEvidence };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (targetContained && locator) {
      try {
        await restoreReplayTarget(locator);
      } catch (error) {
        if (!primaryError) throw error;
      }
    }
  }
}

function buildCapture({
  options, golden, scenario, runId, binding, preflight, runtimeHashes, replay, journal,
}) {
  const tealiumUrl = preflight.scriptUrls.find((url) => /\/utag\.js$/.test(url));
  const senderUrl = preflight.scriptUrls.find((url) => /\/track-event-lib\.min\.js$/.test(url));
  const initUrl = preflight.scriptUrls.find((url) => /\/track-event-lib-init\.min\.js$/.test(url));
  const sameOriginScriptUrls = [...new Set([
    ...preflight.sameOriginScriptUrls,
    ...(scenario.runtimeAssets || []).map((path) => new URL(path, options.origin).href),
  ])];
  const sameOriginScripts = sameOriginScriptUrls.map((url) => ({
    url: cleanUrl(url),
    contentHash: runtimeHashes[cleanUrl(url)],
  })).filter((entry) => entry.contentHash);
  return {
    schemaVersion: 1,
    source: 'authenticated-one-page-replay',
    status: 'complete',
    attempt: journal.attempt,
    previousRunId: journal.previousRunId,
    resume: {
      completedScenarioIds: [scenario.scenarioId],
      nextScenarioId: null,
      canResume: true,
    },
    qualification: binding,
    golden: {
      source: options.golden,
      integrity: golden.integrity,
      scenarioId: scenario.scenarioId,
      payloadFile: scenario.goldenRef.payloadFile,
    },
    provenance: {
      global: {
        capturedAt: new Date().toISOString(),
        runId,
        origin: options.origin,
        harness: { name: 'click-tracking-parity', version: HARNESS_VERSION, sourceHashes: binding.sourceHashes },
        browser: {
          name: 'Chrome', version: binding.chromeVersion, profileId: options.profileId, targetId: binding.targetId,
        },
        deployedHashes: {
          'scripts.js': runtimeHashes[`${options.origin}/scripts/scripts.js`],
          'tracking.js': runtimeHashes[`${options.origin}/scripts/tracking.js`],
          'ecs-enrich.js': runtimeHashes[`${options.origin}/scripts/ecs-enrich.js`],
          'tracking.json': runtimeHashes[`${options.origin}/tracking.json`],
        },
        tealium: { profileUrl: cleanUrl(tealiumUrl), contentHash: runtimeHashes[cleanUrl(tealiumUrl)] },
        trackerResources: {
          policyVersion: TRACKER_POLICY_VERSION,
          resources: [
            { role: 'sender', url: cleanUrl(senderUrl), contentHash: runtimeHashes[cleanUrl(senderUrl)] },
            { role: 'delegated-loader', url: cleanUrl(initUrl), contentHash: runtimeHashes[cleanUrl(initUrl)] },
          ],
        },
      },
    },
    pages: [{
      pathname: scenario.page,
      provenance: {
        document: { responseUrl: preflight.responseUrl, contentHash: preflight.documentResponseHash },
        interactionInventoryHash: preflight.interactionInventoryHash,
        sameOriginScripts,
        readiness: {
          consent: preflight.consentState === 'resolved' ? 'ready' : preflight.consentState,
          tracker: 'ready',
          stageReachability: preflight.origin === options.origin ? 'ready' : 'blocked',
          authentication: preflight.authenticated ? 'ready' : 'blocked',
          utag: preflight.utagReady ? 'ready' : 'blocked',
          enqueue: preflight.enqueueReady ? 'ready' : 'blocked',
        },
        activationEvidence: activationEvidence(preflight, replay),
      },
      events: [{ scenarioId: scenario.scenarioId, payload: replay.linked.payload }],
      outcomes: [{
        scenarioId: scenario.scenarioId,
        status: 'captured',
        messageId: replay.linked.messageId,
        invocationId: replay.linked.invocationId,
        locator: replay.locatorEvidence,
      }],
      diagnostics: replay.evidence.serialized.filter((entry) => entry.status !== 'linked'),
    }],
  };
}

async function qualify(options) {
  if (options.origin !== DEFAULT_ORIGIN) throw new Error(`exact stage origin is required: ${DEFAULT_ORIGIN}`);
  if (!options.authorizationRef) throw new Error('--authorization-ref is required for observe-mode qualification');
  assertCanonicalScenarioPath(options.scenario, options);
  const endpoint = validateCdpEndpoint(options.cdp);
  const scenario = readJson(options.scenario);
  const golden = readJson(options.golden);
  const entry = goldenScenario(golden, scenario);
  purgeEvidence(options.evidenceDir, { retentionDays: options.retentionDays });
  const previous = existsSync(options.out) ? readJson(options.out) : null;
  const journal = createRunJournal(options, scenario, previous);
  writeJson(options.out, journal);
  let browser;
  let page;
  let heartbeat;
  let targetListeners;
  let navigationRoute;
  let routedPage;
  let eventbusRoute;
  let eventbusRouteContext;
  let markerGuardDetected = false;
  try {
    browser = await chromium.connectOverCDP(endpoint);
    const contexts = browser.contexts();
    if (contexts.length !== 1) throw new Error(`dedicated CDP expected one context, got ${contexts.length}`);
    const context = contexts[0];
    eventbusRouteContext = context;
    eventbusRoute = async (route) => {
      if (requestBodyContainsReplayMarker(route.request())) {
        markerGuardDetected = true;
        await route.abort('blockedbyclient');
        return;
      }
      await route.fallback();
    };
    await context.route(MARKER_GUARD_ROUTE, eventbusRoute);
    page = selectDedicatedPage(context.pages(), options.origin, scenario.page);
    const targetGuard = createTargetGuard(page, options.origin);
    const onPage = (candidate) => targetGuard.observePage(candidate);
    const onNavigation = (frame) => {
      if (frame === page.mainFrame()) targetGuard.observeNavigation(frame.url());
    };
    const onClose = () => targetGuard.observeClose();
    context.on('page', onPage);
    page.on('framenavigated', onNavigation);
    page.on('close', onClose);
    targetListeners = () => {
      context.off('page', onPage);
      page?.off('framenavigated', onNavigation);
      page?.off('close', onClose);
    };
    context.pages().forEach((candidate) => targetGuard.observePage(candidate));
    targetGuard.assert();
    await page.waitForFunction(() => {
      const analytics = window.intuit?.tracking?.ecs?.analytics || window.analytics;
      return typeof window.intuit?.tracking?.ecs?.webAnalytics?.track === 'function'
        && typeof analytics?._dispatch === 'function' && typeof window.utag === 'object';
    }, null, { timeout: 30000 });
    targetGuard.assert();

    const preflight = await browserPreflight(page, options.origin);
    assertPreflight(preflight, options.origin, scenario.page);
    const runtimeHashes = await collectRuntimeHashes(preflight, options.origin, scenario);
    assertRuntimeHashes(preflight, runtimeHashes, options.origin);
    targetGuard.assert();
    const cdp = await context.newCDPSession(page);
    const targetInfo = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    const { runId } = journal;
    const browserVersion = await browser.version();
    const sourceHashes = harnessSourceHashes(options.scenario);
    const binding = qualificationBinding({
      options,
      browserVersion,
      preflight,
      runtimeHashes,
      sourceHashes,
      targetId: targetInfo.targetInfo.targetId,
      runId,
      scenario,
    });
    const lineageMode = scenario.lineage?.mode || options.lineageMode || 'proof';
    if (!['proof', 'capture'].includes(lineageMode)) throw new Error('lineage mode must be proof or capture');
    if (scenario.lineage?.mode && options.lineageMode && scenario.lineage.mode !== options.lineageMode) {
      throw new Error('scenario lineage mode does not match command');
    }
    if (lineageMode === 'capture') {
      const proofPath = scenario.lineage?.qualificationArtifact || options.lineageQualification;
      if (!proofPath || !existsSync(proofPath)) throw new Error('capture requires a bound lineage qualification artifact');
      const proofBytes = readFileSync(proofPath);
      binding.lineageQualification = validateLineageQualification(
        JSON.parse(proofBytes.toString('utf8')),
        binding,
        proofBytes,
      );
    }
    validateQualification(binding, binding);
    const targetMarker = `adobe-migration-test:${runId}:${targetInfo.targetInfo.targetId}`;
    await page.evaluate(installReplayPageHook, {
      origin: options.origin,
      targetMarker,
      invocationMarkerKey: REPLAY_INVOCATION_MARKER_KEY,
      qualificationMode: true,
      transportPolicy: options.transport,
      observeAuthorizationRef: options.authorizationRef,
      abortAuthorizationRef: options.abortAuthorizationRef,
      ...deriveAllowlist(entry.fullPayload),
      preventNavigation: scenario.interaction?.preventNavigation !== false,
      leaseMs: 10000,
      heartbeatMs: 2000,
    });
    if (scenario.interaction?.preventNavigation !== false && scenario.locator?.role === 'link') {
      routedPage = page;
      navigationRoute = (route) => handleReplayNavigationRoute(route, routedPage);
      await routedPage.route('**/*', navigationRoute);
    }
    heartbeat = setInterval(() => {
      void page.evaluate(() => window.__adobeMigrationReplay?.heartbeat()).catch(() => {});
    }, 1000);
    page.setDefaultTimeout(8000);
    const replay = await exerciseQualification(page, scenario, lineageMode);
    binding.transportMarkerGuard.detected = markerGuardDetected;
    if (markerGuardDetected) throw new Error('browser transport guard blocked a replay invocation marker');
    targetGuard.assert();
    if (!replayPathMatches(replay.linked.payload?.properties?.page_cas_id, scenario.page)) {
      throw new Error(`page_cas_id gate failed: ${replay.linked.payload?.properties?.page_cas_id || 'missing'}`);
    }
    if (new URL(page.url()).origin !== options.origin) throw new Error('unexpected cross-origin navigation');
    const capture = buildCapture({
      options, golden, scenario, runId, binding, preflight, runtimeHashes, replay, journal,
    });
    clearInterval(heartbeat);
    heartbeat = null;
    targetListeners?.();
    targetListeners = null;
    const expectedTargetId = targetInfo.targetInfo.targetId;
    await browser.close();
    navigationRoute = null;
    routedPage = null;
    browser = null;
    page = null;
    await new Promise((accept) => { setTimeout(accept, 12000); });
    browser = await chromium.connectOverCDP(endpoint);
    const cleanupContext = browser.contexts()[0];
    page = selectDedicatedOriginPage(cleanupContext.pages(), options.origin);
    const cleanupCdp = await cleanupContext.newCDPSession(page);
    const cleanupTarget = await cleanupCdp.send('Target.getTargetInfo');
    await cleanupCdp.detach();
    const cleanupState = await page.evaluate(({ targetId, expectedTargetMarker }) => {
      const ecs = window.intuit?.tracking?.ecs;
      const named = [
        ['track', ecs?.webAnalytics?.track], ['dispatch', ecs?.analytics?._dispatch],
        ['fetch', window.fetch], ['sendBeacon', navigator.sendBeacon],
        ['xhrOpen', window.XMLHttpRequest?.prototype?.open], ['xhrSend', window.XMLHttpRequest?.prototype?.send],
      ].filter(([, fn]) => /^replay/.test(fn?.name || '')).map(([name]) => name);
      let cleanupAttestation = null;
      try {
        cleanupAttestation = JSON.parse(sessionStorage.getItem('adobe-migration-replay-cleanup'));
        sessionStorage.removeItem('adobe-migration-replay-cleanup');
      } catch { /* refused below */ }
      return {
        targetId,
        expectedTargetMarker,
        replayAbsent: window.__adobeMigrationReplay == null,
        targetMarkerAbsent: window.__adobeMigrationReplayTarget == null,
        wrappedFunctions: named,
        cleanupAttestation,
      };
    }, { targetId: cleanupTarget.targetInfo.targetId, expectedTargetMarker: targetMarker });
    assertCleanReuseState(cleanupState, expectedTargetId);
    capture.qualification.disconnectCleanup = { verified: true, leaseMs: 10000, targetId: expectedTargetId };
    writeJson(options.out, capture);
    console.log(JSON.stringify({
      verdict: 'QUALIFIED',
      scenarioId: scenario.scenarioId,
      page: scenario.page,
      pageCasId: replay.linked.payload.properties.page_cas_id,
      transportPolicy: options.transport,
      output: options.out,
      qualificationExpiresAt: binding.expiresAt,
    }, null, 2));
  } catch (error) {
    const safeMessage = [...String(error.message || 'unknown error')].map((character) => {
      const code = character.codePointAt(0);
      return code <= 31 || (code >= 127 && code <= 159) || /\p{Bidi_Control}/u.test(character) ? '?' : character;
    }).join('');
    journal.status = 'refused';
    journal.finishedAt = new Date().toISOString();
    journal.scenarioOutcomes[0] = { scenarioId: scenario.scenarioId, status: 'refused', reason: safeMessage };
    journal.resume = { completedScenarioIds: [], nextScenarioId: scenario.scenarioId, canResume: true };
    writeJson(options.out, journal);
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (targetListeners) targetListeners();
    let cleanup = null;
    if (page) {
      cleanup = await page.evaluate(() => window.__adobeMigrationReplay?.teardown('runner-complete'))
        .catch(() => null);
    }
    if (navigationRoute && routedPage) await routedPage.unroute('**/*', navigationRoute).catch(() => {});
    await resetUnsafeReplayTarget(page, cleanup, markerGuardDetected);
    if (eventbusRoute && eventbusRouteContext) {
      await eventbusRouteContext.unroute(MARKER_GUARD_ROUTE, eventbusRoute).catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === 'launch') return launch(options);
  if (options.command === 'qualify') return qualify(options);
  if (options.command === 'purge') {
    const deleted = purgeEvidence(options.evidenceDir, { retentionDays: options.retentionDays });
    console.log(JSON.stringify({ deleted, retentionDays: options.retentionDays }, null, 2));
    return;
  }
  throw new Error(`unknown command: ${options.command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ verdict: 'REFUSED', error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

export {
  activationEvidence, assertCanonicalScenarioPath, assertCleanReuseState, assertPreflight, assertReplayLineageEvidence, assertRuntimeHashes, businessIdentity, createRunJournal, deriveAllowlist, goldenScenario, launchArguments,
  browserPreflight, clickReplayTarget, createTargetGuard, executeSetupSteps, handleReplayNavigationRoute, hashUrl, interactionSequence,
  portAvailable, purgeEvidence, qualificationLocator, qualificationLocatorCss, selectDedicatedOriginPage,
  resetUnsafeReplayTarget, restoreReplayTarget, selectDedicatedPage, validateLineageQualification,
  shouldAbortReplayNavigation, waitForUniqueQualificationLocator,
};
