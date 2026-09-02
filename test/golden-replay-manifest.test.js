import {
  describe, expect, it,
} from 'vitest';
import { createHash } from 'node:crypto';
import {
  createGoldenReplayManifest, manifestContentHash, manifestMappingHash, validateGoldenReplayManifest,
} from '../scripts/diff/golden-replay-manifest.mjs';
import { createGoldenIdentityLock } from '../scripts/diff/trustworthy-offline-verdict.mjs';
import { goldenHash } from '../scripts/diff/oracle-lib.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const scenarioHash = (golden) => createHash('sha256').update(golden.entries
  .map((entry) => JSON.stringify(canonical({ aliases: {}, page: entry.page, fullPayload: entry.fullPayload })))
  .sort().join('\n')).digest('hex');

const entry = (payloadFile, {
  page = '/foo', event = 'content:interacted', detail = 'Get started', action = 'interacted',
  uiObject, uiAction,
} = {}) => ({
  page,
  payloadFile,
  event,
  text: detail,
  fullPayload: {
    event,
    properties: {
      object: event === 'chat:viewed' ? 'chat' : 'content',
      object_detail: 'hero',
      action,
      ui_object: uiObject || (event === 'chat:viewed' ? 'chat' : 'button'),
      ui_object_detail: detail,
      ui_action: uiAction || (event === 'chat:viewed' ? 'displayed' : 'clicked'),
      ui_access_point: 'hero',
      page_cas_id: 'legacy-cas',
    },
    context: { page: { path: page, url: `https://erp.intuit.com${page}` } },
  },
});

const goldenFixture = () => {
  const golden = {
    entries: [
      entry('payloads/hero.json'),
      entry('payloads/hero-repeat.json'),
      entry('payloads/hero-variant.json', { action: 'engaged' }),
      entry('payloads/chat.json', { event: 'chat:viewed', detail: 'regular/button' }),
    ],
  };
  golden.integrity = {
    payloads: golden.entries.length,
    sha256: goldenHash(golden),
    scenarioSha256: scenarioHash(golden),
  };
  return golden;
};

