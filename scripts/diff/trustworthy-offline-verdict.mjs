#!/usr/bin/env node
/**
 * Produce a provenance-safe offline click-tracking verdict from a golden and
 * one or more capture artifacts. Legacy captures can only use semantic
 * matching when the join is unique; stable scenario IDs are always preferred.
 */
/* eslint-disable import/extensions, no-console, no-restricted-syntax, max-len */
import {
  mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  THRESHOLD, assertIntegrity, gatedMatch, gatedSpecs, normalizeValue, presenceSpecs, resolveWant,
} from './oracle-lib.mjs';
import {
  REPLAY_INVOCATION_MARKER_KEY, REPLAY_LINEAGE_POLICY_VERSION, replayPathMatches,
} from './live-replay-harness.mjs';

const DEFAULT_EXPECTED_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const TRACKER_POLICY_VERSION = '1';
const TEALIUM_PROFILE_URL = 'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js';
const currentHarnessSourceHashes = () => Object.fromEntries([
  ['live-replay-harness.mjs', resolve('scripts/diff/live-replay-harness.mjs')],
  ['live-replay-runner.mjs', resolve('scripts/diff/live-replay-runner.mjs')],
  ['clicktrack-qualification-scenario.json', resolve('scripts/diff/fixtures/clicktrack-qualification-scenario.json')],
].map(([name, path]) => [name, `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`]));
const currentQualificationScenario = () => JSON.parse(readFileSync(
  resolve('scripts/diff/fixtures/clicktrack-qualification-scenario.json'), 'utf8',
));

const GLOBAL_FIELD_RULES = [
  ['capturedAt', 'timestamp'],
  ['runId', 'text'],
  ['origin', 'origin'],
  ['harness.name', 'text'],
  ['harness.version', 'text'],
  ['browser.name', 'text'],
  ['browser.version', 'text'],
  ['browser.profileId', 'text'],
  ['tealium.profileUrl', 'url'],
  ['tealium.contentHash', 'hash'],
  ['trackerResources.policyVersion', 'text'],
];

const PAGE_FIELD_RULES = [
  ['document.responseUrl', 'url'],
  ['document.contentHash', 'hash'],
  ['interactionInventoryHash', 'hash'],
];

const get = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
const present = (value) => value !== undefined
  && value !== null
  && (typeof value !== 'string' || value.trim() !== '');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pct = (passed, total) => (total ? +((100 * passed) / total).toFixed(1) : 100);
const sanitizeTerminal = (value) => [...String(value ?? '')].map((character) => {
  const code = character.codePointAt(0);
  const terminalControl = code <= 31
    || (code >= 127 && code <= 159)
    || /\p{Bidi_Control}/u.test(character);
  return terminalControl ? '?' : character;
}).join('');

function parsedUrl(value) {
  try { return new URL(value); } catch { return null; }
}

