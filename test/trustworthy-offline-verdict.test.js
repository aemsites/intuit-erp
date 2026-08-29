import {
  describe, it, expect,
} from 'vitest';
import {
  mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  dirname, join, relative, resolve, sep,
} from 'node:path';
import { tmpdir } from 'node:os';
import * as offlineVerdict from '../scripts/diff/trustworthy-offline-verdict.mjs';
import { goldenHash } from '../scripts/diff/oracle-lib.mjs';

const { evaluateOfflineVerdict, renderOfflineVerdictHtml } = offlineVerdict;

const script = resolve('scripts/diff/trustworthy-offline-verdict.mjs');
const CAPTURED_AT = new Date().toISOString();
const sha256 = (hex) => `sha256:${hex.repeat(64)}`;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const scenarioHash = (golden) => createHash('sha256').update(golden.entries
  .map((entry) => JSON.stringify(canonical({
    aliases: Object.fromEntries(['scenarioId', 'scenario_id', 'id']
      .filter((alias) => Object.hasOwn(entry, alias)).map((alias) => [alias, entry[alias]])),
    page: entry.page,
    fullPayload: entry.fullPayload,
  }))).sort().join('\n')).digest('hex');

const globalProvenance = (overrides = {}) => ({
  capturedAt: CAPTURED_AT,
  runId: 'run-001',
  origin: 'https://stage.erp.intuit.com',
  harness: { name: 'click-tracking-parity', version: '2.0.0' },
  browser: { name: 'Chrome', version: '140.0.0', profileId: 'dedicated-stage' },
  deployedHashes: {
    'scripts.js': sha256('a'),
    'tracking.js': sha256('b'),
    'ecs-enrich.js': sha256('c'),
    'tracking.json': sha256('d'),
  },
  tealium: {
    profileUrl: 'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js',
    contentHash: sha256('e'),
  },
  trackerResources: {
    policyVersion: '1',
    resources: [
      { role: 'sender', url: 'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib.min.js', contentHash: sha256('f') },
      { role: 'delegated-loader', url: 'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib-init.min.js', contentHash: sha256('0') },
    ],
  },
  ...overrides,
});

const pageProvenance = (overrides = {}) => ({
  document: {
    responseUrl: `https://stage.erp.intuit.com${overrides.pathname || '/foo'}`,
    contentHash: sha256('1'),
  },
  interactionInventoryHash: sha256('2'),
  sameOriginScripts: [
    { url: 'https://stage.erp.intuit.com/blocks/hero/hero.js', contentHash: sha256('3') },
  ],
  readiness: { consent: 'ready', tracker: 'ready' },
  activationEvidence: { tealiumTagUids: ['123'], resources: [], vendorCalls: [] },
  ...overrides,
});

const payload = ({
  label = 'Get started', pageCasId = '/foo', page = '/foo', extra = {},
} = {}) => ({
  event: 'content:interacted',
  properties: {
    object: 'content',
    ui_object_detail: label,
    page_cas_id: pageCasId,
    ...extra,
  },
  context: {
    page: { path: page, url: `https://erp.intuit.com${page}` },
  },
});

const goldenEntry = (scenarioId, options = {}) => ({
  scenarioId,
  page: options.page || '/foo',
  event: 'content:interacted',
  fullPayload: payload({ ...options, page: options.page || '/foo', pageCasId: options.pageCasId ?? 'legacyCas123' }),
});

const capture = ({
  global = globalProvenance(), page = pageProvenance(), events = [], source = 'capture-a.json',
} = {}) => ({
  source,
  schemaVersion: 1,
  provenance: { global },
  pages: [{ pathname: '/foo', provenance: page, events }],
});

const event = (scenarioId, options = {}) => ({
  ...(scenarioId ? { scenarioId } : {}),
  payload: payload(options),
});

const withIntegrity = (golden) => ({
  ...golden,
  integrity: {
    payloads: golden.entries.length,
    sha256: goldenHash(golden),
    scenarioSha256: scenarioHash(golden),
  },
});
const identityLockFor = (golden) => offlineVerdict.createGoldenIdentityLock(golden);
const liveSourceHashes = () => Object.fromEntries([
  ['live-replay-harness.mjs', resolve('scripts/diff/live-replay-harness.mjs')],
  ['live-replay-runner.mjs', resolve('scripts/diff/live-replay-runner.mjs')],
  ['clicktrack-qualification-scenario.json', resolve('scripts/diff/fixtures/clicktrack-qualification-scenario.json')],
].map(([name, path]) => [name, `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`]));

function authenticatedCapture() {
  const replay = capture({ events: [event('hero-primary')] });
  replay.source = 'authenticated-one-page-replay';
  const sourceHashes = liveSourceHashes();
  replay.provenance.global.harness.sourceHashes = sourceHashes;
  replay.provenance.global.browser.targetId = 'target-001';
  replay.golden = { scenarioId: 'customer-workforce-faq-third-party-apps' };
  replay.pages[0].provenance.sameOriginScripts.push({
    url: 'https://stage.erp.intuit.com/blocks/faq/faq.js', contentHash: sha256('4'),
  });
  const runtimeHashes = {
    'https://stage.erp.intuit.com/scripts/scripts.js': replay.provenance.global.deployedHashes['scripts.js'],
    'https://stage.erp.intuit.com/scripts/tracking.js': replay.provenance.global.deployedHashes['tracking.js'],
    'https://stage.erp.intuit.com/scripts/ecs-enrich.js': replay.provenance.global.deployedHashes['ecs-enrich.js'],
    'https://stage.erp.intuit.com/tracking.json': replay.provenance.global.deployedHashes['tracking.json'],
    [replay.provenance.global.tealium.profileUrl]: replay.provenance.global.tealium.contentHash,
    ...Object.fromEntries(replay.provenance.global.trackerResources.resources
      .map((resource) => [resource.url, resource.contentHash])),
    ...Object.fromEntries(replay.pages[0].provenance.sameOriginScripts
      .map((resource) => [resource.url, resource.contentHash])),
  };
  replay.qualification = {
    qualifiedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    runId: replay.provenance.global.runId,
    mode: 'dedicated',
    profileId: replay.provenance.global.browser.profileId,
    chromeVersion: replay.provenance.global.browser.version,
    harnessVersion: replay.provenance.global.harness.version,
    lineagePolicyVersion: 'message-id-v1',
    origin: replay.provenance.global.origin,
    consentState: 'resolved',
    authorizationRef: 'customer-approved Adobe Migration Test',
    targetId: replay.provenance.global.browser.targetId,
    transportPolicy: 'observe',
    runtimeHashes,
    sourceHashes,
    scenarioId: replay.golden.scenarioId,
    scenarioDefinitionHash: sourceHashes['clicktrack-qualification-scenario.json'],
    disconnectCleanup: { verified: true, leaseMs: 10000, targetId: 'target-001' },
  };
  return replay;
}

