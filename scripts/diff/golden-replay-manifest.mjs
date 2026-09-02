#!/usr/bin/env node
/**
 * Create and validate the reviewed customer-golden replay manifest. Scenario
 * IDs bind immutable golden filenames but remain independent from array order,
 * labels, authored tracking IDs, and mutable stage locator evidence.
 */
/* eslint-disable import/extensions, no-console, no-restricted-syntax, max-len, no-plusplus, no-nested-ternary, object-property-newline, newline-per-chained-call */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGoldenIdentityLock } from './trustworthy-offline-verdict.mjs';

const SCHEMA_VERSION = 1;
const IDENTITY_POLICY_VERSION = 'golden-ref-v1';
const DEFAULT_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_LOCK = '.jig/click-tracking-harness/evidence/customer-golden-identity-lock.json';
const DEFAULT_OUT = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const KEY_RUNTIME_ASSETS = {
  nav: ['/blocks/header/header.js'],
  footer: ['/blocks/footer/footer.js'],
  faq: ['/blocks/faq/faq.js'],
  hero: ['/blocks/hero/hero.js'],
  cta: ['/blocks/cta-band/cta-band.js'],
  product_banner: ['/blocks/highlight/highlight.js'],
  feature: ['/blocks/feature-grid/feature-grid.js'],
  'talk-to-sales': ['/blocks/contact-us/contact-us.js'],
  testimonial: ['/blocks/testimonial/testimonial.js'],
  video: ['/blocks/video/video.js'],
  'case-study-header': ['/blocks/case-study-header/case-study-header.js', '/blocks/blog-template/blog-template.js'],
  disclaimer: ['/blocks/disclosure/disclosure.js'],
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const fingerprint = (value) => JSON.stringify(canonical(value));
const payloadHash = (payload) => sha256(fingerprint(payload));
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const slug = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'root';

function expectedScenarioId(entry) {
  const pageSlug = entry.page === '/' ? 'home' : slug(entry.page);
  const identity = sha256(`${entry.page}\0${entry.payloadFile}`).slice('sha256:'.length, 'sha256:'.length + 12);
  return `customer-${pageSlug}-${identity}`;
}

function regionOf(properties) {
  const detail = String(properties.ui_object_detail || '');
  const access = String(properties.ui_access_point || '');
  if (/^(?:nav\||logo_nav)/i.test(detail) || /nav/i.test(access)) return 'header';
  if (/^(?:ftr[-|]|sitemap$|intuit$|about cookies$)/i.test(detail) || /footer/i.test(access)) return 'footer';
  if (/talktosales|contact/i.test(`${detail} ${access}`)) return 'widget';
  return 'main';
}

function targetSignature(entry) {
  const properties = entry.fullPayload?.properties || {};
  return {
    page: entry.page,
    region: regionOf(properties),
    object: properties.object || '',
    objectDetail: properties.object_detail || '',
    uiObject: properties.ui_object || '',
    uiObjectDetail: cleanText(properties.ui_object_detail || entry.text || entry.ctaLabel),
    uiAccessPoint: properties.ui_access_point || '',
    waLink: properties['data-wa-link'] || '',
    href: properties.link_href || '',
  };
}

function expectationSignature(entry) {
  const properties = entry.fullPayload?.properties || {};
  return Object.fromEntries([
    'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action',
    'ui_access_point', 'data-wa-link', 'link_name', 'link_href', 'link_href_domain',
  ].map((key) => [key, properties[key] ?? null]));
}

function runtimeAssetsFor(entry) {
  if (entry.key === 'cards') {
    return [entry.page === '/events' ? '/blocks/event-cards/event-cards.js' : '/blocks/cards/cards.js'];
  }
  return KEY_RUNTIME_ASSETS[entry.key] || [];
}

function preconditionsFor(entry) {
  const properties = entry.fullPayload?.properties || {};
  if (!/^accordion_item_/i.test(String(properties.ui_object || ''))) return {};
  if (properties.ui_action === 'displayed') return { attributes: { 'aria-expanded': 'false' } };
  if (properties.ui_action === 'dismissed') return { attributes: { 'aria-expanded': 'true' } };
  return {};
}

function classifyEntries(entries) {
  const interactive = entries.filter((entry) => entry.event !== 'chat:viewed');
  const groups = new Map();
  interactive.forEach((entry) => {
    const key = fingerprint(targetSignature(entry));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const classifications = new Map();
  entries.forEach((entry) => {
    if (entry.event === 'chat:viewed') {
      classifications.set(entry.payloadFile, {
        interaction: 'passive', duplicate: false, variant: false,
        structuralException: true, disposition: 'passive', reason: 'chat:viewed is a passive structural event',
      });
      return;
    }
    const group = groups.get(fingerprint(targetSignature(entry))) || [];
    const expectations = new Set(group.map(expectationSignature).map(fingerprint));
    const duplicate = group.length > 1 && expectations.size === 1;
    const variant = group.length > 1 && expectations.size > 1;
    classifications.set(entry.payloadFile, {
      interaction: 'interactive', duplicate, variant, structuralException: false,
      disposition: duplicate ? 'duplicate' : variant ? 'variant' : 'pending-stage-inventory',
      reason: duplicate ? 'same reviewed target and deterministic expectation' : variant ? 'same reviewed target with payload-policy variants' : '',
    });
  });
  return classifications;
}

function summaryFor(scenarios) {
  const count = (predicate) => scenarios.filter(predicate).length;
  return {
    total: scenarios.length,
    interactive: count(({ classification }) => classification.interaction === 'interactive'),
    passive: count(({ classification }) => classification.interaction === 'passive'),
    duplicate: count(({ classification }) => classification.duplicate),
    variant: count(({ classification }) => classification.variant),
    qualified: count(({ locator }) => locator?.status === 'qualified'),
    pending: count(({ locator }) => locator?.status !== 'qualified'),
  };
}

export function manifestMappingHash(scenarios) {
  return sha256(scenarios.map(({ scenarioId, goldenRef }) => [
    scenarioId, goldenRef.payloadFile, goldenRef.fullPayloadSha256,
  ].join('\0')).sort().join('\n'));
}

export function manifestContentHash(manifest) {
  const { manifestContentHash: _ignored, ...content } = manifest;
  return sha256(fingerprint(content));
}

function identityLockEqual(left, right) {
  return fingerprint(left) === fingerprint(right);
}

export function createGoldenReplayManifest(golden, identityLock, { existingManifest } = {}) {
  const actualLock = createGoldenIdentityLock(golden);
  if (!identityLockEqual(identityLock, actualLock)) throw new Error('golden identity lock does not match the customer golden');
  const existingByRef = new Map((existingManifest?.scenarios || [])
    .map((scenario) => [scenario.goldenRef?.payloadFile, scenario]));
  const classifications = classifyEntries(golden.entries);
  const scenarios = golden.entries.map((entry) => {
    const previous = existingByRef.get(entry.payloadFile) || {};
    const scenarioId = previous.scenarioId || expectedScenarioId(entry);
    return {
      ...previous,
      scenarioId,
      page: entry.page,
      goldenRef: {
        payloadFile: entry.payloadFile,
        fullPayloadSha256: payloadHash(entry.fullPayload),
        event: entry.event || entry.fullPayload?.event,
      },
      classification: classifications.get(entry.payloadFile),
      targetSignature: targetSignature(entry),
      locator: previous.locator || { status: 'pending-stage-inventory' },
      occurrence: previous.occurrence || null,
      preconditions: Object.keys(previous.preconditions || {}).length
        ? previous.preconditions : preconditionsFor(entry),
      setupSteps: previous.setupSteps || [],
      interaction: previous.interaction || {
        type: entry.event === 'chat:viewed' ? 'passive' : 'click', preventNavigation: true, authorizedText: null,
      },
      expected: {
        event: entry.event || entry.fullPayload?.event,
        pageCasIdEqualsPathname: true,
        invocationCount: entry.event === 'chat:viewed' ? 0 : 1,
        serializedCount: entry.event === 'chat:viewed' ? 0 : 1,
      },
      runtimeAssets: previous.runtimeAssets?.length ? previous.runtimeAssets : runtimeAssetsFor(entry),
    };
  });
  const pageMap = new Map();
  scenarios.forEach((scenario) => {
    if (!pageMap.has(scenario.page)) pageMap.set(scenario.page, []);
    pageMap.get(scenario.page).push(scenario);
  });
  const existingPageByPath = new Map((existingManifest?.pages || []).map((page) => [page.pathname, page]));
  const pages = [...pageMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([pathname, pageScenarios]) => {
    const previous = existingPageByPath.get(pathname) || {};
    return {
      pathname,
      expectedScenarioIds: pageScenarios.map(({ scenarioId }) => scenarioId),
      expectedCounts: summaryFor(pageScenarios),
      readiness: previous.readiness || { status: 'pending-stage-inventory' },
      resetStrategy: previous.resetStrategy || 'reload-page',
      runtimeAssets: [...new Set(pageScenarios.flatMap(({ runtimeAssets }) => runtimeAssets))].sort(),
    };
  });
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    identityPolicyVersion: IDENTITY_POLICY_VERSION,
    manifestId: 'intuit-erp-customer-golden',
    exactOrigin: DEFAULT_ORIGIN,
    goldenIdentityLock: canonical(identityLock),
    pages,
    scenarios,
    classificationSummary: summaryFor(scenarios),
  };
  manifest.goldenMappingHash = manifestMappingHash(scenarios);
  manifest.manifestContentHash = manifestContentHash(manifest);
  return manifest;
}

export function validateGoldenReplayManifest(manifest, golden, identityLock) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is required');
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.identityPolicyVersion !== IDENTITY_POLICY_VERSION) {
    throw new Error('manifest schema or identity policy version is unsupported');
  }
  const actualLock = createGoldenIdentityLock(golden);
  if (!identityLockEqual(identityLock, actualLock) || !identityLockEqual(manifest.goldenIdentityLock, identityLock)) {
    throw new Error('manifest golden identity lock does not match');
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length !== golden.entries.length) {
    throw new Error('manifest must account for every golden entry exactly once');
  }
  const scenarioIds = new Set();
  const payloadFiles = new Set();
  const goldenByRef = new Map(golden.entries.map((entry) => [entry.payloadFile, entry]));
  for (const scenario of manifest.scenarios) {
    const ref = scenario.goldenRef;
    if (!scenario.scenarioId || scenarioIds.has(scenario.scenarioId)) throw new Error('manifest scenario IDs must be unique');
    scenarioIds.add(scenario.scenarioId);
    if (!ref?.payloadFile || payloadFiles.has(ref.payloadFile)) throw new Error('each golden reference must appear exactly once');
    payloadFiles.add(ref.payloadFile);
    const entry = goldenByRef.get(ref.payloadFile);
    if (!entry || scenario.scenarioId !== expectedScenarioId(entry)
      || scenario.page !== entry.page || ref.fullPayloadSha256 !== payloadHash(entry.fullPayload)
      || ref.event !== (entry.event || entry.fullPayload?.event)) {
      throw new Error(`manifest golden reference is invalid: ${ref.payloadFile}`);
    }
  }
  if (payloadFiles.size !== goldenByRef.size) throw new Error('each golden reference must appear exactly once');
  const pageScenarioIds = (manifest.pages || []).flatMap((page) => page.expectedScenarioIds || []);
  if (pageScenarioIds.length !== scenarioIds.size || new Set(pageScenarioIds).size !== scenarioIds.size
    || pageScenarioIds.some((scenarioId) => !scenarioIds.has(scenarioId))) {
    throw new Error('manifest page accounting does not match scenarios');
  }
  for (const page of manifest.pages || []) {
    const expected = manifest.scenarios.filter(({ page: pathname }) => pathname === page.pathname);
    if (fingerprint(page.expectedCounts) !== fingerprint(summaryFor(expected))) {
      throw new Error(`manifest page counts changed: ${page.pathname}`);
    }
  }
  if (fingerprint(manifest.classificationSummary) !== fingerprint(summaryFor(manifest.scenarios))) {
    throw new Error('manifest classification summary changed');
  }
  if (manifest.goldenMappingHash !== manifestMappingHash(manifest.scenarios)) throw new Error('manifest golden mapping hash changed');
  if (manifest.manifestContentHash !== manifestContentHash(manifest)) throw new Error('manifest content hash changed');
  return manifest;
}

function parseArgs(argv) {
  const options = {
    golden: DEFAULT_GOLDEN, identityLock: DEFAULT_LOCK, out: DEFAULT_OUT, refresh: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--golden') options.golden = argv[++index];
    else if (argv[index] === '--identity-lock') options.identityLock = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--refresh') options.refresh = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const golden = JSON.parse(readFileSync(options.golden, 'utf8'));
  const identityLock = JSON.parse(readFileSync(options.identityLock, 'utf8'));
  const existingManifest = options.refresh && existsSync(options.out)
    ? JSON.parse(readFileSync(options.out, 'utf8')) : undefined;
  if (existsSync(options.out) && !options.refresh) throw new Error('manifest exists; pass --refresh to retain stable scenario IDs and reviewed evidence');
  const manifest = createGoldenReplayManifest(golden, identityLock, { existingManifest });
  validateGoldenReplayManifest(manifest, golden, identityLock);
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    output: options.out,
    manifestContentHash: manifest.manifestContentHash,
    goldenMappingHash: manifest.goldenMappingHash,
    pages: manifest.pages.length,
    classifications: manifest.classificationSummary,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