const isCanonicalHash = (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

function isRfc3339Utc(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3);
  const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}Z`);
  if (Number.isNaN(parsed)) return false;
  const date = new Date(parsed);
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second)
    && date.getUTCMilliseconds() === Number(milliseconds);
}

const hasCanonicalUrlPath = (url) => url.pathname !== ''
  && !url.pathname.includes('//')
  && !url.pathname.includes('%');

function isCanonicalOrigin(value) {
  const url = parsedUrl(value);
  return typeof value === 'string'
    && url?.protocol === 'https:'
    && url.username === ''
    && url.password === ''
    && url.port === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === ''
    && hasCanonicalUrlPath(url)
    && value === url.origin;
}

function isCanonicalHttpsUrl(value) {
  const url = parsedUrl(value);
  return typeof value === 'string'
    && url?.protocol === 'https:'
    && url.username === ''
    && url.password === ''
    && url.port === ''
    && url.search === ''
    && url.hash === ''
    && hasCanonicalUrlPath(url)
    && value === `${url.origin}${url.pathname}`;
}

const FIELD_VALIDATORS = {
  text: (value) => typeof value === 'string' && value.trim() !== '',
  hash: isCanonicalHash,
  timestamp: isRfc3339Utc,
  origin: isCanonicalOrigin,
  url: isCanonicalHttpsUrl,
};

function isSenderV1(resource) {
  const url = parsedUrl(resource?.url);
  return resource?.role === 'sender'
    && isCanonicalHash(resource.contentHash)
    && isCanonicalHttpsUrl(resource.url)
    && url.hostname === 'uxfabric.intuitcdn.net'
    && /^\/analytics\/[^/]+\/track-event-lib\.min\.js$/.test(url.pathname);
}

function isDelegatedLoaderV1(resource) {
  const url = parsedUrl(resource?.url);
  return resource?.role === 'delegated-loader'
    && isCanonicalHash(resource.contentHash)
    && isCanonicalHttpsUrl(resource.url)
    && url.hostname === 'uxfabric.intuitcdn.net'
    && url.pathname === '/analytics/prod/track-event-lib-init.min.js';
}

function validateFields(object, rules, missing, invalid, prefix = '') {
  for (const [path, rule] of rules) {
    const value = get(object, path);
    const qualifiedPath = prefix ? `${prefix}.${path}` : path;
    if (!present(value)) missing.push(qualifiedPath);
    else if (!FIELD_VALIDATORS[rule](value)) invalid.push(qualifiedPath);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const fingerprint = (value) => JSON.stringify(canonical(value));

function globalIdentity(global) {
  return {
    capturedAt: global.capturedAt,
    runId: global.runId,
    origin: global.origin,
    harness: global.harness,
    browser: global.browser,
    deployedHashes: global.deployedHashes,
    tealium: global.tealium,
    trackerResources: global.trackerResources,
  };
}

function pageIdentity(page) {
  return {
    document: page.document,
    interactionInventoryHash: page.interactionInventoryHash,
    sameOriginScripts: page.sameOriginScripts,
  };
}

function validateGlobal(global) {
  const missing = [];
  const invalid = [];
  if (!isRecord(global)) return { missing, invalid: ['global'] };
  validateFields(global, GLOBAL_FIELD_RULES, missing, invalid);
  for (const path of ['harness', 'browser', 'deployedHashes', 'tealium', 'trackerResources']) {
    if (present(global[path]) && !isRecord(global[path])) invalid.push(path);
  }
  if (present(global?.tealium?.profileUrl) && global.tealium.profileUrl !== TEALIUM_PROFILE_URL) {
    invalid.push('tealium.profileUrl');
  }
  if (present(global?.trackerResources?.policyVersion)
    && global.trackerResources.policyVersion !== TRACKER_POLICY_VERSION) {
    invalid.push('trackerResources.policyVersion');
  }
  for (const resource of ['scripts.js', 'tracking.js', 'ecs-enrich.js', 'tracking.json']) {
    const path = `deployedHashes.${resource}`;
    const value = global?.deployedHashes?.[resource];
    if (!present(value)) missing.push(path);
    else if (!isCanonicalHash(value)) invalid.push(path);
  }
  const resources = global?.trackerResources?.resources;
  if (!present(resources)) missing.push('trackerResources.resources');
  else if (!Array.isArray(resources)) invalid.push('trackerResources.resources');
  else {
    const seenUrls = new Set();
    for (const [index, resource] of resources.entries()) {
      const base = `trackerResources.resources[${index}]`;
      if (!isRecord(resource)) {
        invalid.push(base);
      } else {
        validateFields(resource, [
          ['role', 'text'],
          ['url', 'url'],
          ['contentHash', 'hash'],
        ], missing, invalid, base);
        if (seenUrls.has(resource.url)) invalid.push(base);
        seenUrls.add(resource.url);
      }
    }
    if (!resources.some(isSenderV1)) missing.push('trackerResources.resources[sender-v1]');
    if (!resources.some(isDelegatedLoaderV1)) missing.push('trackerResources.resources[delegated-loader-v1]');
  }
  return { missing: [...new Set(missing)], invalid: [...new Set(invalid)] };
}

function validatePage(page) {
  const missing = [];
  const invalid = [];
  if (!isRecord(page)) return { missing, invalid: ['provenance'] };
  validateFields(page, PAGE_FIELD_RULES, missing, invalid);
  for (const path of ['document', 'readiness', 'activationEvidence']) {
    if (!present(page[path])) missing.push(path);
    else if (!isRecord(page[path])) invalid.push(path);
  }
  for (const path of ['readiness.consent', 'readiness.tracker']) {
    const value = get(page, path);
    if (!present(value)) missing.push(path);
    else if ((typeof value === 'string' && !FIELD_VALIDATORS.text(value))
      || (typeof value !== 'string' && typeof value !== 'boolean')) invalid.push(path);
  }
  const scripts = page?.sameOriginScripts;
  if (!present(scripts)) missing.push('sameOriginScripts');
  else if (!Array.isArray(scripts)) invalid.push('sameOriginScripts');
  else {
    const seenUrls = new Set();
    for (const [index, resource] of scripts.entries()) {
      const base = `sameOriginScripts[${index}]`;
      if (!isRecord(resource)) invalid.push(base);
      else {
        validateFields(resource, [
          ['url', 'url'],
          ['contentHash', 'hash'],
        ], missing, invalid, base);
        if (seenUrls.has(resource.url)) invalid.push(base);
        seenUrls.add(resource.url);
      }
    }
  }
  for (const name of ['tealiumTagUids', 'resources', 'vendorCalls']) {
    const path = `activationEvidence.${name}`;
    const value = page?.activationEvidence?.[name];
    if (!present(value)) missing.push(path);
    else if (!Array.isArray(value)) invalid.push(path);
  }
  return { missing: [...new Set(missing)], invalid: [...new Set(invalid)] };
}

function normalizePages(capture, sourceCapture) {
  if (Array.isArray(capture.pages)) {
    return capture.pages.map((page) => ({ ...page, sourceCapture }));
  }
  if (!isRecord(capture.pages)) return [];
  return Object.entries(capture.pages || {}).map(([pathname, value]) => {
    if (Array.isArray(value)) {
      return {
        pathname, events: value, provenance: {}, sourceCapture,
      };
    }
    return { pathname, ...value, sourceCapture };
  });
}

const payloadOf = (event) => event?.payload || event?.fullPayload || event || {};
const SCENARIO_ALIASES = ['scenarioId', 'scenario_id', 'id'];

function scenarioAliasEntries(value) {
  if (!isRecord(value)) return [];
  const aliases = SCENARIO_ALIASES.filter((alias) => Object.hasOwn(value, alias))
    .map((alias) => ({ alias, value: value[alias] }));
  if (isRecord(value.correlation) && Object.hasOwn(value.correlation, 'scenarioId')) {
    aliases.push({ alias: 'correlation.scenarioId', value: value.correlation.scenarioId });
  }
  return aliases;
}

function inspectScenarioAliases(value) {
  const aliases = scenarioAliasEntries(value);
  const invalidAliases = aliases.filter(({ value: aliasValue }) => typeof aliasValue !== 'string'
    || aliasValue.trim() === '').map(({ alias }) => alias);
  const distinctValues = new Set(aliases
    .filter(({ value: aliasValue }) => typeof aliasValue === 'string' && aliasValue.trim() !== '')
    .map(({ value: aliasValue }) => aliasValue));
  return {
    aliases,
    invalid: invalidAliases.length > 0 || distinctValues.size > 1,
    value: invalidAliases.length === 0 && distinctValues.size === 1 ? [...distinctValues][0] : null,
  };
}

function scenarioOf(event, inspection = inspectScenarioAliases(event)) {
  return inspection.invalid ? null : inspection.value;
}

const goldenScenarioOf = (entry, index, inspection = inspectScenarioAliases(entry)) => inspection.value ?? `legacy-${index + 1}`;
const normalizeLabel = (value) => (typeof value === 'string'
  ? normalizeValue({ normalizeTags: true }, value.replace(/ \[[^\]]*\]$/, ''))
  : value);
const semanticKey = (payload) => {
  const properties = payload.properties || {};
  return [properties.object || '?', normalizeLabel(properties.ui_object_detail) || ''].join('¦');
};

function fieldSpecs() {
  const gated = new Map();
  const presence = new Map();
  for (const loc of ['envelope', 'properties', 'context']) {
    for (const [field, spec] of gatedSpecs(loc)) gated.set(`${loc}.${field}`, spec);
  }
  for (const loc of ['envelope', 'properties', 'context', 'integrations']) {
    for (const [field, spec] of presenceSpecs(loc)) presence.set(`${loc}.${field}`, spec);
  }
  return { gated, presence };
}

const SPECS = fieldSpecs();

function carriedFields(payload) {
  const fields = [];
  for (const [field, value] of Object.entries(payload)) {
    if (!['properties', 'context', 'integrations'].includes(field)) {
      fields.push({ loc: 'envelope', field, value });
    }
  }
  for (const loc of ['properties', 'context', 'integrations']) {
    for (const [field, value] of Object.entries(payload[loc] || {})) fields.push({ loc, field, value });
  }
  return fields;
}

function actualField(payload, loc, field) {
  return loc === 'envelope' ? payload[field] : payload[loc]?.[field];
}

function shapeTokenMatches(rawValue, actualValue) {
  if (typeof actualValue !== 'string') return null;
  if (actualValue === 'NULL') return rawValue === null;
  if (actualValue === 'NUM') return typeof rawValue === 'number';
  if (actualValue === 'BOOL') return typeof rawValue === 'boolean';
  const stringToken = /^STR:(\d+)$/.exec(actualValue);
  if (stringToken) {
    return typeof rawValue === 'string'
      && (rawValue.trim() === '' ? Number(stringToken[1]) === 0 : Number(stringToken[1]) > 0);
  }
  return null;
}

function recursiveShapeMatches(rawValue, actualValue) {
  const tokenMatch = shapeTokenMatches(rawValue, actualValue);
  if (tokenMatch !== null) return tokenMatch;
  if (Array.isArray(rawValue)) {
    if (!Array.isArray(actualValue)) return false;
    if (!rawValue.length) return true;
    if (!actualValue.length) return false;
    return actualValue.every((item) => rawValue.some((sample) => recursiveShapeMatches(sample, item)));
  }
  if (isRecord(rawValue)) {
    if (!isRecord(actualValue)) return false;
    return Object.entries(rawValue).every(([key, value]) => Object.hasOwn(actualValue, key)
      && recursiveShapeMatches(value, actualValue[key]));
  }
  if (typeof rawValue === 'string') {
    return typeof actualValue === 'string'
      && (rawValue.trim() === '' ? actualValue.trim() === '' : actualValue.trim() !== '');
  }
  if (rawValue === null) return actualValue === null;
  return typeof actualValue === typeof rawValue;
}

function populatedAgainst(rawValue, actualValue) {
  const tokenMatch = shapeTokenMatches(rawValue, actualValue);
  if (tokenMatch !== null) return tokenMatch;
  if (Array.isArray(rawValue)) {
    return Array.isArray(actualValue) && actualValue.length > 0
      && actualValue.every((item) => rawValue.some((sample) => populatedAgainst(sample, item)));
  }
  if (isRecord(rawValue)) {
    return isRecord(actualValue) && Object.keys(actualValue).length > 0
      && Object.entries(rawValue).every(([key, child]) => Object.hasOwn(actualValue, key)
        && populatedAgainst(child, actualValue[key]));
  }
  if (typeof rawValue === 'string') {
    return typeof actualValue === 'string'
      && (rawValue.trim() === '' ? actualValue.trim() === '' : actualValue.trim() !== '');
  }
  if (rawValue === null) return actualValue === null;
  return actualValue !== undefined && actualValue !== null;
}

function populatedForPresence(value, spec, rawValue) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return false;
  const allowEmpty = spec.allowEmpty === true || spec.expectEmpty === true;
  const emptyAllowed = allowEmpty && ((Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0));
  return (emptyAllowed || populatedAgainst(rawValue, value))
    && recursiveShapeMatches(rawValue, value);
}

function compareFields(entry, capturedPayload) {
  return carriedFields(entry.fullPayload || {}).map(({ loc, field, value: rawProduction }) => {
    const path = `${loc}.${field}`;
    const actualStage = actualField(capturedPayload, loc, field);
    const gated = SPECS.gated.get(path);
    const presence = SPECS.presence.get(path);
    let policyExpectation = rawProduction;
    let policyEqual = exactEqual(rawProduction, actualStage);
    let policy = 'exact';
    if (gated) {
      policyExpectation = resolveWant(gated, entry.page, rawProduction);
      policyEqual = gated.equalsPathname
        ? replayPathMatches(actualStage, policyExpectation)
        : gatedMatch(gated, policyExpectation, actualStage);
      policy = gated.equalsPathname ? 'equals-pathname' : 'gated';
    } else if (presence) {
      policyExpectation = '‹present›';
      policyEqual = populatedForPresence(actualStage, presence, rawProduction);
      policy = 'presence';
    } else if (path === 'properties.page_cas_id') {
      policyExpectation = entry.page || '/';
      policyEqual = replayPathMatches(actualStage, policyExpectation);
      policy = 'equals-pathname';
    }
    return {
      path,
      policy,
      rawProduction,
      policyExpectation,
      actualStage: actualStage === undefined ? null : actualStage,
      actualPresent: actualStage !== undefined,
      rawEqual: exactEqual(rawProduction, actualStage),
      policyEqual,
    };
  });
}

function addRefusal(refusals, refusal) {
  if (!refusals.some((item) => fingerprint(item) === fingerprint(refusal))) refusals.push(refusal);
}

function validateReplayQualification(capture, global, { expectedOrigin, nowMs }) {
  if ((capture.captureFormat || capture.source) !== 'authenticated-one-page-replay') return [];
  const { qualification } = capture;
  if (!isRecord(qualification)) return ['qualification'];
  const invalid = [];
  const requiredText = [
    'qualifiedAt', 'expiresAt', 'runId', 'mode', 'profileId', 'chromeVersion', 'harnessVersion',
    'lineagePolicyVersion', 'origin', 'consentState', 'authorizationRef', 'targetId', 'transportPolicy',
    'scenarioId', 'scenarioDefinitionHash',
  ];
  requiredText.forEach((field) => {
    if (!present(qualification[field]) || typeof qualification[field] !== 'string') invalid.push(`qualification.${field}`);
  });
  const qualifiedAt = Date.parse(qualification.qualifiedAt);
  const expiresAt = Date.parse(qualification.expiresAt);
  if (Number.isNaN(qualifiedAt) || Number.isNaN(expiresAt) || expiresAt <= qualifiedAt
    || expiresAt - qualifiedAt > 24 * 60 * 60 * 1000 || nowMs > expiresAt) invalid.push('qualification.validity');
  if (qualification.mode !== 'dedicated') invalid.push('qualification.mode');
  if (qualification.lineagePolicyVersion !== REPLAY_LINEAGE_POLICY_VERSION) invalid.push('qualification.lineagePolicyVersion');
  if (!isRecord(qualification.transportMarkerGuard)
    || qualification.transportMarkerGuard.verified !== true
    || qualification.transportMarkerGuard.detected !== false
    || qualification.transportMarkerGuard.markerKey !== REPLAY_INVOCATION_MARKER_KEY) {
    invalid.push('qualification.transportMarkerGuard');
  }
  if (qualification.origin !== expectedOrigin) invalid.push('qualification.origin');
  if (qualification.consentState !== 'resolved') invalid.push('qualification.consentState');
  if (!['observe', 'abort', 'test-sink'].includes(qualification.transportPolicy)) invalid.push('qualification.transportPolicy');
  if (qualification.runId !== global.runId) invalid.push('qualification.runId');
  if (qualification.profileId !== global.browser?.profileId) invalid.push('qualification.profileId');
  if (qualification.chromeVersion !== global.browser?.version) invalid.push('qualification.chromeVersion');
  if (qualification.harnessVersion !== global.harness?.version) invalid.push('qualification.harnessVersion');
  if (!isRecord(qualification.sourceHashes) || !isRecord(global.harness?.sourceHashes)
    || fingerprint(qualification.sourceHashes) !== fingerprint(global.harness?.sourceHashes)) {
    invalid.push('qualification.sourceHashes');
  } else {
    for (const [name, hash] of Object.entries(qualification.sourceHashes)) {
      if (!name || !isCanonicalHash(hash)) invalid.push('qualification.sourceHashes');
    }
    if (fingerprint(qualification.sourceHashes) !== fingerprint(currentHarnessSourceHashes())) {
      invalid.push('qualification.sourceHashes');
    }
  }
  const scenarioPolicy = currentQualificationScenario();
  if (qualification.scenarioId !== scenarioPolicy.scenarioId
    || qualification.scenarioId !== capture.golden?.scenarioId
    || qualification.scenarioDefinitionHash !== qualification.sourceHashes?.['clicktrack-qualification-scenario.json']) {
    invalid.push('qualification.scenarioDefinition');
  }
  if (!isRecord(qualification.runtimeHashes)) invalid.push('qualification.runtimeHashes');
  else {
    const expectedRuntime = [
      [`${global.origin}/scripts/scripts.js`, global.deployedHashes?.['scripts.js']],
      [`${global.origin}/scripts/tracking.js`, global.deployedHashes?.['tracking.js']],
      [`${global.origin}/scripts/ecs-enrich.js`, global.deployedHashes?.['ecs-enrich.js']],
      [`${global.origin}/tracking.json`, global.deployedHashes?.['tracking.json']],
      [global.tealium?.profileUrl, global.tealium?.contentHash],
      ...(global.trackerResources?.resources || []).map((resource) => [resource.url, resource.contentHash]),
      ...(Array.isArray(capture.pages) ? capture.pages : Object.values(capture.pages || {}))
        .flatMap((page) => (page.provenance?.sameOriginScripts || [])
        .map((resource) => [resource.url, resource.contentHash])),
    ];
    const expectedRuntimeMap = Object.fromEntries(expectedRuntime);
    const pageRuntimeMap = Object.fromEntries((Array.isArray(capture.pages) ? capture.pages : Object.values(capture.pages || {}))
      .flatMap((page) => (page.provenance?.sameOriginScripts || []).map((resource) => [resource.url, resource.contentHash])));
    (scenarioPolicy.runtimeAssets || []).forEach((path) => {
      const url = new URL(path, expectedOrigin).href;
      if (!pageRuntimeMap[url]) invalid.push('qualification.runtimeHashes');
    });
    if (fingerprint(qualification.runtimeHashes) !== fingerprint(expectedRuntimeMap)) {
      invalid.push('qualification.runtimeHashes');
    }
  }
  if (!isRecord(qualification.disconnectCleanup) || qualification.disconnectCleanup.verified !== true
    || qualification.disconnectCleanup.targetId !== qualification.targetId
    || qualification.targetId !== global.browser?.targetId
    || !Number.isFinite(qualification.disconnectCleanup.leaseMs)
    || qualification.disconnectCleanup.leaseMs <= 0 || qualification.disconnectCleanup.leaseMs > 10000) {
    invalid.push('qualification.disconnectCleanup');
  }
  return [...new Set(invalid)];
}

function inspectProvenance(captures, mode, {
  expectedOrigin, nowMs, maxCaptureAgeMs, maxFutureSkewMs,
}) {
  const refusals = [];
  const issues = [];
  const normalized = captures.map((capture, index) => {
    const sourceCapture = capture.source || `capture-${index + 1}`;
    const global = capture.provenance?.global || {};
    const validation = validateGlobal(global);
    if (validation.missing.length) {
      addRefusal(refusals, {
        code: 'MISSING_GLOBAL_PROVENANCE', sourceCapture, missing: validation.missing,
      });
    }
    if (validation.invalid.length) {
      addRefusal(refusals, {
        code: 'INVALID_GLOBAL_PROVENANCE', sourceCapture, invalid: validation.invalid,
      });
    }
    const qualificationInvalid = validateReplayQualification(capture, global, { expectedOrigin, nowMs });
    if (qualificationInvalid.length) {
      addRefusal(refusals, {
        code: 'INVALID_QUALIFICATION', sourceCapture, invalid: qualificationInvalid,
      });
    }
    if (!Array.isArray(capture.pages) && !isRecord(capture.pages)) {
      addRefusal(refusals, {
        code: 'INVALID_CAPTURE_STRUCTURE', sourceCapture, invalid: ['pages'],
      });
    }
    const capturedAtMs = Date.parse(global.capturedAt);
    if (!Number.isNaN(capturedAtMs)) {
      if (nowMs - capturedAtMs > maxCaptureAgeMs) {
        issues.push({
          code: 'STALE_CAPTURE', sourceCapture, capturedAt: global.capturedAt, maxCaptureAgeMs,
        });
      } else if (capturedAtMs - nowMs > maxFutureSkewMs) {
        issues.push({
          code: 'FUTURE_CAPTURE', sourceCapture, capturedAt: global.capturedAt, maxFutureSkewMs,
        });
      }
    }
    const captureOrigin = parsedUrl(global.origin)?.origin;
    if (captureOrigin && captureOrigin !== expectedOrigin) {
      issues.push({
        code: 'UNEXPECTED_CAPTURE_ORIGIN', sourceCapture, actualOrigin: captureOrigin, expectedOrigin,
      });
    }
    return {
      capture, sourceCapture, global, validation, pages: normalizePages(capture, sourceCapture),
    };
  });

  const validGlobals = normalized.filter(({ validation }) => validation.missing.length === 0 && validation.invalid.length === 0);
  if (validGlobals.length > 1) {
    const first = fingerprint(globalIdentity(validGlobals[0].global));
    const mismatches = validGlobals.filter(({ global }) => fingerprint(globalIdentity(global)) !== first);
    if (mismatches.length) {
      issues.push({
        code: 'MIXED_GLOBAL_PROVENANCE',
        sourceCaptures: validGlobals.map(({ sourceCapture }) => sourceCapture),
      });
    }
  }

  const allPages = normalized.flatMap(({ pages }) => pages);
  for (const page of allPages) {
    const provenance = page.provenance || {};
    const validation = validatePage(provenance);
    if (!present(page.pathname)) validation.missing.unshift('pathname');
    else if (typeof page.pathname !== 'string') validation.invalid.unshift('pathname');
    if (validation.missing.length) {
      addRefusal(refusals, {
        code: 'MISSING_PAGE_PROVENANCE', pathname: page.pathname, sourceCapture: page.sourceCapture, missing: validation.missing,
      });
    }
    if (validation.invalid.length) {
      addRefusal(refusals, {
        code: 'INVALID_PAGE_PROVENANCE', pathname: page.pathname, sourceCapture: page.sourceCapture, invalid: validation.invalid,
      });
    }
    if (isRecord(provenance.readiness) && (provenance.readiness.consent !== 'ready' || provenance.readiness.tracker !== 'ready')) {
      addRefusal(refusals, {
        code: 'PAGE_NOT_READY', pathname: page.pathname, sourceCapture: page.sourceCapture, readiness: provenance.readiness,
      });
    }
    if (!Array.isArray(page.events)) {
      addRefusal(refusals, {
        code: 'INVALID_CAPTURE_STRUCTURE', pathname: page.pathname, sourceCapture: page.sourceCapture, invalid: ['events'],
      });
    }
    const documentUrl = parsedUrl(provenance.document?.responseUrl);
    if (typeof provenance.document?.responseUrl === 'string'
      && (!documentUrl || documentUrl.origin !== expectedOrigin || !replayPathMatches(documentUrl.pathname, page.pathname))) {
      issues.push({
        code: 'DOCUMENT_URL_MISMATCH',
        pathname: page.pathname,
        sourceCapture: page.sourceCapture,
        responseUrl: provenance.document.responseUrl,
        expectedOrigin,
      });
    }
    if (Array.isArray(provenance.sameOriginScripts)) {
      const mismatches = provenance.sameOriginScripts
        .filter((resource) => parsedUrl(resource?.url)?.origin !== expectedOrigin)
        .map((resource) => resource?.url ?? null);
      if (mismatches.length) {
        issues.push({
          code: 'SAME_ORIGIN_SCRIPT_MISMATCH',
          pathname: page.pathname,
          sourceCapture: page.sourceCapture,
          expectedOrigin,
          urls: mismatches,
        });
      }
    }
    page.validation = validation;
  }

  const pagesByPath = new Map();
  for (const page of allPages.filter((item) => item.validation?.missing.length === 0 && item.validation?.invalid.length === 0)) {
    if (!pagesByPath.has(page.pathname)) pagesByPath.set(page.pathname, []);
    pagesByPath.get(page.pathname).push(page);
  }
  for (const [pathname, pages] of pagesByPath) {
    if (pages.length >= 2) {
      const first = fingerprint(pageIdentity(pages[0].provenance));
      if (pages.some((page) => fingerprint(pageIdentity(page.provenance)) !== first)) {
        issues.push({
          code: 'SAME_PAGE_FINGERPRINT_MISMATCH',
          pathname,
          sourceCaptures: pages.map((page) => page.sourceCapture),
        });
      }
    }
  }

  if (mode !== 'comparison') issues.forEach((issue) => addRefusal(refusals, issue));
  return {
    normalized,
    allPages,
    refusals,
    issues,
    mixed: issues.length > 0,
  };
}

function matchScenarios(golden, pages, refusals) {
  const entries = (golden.entries || []).map((entry, index) => {
    const aliasInspection = inspectScenarioAliases(entry);
    if (aliasInspection.invalid) {
      addRefusal(refusals, {
        code: 'INVALID_GOLDEN_SCENARIO_ID', index, aliases: aliasInspection.aliases.map(({ alias }) => alias),
      });
    }
    return {
      entry,
      index,
      aliasInvalid: aliasInspection.invalid,
      explicitScenarioId: aliasInspection.value,
      scenarioId: goldenScenarioOf(entry, index, aliasInspection),
      semanticKey: semanticKey(entry.fullPayload || {}),
    };
  });
  const events = pages.flatMap((page) => (Array.isArray(page.events) ? page.events : []).map((event, index) => {
    const aliasInspection = inspectScenarioAliases(event);
    if (aliasInspection.invalid) {
      addRefusal(refusals, {
        code: 'INVALID_CAPTURED_SCENARIO_ID',
        pathname: page.pathname,
        sourceCapture: page.sourceCapture,
        sourceEvent: index,
        aliases: aliasInspection.aliases.map(({ alias }) => alias),
      });
    }
    return {
      event,
      index,
      page: page.pathname,
      sourceCapture: page.sourceCapture,
      aliasInvalid: aliasInspection.invalid,
      scenarioId: scenarioOf(event, aliasInspection),
      semanticKey: semanticKey(payloadOf(event)),
    };
  }));
  const comparisons = [];
  const usedEntries = new Set();
  const usedEvents = new Set();

  const byScenario = new Map();
  for (const item of entries.filter(({ aliasInvalid, explicitScenarioId }) => !aliasInvalid && explicitScenarioId !== null)) {
    if (!byScenario.has(item.explicitScenarioId)) byScenario.set(item.explicitScenarioId, []);
    byScenario.get(item.explicitScenarioId).push(item);
  }
  for (const [scenarioId, candidates] of byScenario) {
    if (candidates.length > 1) {
      addRefusal(refusals, {
        code: 'DUPLICATE_SCENARIO_ID', scenarioId, candidates: candidates.map(({ index }) => index),
      });
    }
  }

  for (const item of entries.filter(({ aliasInvalid, explicitScenarioId }) => !aliasInvalid && explicitScenarioId !== null)) {
    const candidates = events.filter((event) => !event.aliasInvalid && event.scenarioId === item.explicitScenarioId && event.page === item.entry.page && !usedEvents.has(event));
    if (candidates.length > 1) {
      addRefusal(refusals, {
        code: 'AMBIGUOUS_IDENTITY',
        pathname: item.entry.page,
        semanticKey: item.semanticKey,
        candidates: [item.scenarioId],
        sourceCaptures: candidates.map(({ sourceCapture }) => sourceCapture),
      });
    } else if (candidates.length === 1) {
      comparisons.push({ item, captured: candidates[0] });
      usedEntries.add(item);
      usedEvents.add(candidates[0]);
    }
  }

  const legacyEvents = events.filter((event) => !event.aliasInvalid && !usedEvents.has(event));
  const remainingEntries = entries.filter((entry) => !entry.aliasInvalid && !usedEntries.has(entry));
  const groups = new Map();
  for (const item of remainingEntries) {
    const key = `${item.entry.page}\n${item.semanticKey}`;
    if (!groups.has(key)) groups.set(key, { entries: [], events: [] });
    groups.get(key).entries.push(item);
  }
  for (const captured of legacyEvents) {
    const key = `${captured.page}\n${captured.semanticKey}`;
    const group = groups.get(key);
    if (group) {
      const hasLegacyEntry = group.entries.some(({ explicitScenarioId }) => explicitScenarioId === null);
      if (!captured.scenarioId || hasLegacyEntry) group.events.push(captured);
    }
  }
  for (const [key, group] of groups) {
    if (group.entries.length === 1 && group.events.length === 1) {
      comparisons.push({ item: group.entries[0], captured: group.events[0] });
      usedEntries.add(group.entries[0]);
      usedEvents.add(group.events[0]);
    } else if (group.entries.length && group.events.length && (group.entries.length > 1 || group.events.length > 1)) {
      addRefusal(refusals, {
        code: 'AMBIGUOUS_IDENTITY',
        pathname: group.entries[0]?.entry.page || group.events[0]?.page,
        semanticKey: key.split('\n')[1],
        candidates: group.entries.map(({ scenarioId }) => scenarioId),
        sourceCaptures: [...new Set(group.events.map(({ sourceCapture }) => sourceCapture))],
      });
    }
  }

  return {
    matches: comparisons,
    unreproduced: entries.filter((entry) => !usedEntries.has(entry)),
    extra: events.filter((event) => !usedEvents.has(event)),
  };
}

function canonicalIdentity(value) {
  if (Array.isArray(value)) return value.map(canonicalIdentity);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalIdentity(value[key])]));
  }
  return value;
}

export function scenarioIdentityHash(golden) {
  const identities = (golden.entries || []).map((entry) => JSON.stringify(canonicalIdentity({
    aliases: Object.fromEntries(SCENARIO_ALIASES
      .filter((alias) => Object.hasOwn(entry, alias)).map((alias) => [alias, entry[alias]])),
    page: entry.page,
    fullPayload: entry.fullPayload,
  }))).sort();
  return createHash('sha256').update(identities.join('\n')).digest('hex');
}

function lockedAliasIdentity(entry) {
  const topLevel = Object.fromEntries(SCENARIO_ALIASES.map((alias) => [alias, {
    present: Object.hasOwn(entry, alias),
    value: Object.hasOwn(entry, alias) ? entry[alias] : null,
  }]));
  const correlatedPresent = isRecord(entry.correlation) && Object.hasOwn(entry.correlation, 'scenarioId');
  return {
    ...topLevel,
    'correlation.scenarioId': {
      present: correlatedPresent,
      value: correlatedPresent ? entry.correlation.scenarioId : null,
    },
  };
}

function goldenIdentityHash(golden) {
  const identities = (golden.entries || []).map((entry) => JSON.stringify(canonicalIdentity({
    page: entry.page,
    aliases: lockedAliasIdentity(entry),
    fullPayload: entry.fullPayload,
  }))).sort();
  return createHash('sha256').update(identities.join('\n')).digest('hex');
}

function normalizeGoldenPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  const url = parsedUrl(`https://golden.invalid${value}`);
  if (!url || url.search || url.hash) return null;
  return url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
}