function productionModulePaths() {
  const roots = [resolve('scripts'), resolve('blocks')];
  const excluded = resolve('scripts/diff');
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path !== excluded) visit(path);
      } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) paths.push(path);
    }
  };
  roots.forEach(visit);
  return paths;
}

describe('trustworthy offline verdict', () => {
  it('never promotes fallback legacy display IDs into stable matching identities', () => {
    const first = goldenEntry(undefined);
    const second = goldenEntry(undefined);
    delete first.scenarioId;
    delete second.scenarioId;
    const result = evaluateOfflineVerdict({
      golden: { entries: [first, second] },
      captures: [capture({ events: [event('legacy-1'), event('legacy-2')] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.comparisons).toHaveLength(0);
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'AMBIGUOUS_IDENTITY',
      candidates: ['legacy-1', 'legacy-2'],
    }));
  });

  it.each([
    ['numeric', { scenarioId: 0 }],
    ['null', { scenarioId: null }],
    ['blank', { scenarioId: '  ' }],
    ['contradictory aliases', { scenarioId: 'one', scenario_id: 'two' }],
  ])('refuses an unmanifested golden with %s scenario aliases', (_label, aliases) => {
    const entry = { ...goldenEntry('hero-primary'), ...aliases };
    const result = evaluateOfflineVerdict({
      golden: { entries: [entry] },
      captures: [capture({ events: [event('hero-primary')] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GOLDEN_SCENARIO_ID',
      index: 0,
    }));
  });

  it.each([
    ['numeric', { scenarioId: 0 }],
    ['null', { scenarioId: null }],
    ['blank', { scenarioId: ' ' }],
    ['contradictory aliases', { scenarioId: 'hero-primary', id: 'other' }],
  ])('refuses a captured event with %s scenario aliases', (_label, aliases) => {
    const captured = { ...event('hero-primary'), ...aliases };
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ events: [captured] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_CAPTURED_SCENARIO_ID',
      sourceEvent: 0,
    }));
  });

  it.each([
    ['numeric correlation', { correlation: { scenarioId: 0 } }],
    ['blank correlation', { correlation: { scenarioId: ' ' } }],
    ['contradictory correlation', { scenarioId: 'hero-primary', correlation: { scenarioId: 'other' } }],
  ])('refuses a captured event with %s', (_label, aliases) => {
    const captured = { payload: payload(), ...aliases };
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ events: [captured] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_CAPTURED_SCENARIO_ID',
      sourceEvent: 0,
    }));
  });

  it('accepts a captured correlation scenarioId when it agrees with top-level aliases', () => {
    const captured = { ...event('hero-primary'), correlation: { scenarioId: 'hero-primary' } };
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ events: [captured] })],
    });
    expect(result.verdict).toBe('PASS');
  });

  it('refuses a legacy semantic-key collision and names every candidate', () => {
    const golden = { entries: [goldenEntry('hero-primary'), goldenEntry('footer-primary')] };
    const result = evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event(null), event(null)] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'AMBIGUOUS_IDENTITY',
      candidates: ['hero-primary', 'footer-primary'],
    }));
    expect(result.comparisons).toHaveLength(0);
  });

  it('refuses missing and mixed global provenance instead of publishing a current score', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const missing = evaluateOfflineVerdict({
      golden,
      captures: [capture({ global: { runId: 'run-001' }, events: [event('hero-primary')] })],
    });
    expect(missing.verdict).toBe('REFUSED');
    expect(missing.currentParityEligible).toBe(false);
    expect(missing.refusals.some((item) => item.code === 'MISSING_GLOBAL_PROVENANCE')).toBe(true);

    const mixed = evaluateOfflineVerdict({
      golden,
      captures: [
        capture({ source: 'capture-a.json', events: [event('hero-primary')] }),
        capture({
          source: 'capture-b.json',
          global: globalProvenance({ runId: 'run-002' }),
          events: [],
        }),
      ],
    });
    expect(mixed.verdict).toBe('REFUSED');
    expect(mixed.refusals).toContainEqual(expect.objectContaining({ code: 'MIXED_GLOBAL_PROVENANCE' }));
    expect(mixed.score).toBeNull();
  });

  it.each([
    ['deployed hash map', { global: globalProvenance({ deployedHashes: [] }) }, 'deployedHashes'],
    ['critical-resource collection', { global: globalProvenance({ trackerResources: { policyVersion: '1', resources: {} } }) }, 'trackerResources.resources'],
    ['critical-resource entry', { global: globalProvenance({ trackerResources: { policyVersion: '1', resources: [[], { role: 'delegated-loader', url: 'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib-init.min.js', contentHash: sha256('0') }] } }) }, 'trackerResources.resources[0]'],
  ])('rejects malformed global provenance: %s', (_label, fixture, invalidPath) => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ ...fixture, events: [event('hero-primary')] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining([invalidPath]),
    }));
  });

  it('requires tracker policy v1 and both exact Intuit CDN resource families', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const wrongVersion = evaluateOfflineVerdict({
      golden,
      captures: [capture({
        global: globalProvenance({
          trackerResources: { ...globalProvenance().trackerResources, policyVersion: '2' },
        }),
        events: [event('hero-primary')],
      })],
    });
    expect(wrongVersion.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining(['trackerResources.policyVersion']),
    }));

    const arbitraryResources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    arbitraryResources[0].url = 'https://cdn.example/analytics/prod/track-event-lib.min.js';
    arbitraryResources[1] = {
      role: 'delegated-loader',
      url: 'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js',
      contentHash: sha256('4'),
    };
    const missingFamilies = evaluateOfflineVerdict({
      golden,
      captures: [capture({
        global: globalProvenance({ trackerResources: { policyVersion: '1', resources: arbitraryResources } }),
        events: [event('hero-primary')],
      })],
    });
    expect(missingFamilies.verdict).toBe('REFUSED');
    expect(missingFamilies.refusals).toContainEqual(expect.objectContaining({
      code: 'MISSING_GLOBAL_PROVENANCE',
      missing: expect.arrayContaining([
        'trackerResources.resources[sender-v1]',
        'trackerResources.resources[delegated-loader-v1]',
      ]),
    }));
  });

  it('rejects duplicate tracker resource identities even when hashes disagree', () => {
    const resources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    resources.push({ ...resources[0], contentHash: sha256('9') });
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ trackerResources: { policyVersion: '1', resources } }),
        events: [event('hero-primary')],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining(['trackerResources.resources[2]']),
    }));
  });

  it('rejects a tracker URL repeated under a contradictory role', () => {
    const resources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    resources.push({ ...resources[0], role: 'delegated-loader' });
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ trackerResources: { policyVersion: '1', resources } }),
        events: [event('hero-primary')],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining(['trackerResources.resources[2]']),
    }));
  });

  it('rejects whitespace identities, non-canonical hashes, and non-UTC timestamps', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const resources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    resources[0].contentHash = 'sha256:short';
    const badGlobal = globalProvenance({
      capturedAt: '2026-08-29T12:00:00',
      runId: '   ',
      deployedHashes: {
        ...globalProvenance().deployedHashes,
        'scripts.js': `sha256:${'A'.repeat(64)}`,
      },
      tealium: {
        ...globalProvenance().tealium,
        contentHash: 'sha256:short',
      },
      trackerResources: { policyVersion: '1', resources },
    });
    const globalResult = evaluateOfflineVerdict({
      golden,
      captures: [capture({ global: badGlobal, events: [event('hero-primary')] })],
    });
    expect(globalResult.verdict).toBe('REFUSED');
    expect(globalResult.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining([
        'capturedAt',
        'deployedHashes.scripts.js',
        'tealium.contentHash',
        'trackerResources.resources[0].contentHash',
      ]),
    }));
    expect(globalResult.refusals).toContainEqual(expect.objectContaining({
      code: 'MISSING_GLOBAL_PROVENANCE',
      missing: expect.arrayContaining(['runId']),
    }));

    const badPage = pageProvenance({
      document: { responseUrl: 'https://stage.erp.intuit.com/foo', contentHash: '   ' },
      interactionInventoryHash: 'sha256:short',
      sameOriginScripts: [{
        url: 'https://stage.erp.intuit.com/hero.js',
        contentHash: `sha256:${'F'.repeat(64)}`,
      }],
    });
    const pageResult = evaluateOfflineVerdict({
      golden,
      captures: [capture({ page: badPage, events: [event('hero-primary')] })],
    });
    expect(pageResult.verdict).toBe('REFUSED');
    expect(pageResult.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_PAGE_PROVENANCE',
      invalid: expect.arrayContaining([
        'interactionInventoryHash',
        'sameOriginScripts[0].contentHash',
      ]),
    }));
    expect(pageResult.refusals).toContainEqual(expect.objectContaining({
      code: 'MISSING_PAGE_PROVENANCE',
      missing: expect.arrayContaining(['document.contentHash']),
    }));
  });

  it('rejects calendar-invalid RFC3339 timestamps even when Date.parse normalizes them', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ capturedAt: '2026-02-30T12:00:00Z' }),
        events: [event('hero-primary')],
      })],
    });
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining(['capturedAt']),
    }));
  });

  it.each(['.1', '.12', '.1234', '.123456789'])('accepts valid RFC3339 UTC timestamps with %s fractional seconds', (fraction) => {
    const capturedAt = `2026-08-29T12:34:56${fraction}Z`;
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ global: globalProvenance({ capturedAt }), events: [event('hero-primary')] })],
      clock: () => new Date('2026-08-29T12:34:56.500Z'),
    });

    expect(result.verdict).toBe('PASS');
  });

  it.each([
    'http://stage.erp.intuit.com',
    'https://user@stage.erp.intuit.com',
    'https://stage.erp.intuit.com:444',
    'https://stage.erp.intuit.com/path',
    'https://stage.erp.intuit.com/?query=1',
    'https://stage.erp.intuit.com/#fragment',
  ])('rejects a non-canonical global origin: %s', (origin) => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ origin }),
        events: [event('hero-primary')],
      })],
    });
    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining(['origin']),
    }));
  });

  it('rejects credentials and nondefault ports on critical tracker resources', () => {
    const resources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    resources[0].url = 'https://user@uxfabric.intuitcdn.net/analytics/prod/track-event-lib.min.js';
    resources[1].url = 'https://uxfabric.intuitcdn.net:444/analytics/prod/track-event-lib-init.min.js';
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ trackerResources: { policyVersion: '1', resources } }),
        events: [event('hero-primary')],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining([
        'trackerResources.resources[0].url',
        'trackerResources.resources[1].url',
      ]),
    }));
  });

  it('rejects query strings and fragments on critical tracker resources', () => {
    const resources = globalProvenance().trackerResources.resources.map((resource) => ({ ...resource }));
    resources[0].url += '?cache=1';
    resources[1].url += '#fragment';
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        global: globalProvenance({ trackerResources: { policyVersion: '1', resources } }),
        events: [event('hero-primary')],
      })],
    });
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_GLOBAL_PROVENANCE',
      invalid: expect.arrayContaining([
        'trackerResources.resources[0].url',
        'trackerResources.resources[1].url',
      ]),
    }));
  });

  it.each([
    ['document', { document: [] }, 'document'],
    ['same-origin scripts collection', { sameOriginScripts: {} }, 'sameOriginScripts'],
    ['same-origin script entry', { sameOriginScripts: [[]] }, 'sameOriginScripts[0]'],
    ['readiness', { readiness: [] }, 'readiness'],
    ['activation evidence', { activationEvidence: [] }, 'activationEvidence'],
    ['activation collections', { activationEvidence: { tealiumTagUids: {}, resources: {}, vendorCalls: {} } }, 'activationEvidence.tealiumTagUids'],
  ])('rejects malformed page provenance: %s', (_label, overrides, invalidPath) => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        page: pageProvenance(overrides),
        events: [event('hero-primary')],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_PAGE_PROVENANCE',
      invalid: expect.arrayContaining([invalidPath]),
    }));
  });

  it('rejects duplicate same-origin script URLs with conflicting hashes', () => {
    const repeatedUrl = 'https://stage.erp.intuit.com/blocks/hero/hero.js';
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        page: pageProvenance({ sameOriginScripts: [
          { url: repeatedUrl, contentHash: sha256('3') },
          { url: repeatedUrl, contentHash: sha256('4') },
        ] }),
        events: [event('hero-primary')],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_PAGE_PROVENANCE',
      invalid: expect.arrayContaining(['sameOriginScripts[1]']),
    }));
  });

  it('requires per-page provenance, retains activation evidence, and permits distinct pages to differ', () => {
    const golden = {
      entries: [
        goldenEntry('hero-primary'),
        goldenEntry('learn-primary', { page: '/bar', label: 'Learn more' }),
      ],
    };
    const missing = evaluateOfflineVerdict({
      golden: { entries: [golden.entries[0]] },
      captures: [capture({ page: {}, events: [event('hero-primary')] })],
    });
    expect(missing.verdict).toBe('REFUSED');
    expect(missing.refusals).toContainEqual(expect.objectContaining({ code: 'MISSING_PAGE_PROVENANCE' }));

    const foo = pageProvenance();
    const bar = pageProvenance({
      pathname: '/bar',
      interactionInventoryHash: sha256('5'),
      sameOriginScripts: [{ url: 'https://stage.erp.intuit.com/blocks/cards/cards.js', contentHash: sha256('6') }],
      activationEvidence: { tealiumTagUids: ['456'], resources: ['sampled-tag'], vendorCalls: ['sampled-vendor'] },
    });
    const clean = evaluateOfflineVerdict({
      golden,
      captures: [
        {
          source: 'two-pages.json',
          provenance: { global: globalProvenance() },
          pages: [
            { pathname: '/foo', provenance: foo, events: [event('hero-primary')] },
            { pathname: '/bar', provenance: bar, events: [event('learn-primary', { label: 'Learn more', pageCasId: '/bar' })] },
          ],
        },
        capture({
          source: 'sampled-activation.json',
          page: pageProvenance({
            activationEvidence: { tealiumTagUids: ['999'], resources: ['other-sampled-tag'], vendorCalls: [] },
          }),
          events: [],
        }),
      ],
    });
    expect(clean.verdict).toBe('PASS');
    expect(clean.provenance.pages).toContainEqual(expect.objectContaining({
      pathname: '/bar',
      activationEvidence: bar.activationEvidence,
    }));
  });

  it('rejects unequal same-page fingerprints, while comparison mode stays mixed and cannot pass', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const captures = [
      capture({ source: 'capture-a.json', events: [event('hero-primary')] }),
      capture({
        source: 'capture-b.json',
        page: pageProvenance({ interactionInventoryHash: sha256('7') }),
        events: [],
      }),
    ];

    const current = evaluateOfflineVerdict({ golden, captures });
    expect(current.verdict).toBe('REFUSED');
    expect(current.refusals).toContainEqual(expect.objectContaining({ code: 'SAME_PAGE_FINGERPRINT_MISMATCH' }));

    const comparison = evaluateOfflineVerdict({ golden, captures, mode: 'comparison' });
    expect(comparison.verdict).toBe('MIXED');
    expect(comparison.provenance.label).toBe('mixed/stale');
    expect(comparison.currentParityEligible).toBe(false);
  });

  it('refuses captures older than 24 hours or materially in the future using an injectable clock', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const clock = () => new Date('2026-08-29T12:00:00.000Z');
    const staleCapture = capture({
      global: globalProvenance({ capturedAt: '2026-08-28T11:59:59.000Z' }),
      events: [event('hero-primary')],
    });
    const stale = evaluateOfflineVerdict({ golden, captures: [staleCapture], clock });
    expect(stale.verdict).toBe('REFUSED');
    expect(stale.refusals).toContainEqual(expect.objectContaining({ code: 'STALE_CAPTURE' }));

    const comparison = evaluateOfflineVerdict({
      golden, captures: [staleCapture], clock, mode: 'comparison',
    });
    expect(comparison).toMatchObject({ verdict: 'MIXED', currentParityEligible: false });
    expect(comparison.provenance.issues).toContainEqual(expect.objectContaining({ code: 'STALE_CAPTURE' }));

    const future = evaluateOfflineVerdict({
      golden,
      captures: [capture({
        global: globalProvenance({ capturedAt: '2026-08-29T12:05:01.000Z' }),
        events: [event('hero-primary')],
      })],
      clock,
    });
    expect(future.verdict).toBe('REFUSED');
    expect(future.refusals).toContainEqual(expect.objectContaining({ code: 'FUTURE_CAPTURE' }));
  });

  it('binds global, document, and same-origin script URLs to stage and the captured pathname', () => {
    const golden = { entries: [goldenEntry('hero-primary')] };
    const wrongGlobal = evaluateOfflineVerdict({
      golden,
      captures: [capture({
        global: globalProvenance({ origin: 'https://evil.example' }),
        events: [event('hero-primary')],
      })],
    });
    expect(wrongGlobal.refusals).toContainEqual(expect.objectContaining({ code: 'UNEXPECTED_CAPTURE_ORIGIN' }));

    const wrongPage = evaluateOfflineVerdict({
      golden,
      captures: [capture({
        page: pageProvenance({
          document: { responseUrl: 'https://evil.example/not-foo', contentHash: sha256('1') },
          sameOriginScripts: [{ url: 'https://cdn.example/hero.js', contentHash: sha256('3') }],
        }),
        events: [event('hero-primary')],
      })],
    });
    expect(wrongPage.refusals.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'DOCUMENT_URL_MISMATCH',
      'SAME_ORIGIN_SCRIPT_MISMATCH',
    ]));

    const explicit = evaluateOfflineVerdict({
      golden,
      expectedOrigin: 'https://alternate.stage.example',
      captures: [capture({
        global: globalProvenance({ origin: 'https://alternate.stage.example' }),
        page: pageProvenance({
          document: { responseUrl: 'https://alternate.stage.example/foo', contentHash: sha256('1') },
          sameOriginScripts: [{ url: 'https://alternate.stage.example/hero.js', contentHash: sha256('3') }],
        }),
        events: [event('hero-primary')],
      })],
    });
    expect(explicit.verdict).toBe('PASS');
  });

  it('rejects non-canonical document and same-origin script URLs', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        page: pageProvenance({
          document: {
            responseUrl: 'https://user@stage.erp.intuit.com:444/foo?query=1#fragment',
            contentHash: sha256('1'),
          },
          sameOriginScripts: [{
            url: 'https://user@stage.erp.intuit.com:444/hero.js?query=1#fragment',
            contentHash: sha256('3'),
          }],
        }),
        events: [event('hero-primary')],
      })],
    });
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_PAGE_PROVENANCE',
      invalid: expect.arrayContaining([
        'document.responseUrl',
        'sameOriginScripts[0].url',
      ]),
    }));
  });

  it.each([
    ['document percent encoding', { document: { responseUrl: 'https://stage.erp.intuit.com/fo%6f', contentHash: sha256('1') } }, 'document.responseUrl'],
    ['script encoded slash', { sameOriginScripts: [{ url: 'https://stage.erp.intuit.com/foo%2fbar.js', contentHash: sha256('3') }] }, 'sameOriginScripts[0].url'],
    ['script redundant slash', { sameOriginScripts: [{ url: 'https://stage.erp.intuit.com//foo.js', contentHash: sha256('3') }] }, 'sameOriginScripts[0].url'],
  ])('rejects non-canonical URL paths: %s', (_label, overrides, invalidPath) => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ page: pageProvenance(overrides), events: [event('hero-primary')] })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'INVALID_PAGE_PROVENANCE',
      invalid: expect.arrayContaining([invalidPath]),
    }));
  });

  it('refuses an isolated document pathname mismatch on the correct stage origin', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        page: pageProvenance({
          document: { responseUrl: 'https://stage.erp.intuit.com/not-foo', contentHash: sha256('1') },
        }),
        events: [event('hero-primary')],
      })],
    });
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'DOCUMENT_URL_MISMATCH',
      pathname: '/foo',
      responseUrl: 'https://stage.erp.intuit.com/not-foo',
    }));
    expect(result.refusals.map(({ code }) => code)).not.toContain('UNEXPECTED_CAPTURE_ORIGIN');
  });

  it('preserves raw production, pathname policy, and actual stage page_cas_id independently', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({ events: [event('hero-primary')] })],
    });
    const field = result.comparisons[0].fields.find((item) => item.path === 'properties.page_cas_id');

    expect(field).toMatchObject({
      rawProduction: 'legacyCas123',
      policyExpectation: '/foo',
      actualStage: '/foo',
      rawEqual: false,
      policyEqual: true,
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
    ['boolean false for a string', false],
    ['number for a string', 1],
    ['populated array for a string', ['wrong-shape']],
    ['populated object for a string', { wrong: true }],
  ])('hard-fails a frozen presence field whose actual value is %s', (_label, actualValue) => {
    const extra = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`exact_${index}`, `value_${index}`]));
    const golden = goldenEntry('hero-primary', { extra });
    golden.fullPayload.messageId = 'production-message-id';
    const captured = event('hero-primary', { extra });
    captured.payload.messageId = actualValue;

    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });
    const field = result.comparisons[0].fields.find((item) => item.path === 'envelope.messageId');

    expect(result.score).toBeGreaterThan(95);
    expect(field.policyEqual).toBe(false);
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 1 });
    expect(result.verdict).toBe('FAIL');
  });

  it('accepts privacy-safe shape tokens for frozen presence fields', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.messageId = 'production-message-id';
    golden.fullPayload.properties.page_track_seq_num = 7;
    golden.fullPayload.context = { userAgentData: { brands: ['Chrome'] } };
    golden.fullPayload.integrations = { 'Adobe Analytics': { marketingCloudVisitorId: 'prod-id' } };
    const captured = event('hero-primary');
    captured.payload.messageId = 'STR:41';
    captured.payload.properties.page_track_seq_num = 'NUM';
    captured.payload.context = { userAgentData: { brands: ['STR:6'] } };
    captured.payload.integrations = { 'Adobe Analytics': { marketingCloudVisitorId: 'STR:36' } };

    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });

    expect(result.gates.presence).toMatchObject({ pass: true, failed: 0 });
  });

  it('rejects opaque object tokens that hide frozen nested shape', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.context = { userAgentData: { brands: ['Chrome'] } };
    const captured = event('hero-primary');
    captured.payload.context = { userAgentData: 'OBJ' };
    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] }, captures: [capture({ events: [captured] })],
    });
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 1 });
  });

  it('refuses authenticated replay evidence when its qualification binding is missing', () => {
    const replay = capture({ events: [event('hero-primary')] });
    replay.source = 'authenticated-one-page-replay';
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] }, captures: [replay],
    });
    expect(result.refusals).toContainEqual(expect.objectContaining({ code: 'INVALID_QUALIFICATION' }));
    expect(result.verdict).toBe('REFUSED');
  });

  it('accepts a fully bound authenticated replay qualification', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] }, captures: [authenticatedCapture()],
    });
    expect(result.refusals).toEqual([]);
  });

  it('refuses changed source, exact runtime URL, cleanup lease, or independent target bindings', () => {
    const mutations = [
      (replay) => { replay.qualification.sourceHashes['live-replay-harness.mjs'] = sha256('9'); },
      (replay) => { delete replay.qualification.runtimeHashes['https://stage.erp.intuit.com/blocks/hero/hero.js']; },
      (replay) => { replay.qualification.runtimeHashes['https://stage.erp.intuit.com/unobserved.js'] = sha256('8'); },
      (replay) => {
        delete replay.qualification.runtimeHashes['https://stage.erp.intuit.com/blocks/faq/faq.js'];
        replay.pages[0].provenance.sameOriginScripts = replay.pages[0].provenance.sameOriginScripts
          .filter(({ url }) => !url.endsWith('/blocks/faq/faq.js'));
      },
      (replay) => { replay.qualification.disconnectCleanup.leaseMs = 10001; },
      (replay) => { replay.provenance.global.browser.targetId = 'replacement-target'; },
    ];
    mutations.forEach((mutate) => {
      const replay = authenticatedCapture();
      mutate(replay);
      const result = evaluateOfflineVerdict({
        golden: { entries: [goldenEntry('hero-primary')] }, captures: [replay],
      });
      expect(result.refusals).toContainEqual(expect.objectContaining({ code: 'INVALID_QUALIFICATION' }));
    });
  });

  it('requires arrays and objects in frozen presence fields to retain their broad golden shape', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.properties.browser_plugins = ['PDF Viewer'];
    golden.fullPayload.context = { userAgentData: { brands: ['Chrome'] } };
    const captured = event('hero-primary');
    captured.payload.properties.browser_plugins = { unexpected: true };
    captured.payload.context = { userAgentData: ['wrong-shape'] };

    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 2 });
    expect(result.verdict).toBe('FAIL');
  });

  it('recursively validates nested integration objects and typed string arrays', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.integrations = {
      'Adobe Analytics': { visitor: { id: 'prod-id', region: 1 } },
    };
    golden.fullPayload.properties.browser_plugins = ['PDF Viewer'];
    const captured = event('hero-primary');
    captured.payload.integrations = {
      'Adobe Analytics': { visitor: { id: 'stage-id', region: 'wrong-type' } },
    };
    captured.payload.properties.browser_plugins = [{ name: 'PDF Viewer' }];

    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });

    expect(result.gates.presence).toMatchObject({ pass: false, failed: 2 });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PRESENCE_GATE', field: 'integrations.Adobe Analytics' }),
      expect.objectContaining({ code: 'PRESENCE_GATE', field: 'properties.browser_plugins' }),
    ]));
  });

  it('rejects an empty nested array when the golden supplies typed elements', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.context.page.browser = { brands: ['Chrome'] };
    const captured = event('hero-primary');
    captured.payload.context.page.browser = { brands: [] };

    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 1 });
  });

  it.each([
    ['null', null],
    ['blank string', '  '],
    ['empty array', []],
    ['empty object', {}],
  ])('rejects recursively unpopulated nested presence value: %s', (_label, nestedValue) => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.integrations = {
      'Adobe Analytics': { visitor: { detail: 'production' } },
    };
    const captured = event('hero-primary');
    captured.payload.integrations = {
      'Adobe Analytics': { visitor: { detail: nestedValue } },
    };
    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 1 });
  });

  it('requires actual nested containers to be populated even when the golden exemplar is empty', () => {
    const golden = goldenEntry('hero-primary');
    golden.fullPayload.integrations = { 'Adobe Analytics': { metadata: {} } };
    const captured = event('hero-primary');
    captured.payload.integrations = { 'Adobe Analytics': { metadata: {} } };
    const result = evaluateOfflineVerdict({
      golden: { entries: [golden] },
      captures: [capture({ events: [captured] })],
    });
    expect(result.gates.presence).toMatchObject({ pass: false, failed: 1 });
  });

  it('fails the hard pathname gate even when aggregate policy parity exceeds the threshold', () => {
    const manyCorrectFields = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field_${i}`, `value_${i}`]));
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary', { extra: manyCorrectFields })] },
      captures: [capture({ events: [event('hero-primary', { pageCasId: '/wrong', extra: manyCorrectFields })] })],
    });

    expect(result.score).toBeGreaterThan(95);
    expect(result.gates.pageCasId).toMatchObject({ pass: false, checked: 1, failed: 1 });
    expect(result.verdict).toBe('FAIL');
  });

  it('refuses an uncorrelated captured click so an unmatched extra cannot bypass page_cas_id', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary')] },
      captures: [capture({
        events: [
          event('hero-primary'),
          event('not-in-golden', { label: 'Unexpected', pageCasId: '/wrong' }),
        ],
      })],
    });

    expect(result.verdict).toBe('REFUSED');
    expect(result.score).toBeNull();
    expect(result.refusals).toContainEqual(expect.objectContaining({
      code: 'UNCORRELATED_CAPTURED_CLICK',
      scenarioId: 'not-in-golden',
      sourceCapture: 'capture-a.json',
    }));
  });

  it('refuses an empty golden instead of producing a vacuous pass', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [] },
      captures: [capture()],
    });

    expect(result).toMatchObject({ verdict: 'REFUSED', score: null, coverage: null });
    expect(result.refusals).toContainEqual(expect.objectContaining({ code: 'EMPTY_GOLDEN' }));
  });

  it('enforces an existing golden integrity manifest at the evaluator boundary', () => {
    const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    golden.entries[0].fullPayload.properties.ui_object_detail = 'tampered after manifest';

    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
    })).toThrow(/golden integrity/i);
  });

  it('binds manifested golden entry pages to immutable payload page path and URL pathname', () => {
    const mismatched = goldenEntry('hero-primary');
    mismatched.page = '/swapped';
    const golden = withIntegrity({ entries: [mismatched] });

    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
    })).toThrow(/golden integrity.*page identity/i);
  });

  it('requires and verifies extended identity integrity for manifested stable IDs', () => {
    const original = { entries: [goldenEntry('hero-primary')] };
    const missingDigest = {
      ...original,
      integrity: { payloads: 1, sha256: goldenHash(original) },
    };
    expect(() => evaluateOfflineVerdict({
      golden: missingDigest,
      captures: [capture({ events: [event('hero-primary')] })],
    })).toThrow(/scenarioSha256/i);

    const tampered = withIntegrity(original);
    tampered.entries[0].scenarioId = 'swapped-id';
    expect(() => evaluateOfflineVerdict({
      golden: tampered,
      captures: [capture({ events: [event('swapped-id')] })],
    })).toThrow(/golden integrity.*scenario identity/i);
  });

  it('verifies a present scenario digest even after the sole ID alias is deleted or blanked', () => {
    const deleted = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    delete deleted.entries[0].scenarioId;
    expect(() => evaluateOfflineVerdict({
      golden: deleted,
      captures: [capture({ events: [event(null)] })],
    })).toThrow(/golden integrity.*scenario identity/i);

    const blanked = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    blanked.entries[0].scenarioId = ' ';
    expect(() => evaluateOfflineVerdict({
      golden: blanked,
      captures: [capture({ events: [event(null)] })],
    })).toThrow(/golden integrity.*scenario identity/i);
  });

  it('rejects invalid or contradictory scenario aliases in a manifested golden', () => {
    const entry = { ...goldenEntry('hero-primary'), id: 'contradiction' };
    const golden = withIntegrity({ entries: [entry] });
    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
    })).toThrow(/golden integrity.*scenario alias/i);
  });

  it('creates and verifies a separately supplied golden identity lock', () => {
    const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    const identityLock = identityLockFor(golden);
    expect(identityLock).toMatchObject({
      version: 1,
      payloadManifest: { payloads: 1, sha256: golden.integrity.sha256 },
      identitySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
      requireIntegrity: true,
      identityLock,
    }).verdict).toBe('PASS');
  });

  it('requires a valid external identity lock for integrity-enforced evaluation', () => {
    const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
      requireIntegrity: true,
    })).toThrow(/identity lock/i);
    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event('hero-primary')] })],
      requireIntegrity: true,
      identityLock: { ...identityLockFor(golden), version: 2 },
    })).toThrow(/identity lock.*version/i);
  });

  it('rejects identity downgrade even when both the scenario ID and embedded digest are deleted', () => {
    const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
    const identityLock = identityLockFor(golden);
    delete golden.entries[0].scenarioId;
    delete golden.integrity.scenarioSha256;
    expect(() => evaluateOfflineVerdict({
      golden,
      captures: [capture({ events: [event(null)] })],
      requireIntegrity: true,
      identityLock,
    })).toThrow(/identity lock.*identity/i);
  });

  it('rejects contradictory correlation identity in a manifested golden', () => {
    const entry = { ...goldenEntry('hero-primary'), correlation: { scenarioId: 'other' } };
    const golden = withIntegrity({ entries: [entry] });
    expect(() => identityLockFor(golden)).toThrow(/scenario alias/i);
  });

  it('renders actionable refusal details, ambiguity candidates, and plural source links', () => {
    const badGlobal = globalProvenance({
      tealium: { profileUrl: 'https://tags.tiqcdn.com/utag/intuit/erp/prod/utag.js' },
    });
    const blockedPage = pageProvenance({ readiness: { consent: 'blocked', tracker: 'ready' } });
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary'), goldenEntry('footer-primary')] },
      captures: [
        capture({ source: '/tmp/capture-a.json', global: badGlobal, page: blockedPage, events: [event(null)] }),
        capture({ source: 'file:///tmp/capture-b.json', page: blockedPage, events: [event(null)] }),
      ],
    });
    const html = renderOfflineVerdictHtml(result);

    expect(html).toContain('/foo');
    expect(html).toContain('tealium.contentHash');
    expect(html).toContain('consent=blocked');
    expect(html).toContain('hero-primary');
    expect(html).toContain('footer-primary');
    expect(html).toContain('<a href="file:///tmp/capture-a.json">/tmp/capture-a.json</a>');
    expect(html).toContain('<a href="file:///tmp/capture-b.json">file:///tmp/capture-b.json</a>');
  });

  it('renders unsafe source schemes as text without creating executable links', () => {
    const result = evaluateOfflineVerdict({
      golden: { entries: [goldenEntry('hero-primary'), goldenEntry('footer-primary')] },
      captures: [
        capture({ source: 'javascript:alert(1)', events: [event(null)] }),
        capture({ source: 'data:text/html,bad', events: [event(null)] }),
      ],
    });
    const html = renderOfflineVerdictHtml(result);

    expect(html).toContain('javascript:alert(1)');
    expect(html).toContain('data:text/html,bad');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    const mixedLinks = renderOfflineVerdictHtml({
      ...result,
      failures: [{ code: 'TEST', sourceCaptures: ['vbscript:msgbox(1)', 'file://remote.example/capture.json', 'https://safe.example/capture.json'] }],
    });
    expect(mixedLinks).toContain('<a href="https://safe.example/capture.json">https://safe.example/capture.json</a>');
    expect(mixedLinks).not.toContain('href="file://remote.example');

    const localLookalikes = renderOfflineVerdictHtml({
      ...result,
      failures: [{ code: 'TEST', sourceCaptures: ['//evil.example/capture.json', '/\\evil.example/capture.json', '/tmp/safe capture.json'] }],
    });
    expect(localLookalikes).not.toContain('href="//evil.example');
    expect(localLookalikes).not.toContain('href="/\\evil.example');
    expect(localLookalikes).toContain('<a href="file:///tmp/safe%20capture.json">/tmp/safe capture.json</a>');
  });

  it('regresses the sanitized mixed-era collision defect shape without customer payload data', () => {
    const golden = {
      entries: [goldenEntry('repeated-label-header'), goldenEntry('repeated-label-footer')],
    };
    const mixedEra = [
      capture({ source: 'era-one.json', events: [event(null)] }),
      capture({
        source: 'era-two.json',
        global: globalProvenance({ runId: 'run-older' }),
        page: pageProvenance({ document: { responseUrl: 'https://stage.erp.intuit.com/foo', contentHash: sha256('8') } }),
        events: [event(null)],
      }),
    ];

    const result = evaluateOfflineVerdict({ golden, captures: mixedEra });
    expect(result.verdict).toBe('REFUSED');
    expect(result.score).toBeNull();
    expect(result.refusals.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'MIXED_GLOBAL_PROVENANCE',
      'SAME_PAGE_FINGERPRINT_MISMATCH',
      'AMBIGUOUS_IDENTITY',
    ]));
  });

  it('writes machine-readable and HTML reports linking scenarios to source captures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offline-verdict-'));
    const goldenPath = join(dir, 'golden.json');
    const capturePath = join(dir, 'capture.json');
    const jsonPath = join(dir, 'verdict.json');
    const htmlPath = join(dir, 'verdict.html');
    const lockPath = join(dir, 'identity-lock.json');
    try {
      const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
      writeFileSync(goldenPath, JSON.stringify(golden));
      writeFileSync(lockPath, JSON.stringify(identityLockFor(golden)));
      writeFileSync(capturePath, JSON.stringify(capture({ source: undefined, events: [event('hero-primary')] })));

      execFileSync(process.execPath, [script,
        '--golden', goldenPath,
        '--identity-lock', lockPath,
        '--capture', capturePath,
        '--json-out', jsonPath,
        '--html-out', htmlPath,
      ]);

      const machine = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const html = readFileSync(htmlPath, 'utf8');
      expect(machine.verdict).toBe('PASS');
      expect(machine.comparisons[0]).toMatchObject({
        scenarioId: 'hero-primary',
        sourceCapture: capturePath,
      });
      expect(html).toContain('hero-primary');
      expect(html).toContain(capturePath);
      expect(html).toContain('Raw production');
      expect(html).toContain('Policy expectation');
      expect(html).toContain('Actual stage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires a golden integrity manifest at the CLI boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offline-verdict-integrity-'));
    try {
      const goldenPath = join(dir, 'golden.json');
      const capturePath = join(dir, 'capture.json');
      const lockPath = join(dir, 'identity-lock.json');
      const rawGolden = { entries: [goldenEntry('hero-primary')] };
      const trustedGolden = withIntegrity(rawGolden);
      writeFileSync(goldenPath, JSON.stringify(rawGolden));
      writeFileSync(lockPath, JSON.stringify(identityLockFor(trustedGolden)));
      writeFileSync(capturePath, JSON.stringify(capture({ events: [event('hero-primary')] })));

      const run = spawnSync(process.execPath, [script, '--golden', goldenPath, '--identity-lock', lockPath, '--capture', capturePath], { encoding: 'utf8' });
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/integrity manifest/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires --identity-lock for CLI current and comparison runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offline-verdict-lock-required-'));
    try {
      const goldenPath = join(dir, 'golden.json');
      const capturePath = join(dir, 'capture.json');
      writeFileSync(goldenPath, JSON.stringify(withIntegrity({ entries: [goldenEntry('hero-primary')] })));
      writeFileSync(capturePath, JSON.stringify(capture({ events: [event('hero-primary')] })));
      for (const extra of [[], ['--comparison']]) {
        const run = spawnSync(process.execPath, [script, '--golden', goldenPath, '--capture', capturePath, ...extra], { encoding: 'utf8' });
        expect(run.status).toBe(2);
        expect(run.stderr).toMatch(/--identity-lock is required/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strips terminal control bytes from CLI errors and printed output paths', () => {
    const badArg = spawnSync(process.execPath, [script, '--bad\u001b[31m\u202e\u061chidden'], { encoding: 'utf8' });
    expect(badArg.status).toBe(2);
    expect(badArg.stderr).not.toContain('\u001b');
    expect(badArg.stderr).not.toContain('\u202e');
    expect(badArg.stderr).not.toContain('\u061c');
    expect(badArg.stderr).toContain('--bad?[31m??hidden');

    const dir = mkdtempSync(join(tmpdir(), 'offline-verdict-terminal-'));
    try {
      const goldenPath = join(dir, 'golden.json');
      const capturePath = join(dir, 'capture.json');
      const jsonPath = join(dir, 'verdict-\u001b[31m\u200e.json');
      const htmlPath = join(dir, 'verdict-\u0085\u2066.html');
      const lockPath = join(dir, 'identity-lock.json');
      const golden = withIntegrity({ entries: [goldenEntry('hero-primary')] });
      writeFileSync(goldenPath, JSON.stringify(golden));
      writeFileSync(lockPath, JSON.stringify(identityLockFor(golden)));
      writeFileSync(capturePath, JSON.stringify(capture({ events: [event('hero-primary')] })));

      const run = spawnSync(process.execPath, [script,
        '--golden', goldenPath,
        '--identity-lock', lockPath,
        '--capture', capturePath,
        '--json-out', jsonPath,
        '--html-out', htmlPath,
      ], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
      expect(run.stdout).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
      expect(run.stdout).toContain('verdict-?[31m?.json');
      expect(run.stdout).toContain('verdict-??.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the Node-only diff harness out of production-delivered modules', () => {
    const diffRoot = resolve('scripts/diff');
    const harnessModule = 'trustworthy-offline-verdict.mjs';
    const violations = [];
    for (const path of productionModulePaths()) {
      const source = readFileSync(path, 'utf8');
      const specifiers = new Set([
        ...[...source.matchAll(/\b(?:import|export)\s+(?:[^'\"]*?\sfrom\s*)['\"]([^'\"]+)['\"]/g)].map((match) => match[1]),
        ...[...source.matchAll(/\bimport\s*['\"]([^'\"]+)['\"]/g)].map((match) => match[1]),
        ...[...source.matchAll(/\bimport\s*\(\s*['\"]([^'\"]+)['\"]/g)].map((match) => match[1]),
      ]);
      const importsDiff = [...specifiers].some((specifier) => {
        const resolved = specifier.startsWith('.') ? resolve(dirname(path), specifier) : null;
        return (resolved && (resolved === diffRoot || resolved.startsWith(`${diffRoot}${sep}`)))
          || /(?:^|\/)scripts\/diff(?:\/|$)/.test(specifier);
      });
      if (importsDiff || source.includes(harnessModule)) violations.push(relative('.', path));
    }

    expect(violations).toEqual([]);
    expect(readFileSync('.hlxignore', 'utf8').split(/\r?\n/)).toContain('scripts/diff/*');
  });
});