describe('complete golden replay manifest', () => {
  it('binds every golden payload exactly once with stable IDs and immutable hashes', () => {
    const golden = goldenFixture();
    const identityLock = createGoldenIdentityLock(golden);
    const manifest = createGoldenReplayManifest(golden, identityLock);

    expect(validateGoldenReplayManifest(manifest, golden, identityLock)).toBe(manifest);
    expect(manifest.scenarios).toHaveLength(4);
    expect(new Set(manifest.scenarios.map(({ scenarioId }) => scenarioId)).size).toBe(4);
    expect(new Set(manifest.scenarios.map(({ goldenRef }) => goldenRef.payloadFile)).size).toBe(4);
    expect(manifest.scenarios.every(({ goldenRef }) => /^sha256:[0-9a-f]{64}$/.test(goldenRef.fullPayloadSha256))).toBe(true);
    expect(manifest.manifestContentHash).toBe(manifestContentHash(manifest));
    expect(manifest.goldenMappingHash).toBe(manifestMappingHash(manifest.scenarios));
  });

  it('rejects swapped or duplicated golden references even when count and manifest hash are resealed', () => {
    const golden = goldenFixture();
    const identityLock = createGoldenIdentityLock(golden);
    const manifest = createGoldenReplayManifest(golden, identityLock);
    const first = manifest.scenarios[0].goldenRef;
    manifest.scenarios[0].goldenRef = manifest.scenarios[1].goldenRef;
    manifest.scenarios[1].goldenRef = first;
    manifest.goldenMappingHash = manifestMappingHash(manifest.scenarios);
    manifest.manifestContentHash = manifestContentHash(manifest);
    expect(() => validateGoldenReplayManifest(manifest, golden, identityLock)).toThrow(/golden reference/i);

    const duplicate = createGoldenReplayManifest(golden, identityLock);
    duplicate.scenarios[1].goldenRef = { ...duplicate.scenarios[0].goldenRef };
    duplicate.goldenMappingHash = manifestMappingHash(duplicate.scenarios);
    duplicate.manifestContentHash = manifestContentHash(duplicate);
    expect(() => validateGoldenReplayManifest(duplicate, golden, identityLock)).toThrow(/exactly once/i);
  });

  it('retains persisted scenario IDs when refreshing mutable locator evidence', () => {
    const golden = goldenFixture();
    const identityLock = createGoldenIdentityLock(golden);
    const first = createGoldenReplayManifest(golden, identityLock);
    first.scenarios[0].locator = { status: 'qualified', role: 'link', accessibleName: 'Current stage label' };
    const refreshed = createGoldenReplayManifest(golden, identityLock, { existingManifest: first });

    expect(refreshed.scenarios.map(({ scenarioId }) => scenarioId))
      .toEqual(first.scenarios.map(({ scenarioId }) => scenarioId));
    expect(refreshed.scenarios[0].locator).toMatchObject({ status: 'qualified', role: 'link' });
  });

  it('derives accordion state preconditions and retains reviewed page readiness', () => {
    const golden = goldenFixture();
    golden.entries.push(
      entry('payloads/faq-open.json', {
        detail: 'Question one', uiObject: 'accordion_item_1', uiAction: 'displayed',
      }),
      entry('payloads/faq-close.json', {
        detail: 'Question two', uiObject: 'accordion_item_2', uiAction: 'dismissed',
      }),
    );
    golden.integrity = {
      payloads: golden.entries.length,
      sha256: goldenHash(golden),
      scenarioSha256: scenarioHash(golden),
    };
    const identityLock = createGoldenIdentityLock(golden);
    const first = createGoldenReplayManifest(golden, identityLock);
    first.pages[0].readiness = { status: 'inventoried', pageCasIdPass: true };
    first.manifestContentHash = manifestContentHash(first);
    const refreshed = createGoldenReplayManifest(golden, identityLock, { existingManifest: first });

    expect(refreshed.scenarios.find(({ goldenRef }) => goldenRef.payloadFile.endsWith('faq-open.json')))
      .toMatchObject({ preconditions: { attributes: { 'aria-expanded': 'false' } } });
    expect(refreshed.scenarios.find(({ goldenRef }) => goldenRef.payloadFile.endsWith('faq-close.json')))
      .toMatchObject({ preconditions: { attributes: { 'aria-expanded': 'true' } } });
    expect(refreshed.pages[0].readiness).toEqual({ status: 'inventoried', pageCasIdPass: true });
  });

  it('keeps passive, duplicate, and variant samples in the full denominator', () => {
    const golden = goldenFixture();
    const identityLock = createGoldenIdentityLock(golden);
    const manifest = createGoldenReplayManifest(golden, identityLock);

    expect(manifest.classificationSummary).toMatchObject({ total: 4, interactive: 3, passive: 1 });
    expect(manifest.scenarios.find(({ goldenRef }) => goldenRef.payloadFile.endsWith('/chat.json')))
      .toMatchObject({ classification: { interaction: 'passive', disposition: 'passive' } });
    expect(manifest.pages).toEqual([expect.objectContaining({
      pathname: '/foo', expectedCounts: expect.objectContaining({ total: 4, interactive: 3, passive: 1 }),
    })]);
  });

  it('refuses manifest, lock, mapping, and page-accounting drift', () => {
    const golden = goldenFixture();
    const identityLock = createGoldenIdentityLock(golden);
    const mutate = [
      (manifest) => { manifest.manifestContentHash = `sha256:${'0'.repeat(64)}`; },
      (manifest) => { manifest.goldenIdentityLock.identitySha256 = '0'.repeat(64); },
      (manifest) => { manifest.goldenMappingHash = `sha256:${'1'.repeat(64)}`; },
      (manifest) => { manifest.pages[0].expectedScenarioIds.pop(); manifest.manifestContentHash = manifestContentHash(manifest); },
    ];
    mutate.forEach((change) => {
      const manifest = createGoldenReplayManifest(golden, identityLock);
      change(manifest);
      expect(() => validateGoldenReplayManifest(manifest, golden, identityLock)).toThrow();
    });
  });
});