function assertGoldenAliasesAndPages(golden) {
  const entries = golden.entries || [];
  const inspections = entries.map(inspectScenarioAliases);
  if (inspections.some(({ invalid }) => invalid)) throw new Error('golden integrity: invalid scenario alias');
  for (const [index, entry] of entries.entries()) {
    const expected = normalizeGoldenPath(entry.page);
    const payloadPage = entry.fullPayload?.context?.page;
    const payloadPath = normalizeGoldenPath(payloadPage?.path);
    const payloadUrl = parsedUrl(payloadPage?.url);
    const urlPath = normalizeGoldenPath(payloadUrl?.pathname);
    if (!expected || payloadPath !== expected || urlPath !== expected) {
      throw new Error(`golden integrity: page identity mismatch at entry ${index}`);
    }
  }
}

function assertGoldenIdentityIntegrity(golden) {
  const entries = golden.entries || [];
  const digest = golden.integrity?.scenarioSha256;
  if (digest !== undefined) {
    if (!isCanonicalHash(`sha256:${digest}`)) throw new Error('golden integrity: invalid scenarioSha256');
    if (scenarioIdentityHash(golden) !== digest) throw new Error('golden integrity: scenario identity hash mismatch');
  }
  assertGoldenAliasesAndPages(golden);
  if (entries.some((entry) => inspectScenarioAliases(entry).value !== null) && digest === undefined) {
    throw new Error('golden integrity: scenarioSha256 is required for stable scenario identities');
  }
}

export function createGoldenIdentityLock(golden) {
  assertIntegrity(golden);
  assertGoldenAliasesAndPages(golden);
  return {
    version: 1,
    payloadManifest: {
      payloads: golden.integrity.payloads,
      sha256: golden.integrity.sha256,
    },
    identitySha256: goldenIdentityHash(golden),
  };
}

function assertExternalIdentityLock(golden, identityLock) {
  if (!isRecord(identityLock)) throw new Error('identity lock is required for integrity-enforced evaluation');
  if (identityLock.version !== 1) throw new Error('identity lock version must be 1');
  if (!isRecord(identityLock.payloadManifest)
    || !Number.isInteger(identityLock.payloadManifest.payloads)
    || identityLock.payloadManifest.payloads < 0
    || !/^[0-9a-f]{64}$/.test(identityLock.payloadManifest.sha256 || '')) {
    throw new Error('identity lock payload manifest is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(identityLock.identitySha256 || '')) {
    throw new Error('identity lock identity SHA is invalid');
  }
  if (identityLock.payloadManifest.payloads !== golden.integrity.payloads
    || identityLock.payloadManifest.sha256 !== golden.integrity.sha256) {
    throw new Error('identity lock payload manifest does not match the golden');
  }
  assertGoldenAliasesAndPages(golden);
  if (identityLock.identitySha256 !== goldenIdentityHash(golden)) {
    throw new Error('identity lock identity hash does not match the golden');
  }
}

export function evaluateOfflineVerdict({
  golden,
  captures,
  mode = 'current',
  threshold = THRESHOLD,
  requireIntegrity = false,
  identityLock,
  expectedOrigin = DEFAULT_EXPECTED_ORIGIN,
  clock = () => new Date(),
  maxCaptureAgeMs = DEFAULT_MAX_CAPTURE_AGE_MS,
  maxFutureSkewMs = DEFAULT_FUTURE_SKEW_MS,
}) {
  if (!golden || !Array.isArray(golden.entries)) throw new Error('golden.entries must be an array');
  if (!Array.isArray(captures) || captures.length === 0) throw new Error('at least one capture is required');
  if (!['current', 'comparison'].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
  if (requireIntegrity) {
    assertIntegrity(golden);
    assertExternalIdentityLock(golden, identityLock);
  } else if (golden.integrity) {
    assertIntegrity(golden);
    assertGoldenIdentityIntegrity(golden);
  }
  const expectedUrl = parsedUrl(expectedOrigin);
  if (!isCanonicalOrigin(expectedOrigin)) throw new Error(`invalid expected origin: ${expectedOrigin}`);
  const nowMs = new Date(clock()).getTime();
  if (Number.isNaN(nowMs)) throw new Error('evaluation clock returned an invalid date');
  if (!Number.isFinite(maxCaptureAgeMs) || maxCaptureAgeMs < 0) throw new Error('maxCaptureAgeMs must be a non-negative number');
  if (!Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) throw new Error('maxFutureSkewMs must be a non-negative number');

  const provenance = inspectProvenance(captures, mode, {
    expectedOrigin: expectedUrl.origin,
    nowMs,
    maxCaptureAgeMs,
    maxFutureSkewMs,
  });
  const refusals = [...provenance.refusals];
  if (golden.entries.length === 0) addRefusal(refusals, { code: 'EMPTY_GOLDEN' });
  const matched = matchScenarios(golden, provenance.allPages, refusals);
  for (const event of matched.extra) {
    addRefusal(refusals, {
      code: 'UNCORRELATED_CAPTURED_CLICK',
      scenarioId: event.scenarioId,
      pathname: event.page,
      sourceCapture: event.sourceCapture,
      sourceEvent: event.index,
      pageCasId: payloadOf(event.event).properties?.page_cas_id ?? null,
    });
  }
  const comparisons = matched.matches.map(({ item, captured }) => {
    const fields = compareFields(item.entry, payloadOf(captured.event));
    return {
      scenarioId: item.scenarioId,
      pathname: item.entry.page,
      sourceCapture: captured.sourceCapture,
      sourceEvent: captured.index,
      fields,
      rawEqual: fields.every((field) => field.rawEqual),
      policyEqual: fields.every((field) => field.policyEqual),
    };
  });

  const pageCasFailures = comparisons.filter((comparison) => {
    const field = comparison.fields.find((item) => item.path === 'properties.page_cas_id');
    return !field || !field.actualPresent || !replayPathMatches(field.actualStage, comparison.pathname);
  }).map((comparison) => ({
    scenarioId: comparison.scenarioId,
    pathname: comparison.pathname,
    sourceCapture: comparison.sourceCapture,
    actualStage: comparison.fields.find((item) => item.path === 'properties.page_cas_id')?.actualStage ?? null,
  }));
  const presenceFailures = comparisons.flatMap((comparison) => comparison.fields
    .filter((field) => field.policy === 'presence' && !field.policyEqual)
    .map((field) => ({
      scenarioId: comparison.scenarioId,
      pathname: comparison.pathname,
      sourceCapture: comparison.sourceCapture,
      field: field.path,
    })));

  const allFields = comparisons.flatMap((comparison) => comparison.fields);
  const aggregateScore = pct(allFields.filter((field) => field.policyEqual).length, allFields.length);
  const coverage = golden.entries.length ? pct(comparisons.length, golden.entries.length) : null;
  const hardGate = {
    pass: pageCasFailures.length === 0,
    checked: comparisons.length,
    failed: pageCasFailures.length,
    failures: pageCasFailures,
  };
  const presenceGate = {
    pass: presenceFailures.length === 0,
    checked: comparisons.flatMap((comparison) => comparison.fields).filter((field) => field.policy === 'presence').length,
    failed: presenceFailures.length,
    failures: presenceFailures,
  };
  const mixedComparison = mode === 'comparison' && provenance.mixed;
  const currentParityEligible = refusals.length === 0 && !mixedComparison;
  const score = currentParityEligible || mixedComparison ? aggregateScore : null;
  let verdict = 'FAIL';
  if (refusals.length) verdict = 'REFUSED';
  else if (mixedComparison) verdict = 'MIXED';
  else if (aggregateScore >= threshold && coverage === 100 && hardGate.pass && presenceGate.pass) verdict = 'PASS';

  const failures = [
    ...refusals,
    ...provenance.issues.filter((issue) => !refusals.some((refusal) => fingerprint(refusal) === fingerprint(issue))),
    ...matched.unreproduced.map(({ entry, scenarioId }) => ({
      code: 'UNREPRODUCED_SCENARIO', scenarioId, pathname: entry.page, sourceCapture: null,
    })),
    ...pageCasFailures.map((failure) => ({ code: 'PAGE_CAS_ID_GATE', ...failure })),
    ...presenceFailures.map((failure) => ({ code: 'PRESENCE_GATE', ...failure })),
    ...comparisons.filter((comparison) => !comparison.policyEqual).map((comparison) => ({
      code: 'POLICY_MISMATCH',
      scenarioId: comparison.scenarioId,
      pathname: comparison.pathname,
      sourceCapture: comparison.sourceCapture,
      fields: comparison.fields.filter((field) => !field.policyEqual).map((field) => field.path),
    })),
  ];
  let provenanceLabel = 'current';
  if (provenance.mixed) provenanceLabel = 'mixed/stale';
  else if (refusals.some((item) => item.code.includes('PROVENANCE'))) provenanceLabel = 'missing';

  return {
    schemaVersion: 1,
    mode,
    verdict,
    currentParityEligible,
    threshold,
    score,
    coverage,
    provenance: {
      label: provenanceLabel,
      issues: provenance.issues,
      runs: provenance.normalized.map(({ sourceCapture, global }) => ({ sourceCapture, global })),
      pages: provenance.allPages.map((page) => ({
        pathname: page.pathname,
        sourceCapture: page.sourceCapture,
        document: page.provenance?.document,
        interactionInventoryHash: page.provenance?.interactionInventoryHash,
        sameOriginScripts: page.provenance?.sameOriginScripts,
        readiness: page.provenance?.readiness,
        activationEvidence: page.provenance?.activationEvidence,
      })),
    },
    gates: { pageCasId: hardGate, presence: presenceGate },
    refusals,
    failures,
    comparisons,
    unreproduced: matched.unreproduced.map(({ entry, scenarioId }) => ({ scenarioId, pathname: entry.page })),
    extraCapturedEvents: matched.extra.map((event) => ({
      scenarioId: event.scenarioId,
      pathname: event.page,
      sourceCapture: event.sourceCapture,
      sourceEvent: event.index,
    })),
  };
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const display = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value ?? '‹absent›'));

function renderSource(source) {
  const raw = String(source ?? '');
  const cleaned = sanitizeTerminal(raw);
  let href = null;
  const safeAbsolutePath = /^\/(?!\/)[^\\]*$/.test(cleaned);
  if (raw === cleaned && safeAbsolutePath) href = pathToFileURL(cleaned).href;
  else if (raw === cleaned) {
    const url = parsedUrl(cleaned);
    const localFile = url?.protocol === 'file:'
      && (!url.hostname || url.hostname === 'localhost')
      && !cleaned.includes('\\')
      && /^\/(?!\/)/.test(url.pathname);
    if (localFile || ['http:', 'https:'].includes(url?.protocol)) href = cleaned;
  }
  const text = escapeHtml(cleaned || '—');
  return href ? `<a href="${escapeHtml(href)}">${text}</a>` : text;
}

function renderFailure(failure) {
  const scenarios = failure.candidates?.length
    ? failure.candidates
    : [failure.scenarioId || '—'];
  let sources = failure.sourceCaptures?.length ? failure.sourceCaptures : [];
  if (!sources.length && failure.sourceCapture) sources = [failure.sourceCapture];
  const sourceLinks = [...new Set(sources)].map(renderSource).join(', ') || '—';
  const details = [];
  if (failure.pathname) details.push(`page=${failure.pathname}`);
  if (failure.missing?.length) details.push(`missing=${failure.missing.join(', ')}`);
  if (failure.invalid?.length) details.push(`invalid=${failure.invalid.join(', ')}`);
  if (isRecord(failure.readiness)) {
    details.push(`readiness=${Object.entries(failure.readiness).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  if (failure.fields?.length) details.push(`fields=${failure.fields.join(', ')}`);
  return `<li><strong>${escapeHtml(failure.code)}</strong> scenario=${escapeHtml(scenarios.join(', '))} source=${sourceLinks}${details.length ? ` ${escapeHtml(details.join(' '))}` : ''}</li>`;
}

export function renderOfflineVerdictHtml(result) {
  const rows = result.comparisons.flatMap((comparison) => comparison.fields.map((field) => `<tr id="${escapeHtml(comparison.scenarioId)}-${escapeHtml(field.path)}">
    <td>${escapeHtml(comparison.scenarioId)}</td><td>${escapeHtml(comparison.pathname)}</td>
    <td>${renderSource(comparison.sourceCapture)}#${comparison.sourceEvent}</td>
    <td>${escapeHtml(field.path)}</td><td>${escapeHtml(display(field.rawProduction))}</td>
    <td>${escapeHtml(display(field.policyExpectation))}</td><td>${escapeHtml(display(field.actualStage))}</td>
    <td>${field.rawEqual ? 'yes' : 'no'}</td><td>${field.policyEqual ? 'yes' : 'no'}</td>
  </tr>`)).join('\n');
  const failures = result.failures.map(renderFailure).join('\n');
  const score = result.score == null ? 'not published' : `${result.score}%`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Click-tracking offline verdict</title>
<style>body{font:14px system-ui;margin:2rem;color:#1f2937}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:.45rem;text-align:left;vertical-align:top}th{background:#f3f4f6}.PASS{color:#067647}.FAIL,.REFUSED,.MIXED{color:#b42318}code{white-space:pre-wrap}</style></head>
<body><h1>Click-tracking offline verdict: <span class="${escapeHtml(result.verdict)}">${escapeHtml(result.verdict)}</span></h1>
<p>Provenance: ${escapeHtml(result.provenance.label)}. Score: ${escapeHtml(score)}. Coverage: ${escapeHtml(result.coverage ?? 'not available')}%. page_cas_id gate: ${result.gates.pageCasId.pass ? 'PASS' : 'FAIL'}.</p>
<h2>Failures</h2><ul>${failures || '<li>None</li>'}</ul>
<h2>Field comparisons</h2><table><thead><tr><th>Scenario</th><th>Page</th><th>Source capture</th><th>Field</th><th>Raw production</th><th>Policy expectation</th><th>Actual stage</th><th>Raw equal</th><th>Policy equal</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function parseArgs(argv) {
  const options = { captures: [], mode: 'current' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--golden') options.golden = argv[index += 1];
    else if (arg === '--identity-lock') options.identityLock = argv[index += 1];
    else if (arg === '--capture' || arg === '--captures') options.captures.push(argv[index += 1]);
    else if (arg === '--json-out' || arg === '--out') options.jsonOut = argv[index += 1];
    else if (arg === '--html-out') options.htmlOut = argv[index += 1];
    else if (arg === '--expected-origin') options.expectedOrigin = argv[index += 1];
    else if (arg === '--comparison') options.mode = 'comparison';
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.golden) throw new Error('--golden is required');
  if (!options.identityLock) throw new Error('--identity-lock is required');
  if (!options.captures.length) throw new Error('at least one --capture is required');
  options.jsonOut ||= 'click-tracking-offline-verdict.json';
  options.htmlOut ||= 'click-tracking-offline-verdict.html';
  return options;
}

function writeOutput(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function runCli(argv) {
  const options = parseArgs(argv);
  const golden = JSON.parse(readFileSync(options.golden, 'utf8'));
  const identityLock = JSON.parse(readFileSync(options.identityLock, 'utf8'));
  const captures = options.captures.map((path) => {
    const capture = JSON.parse(readFileSync(path, 'utf8'));
    return { ...capture, captureFormat: capture.source, source: path };
  });
  const result = evaluateOfflineVerdict({
    golden,
    captures,
    mode: options.mode,
    requireIntegrity: true,
    identityLock,
    expectedOrigin: options.expectedOrigin || DEFAULT_EXPECTED_ORIGIN,
  });
  writeOutput(options.jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  writeOutput(options.htmlOut, renderOfflineVerdictHtml(result));
  console.log(sanitizeTerminal(`${result.verdict}: wrote ${options.jsonOut} and ${options.htmlOut}`));
  return result.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(sanitizeTerminal(error.message));
    process.exitCode = 2;
  }
}
