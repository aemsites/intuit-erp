import {
  describe, expect, it,
} from 'vitest';
import {
  applyLocatorReviewToManifest, createLocatorReview,
} from '../scripts/diff/golden-replay-locator-review.mjs';

const manifest = () => ({
  schemaVersion: 1,
  manifestContentHash: 'sha256:manifest',
  goldenMappingHash: 'sha256:mapping',
  scenarios: [
    {
      scenarioId: 'one', page: '/events', classification: { interaction: 'interactive' },
      targetSignature: { region: 'main', uiObjectDetail: 'Register', waLink: 'event-register', href: '' },
      runtimeAssets: ['/blocks/event-cards/event-cards.js'],
    },
    {
      scenarioId: 'two', page: '/events', classification: { interaction: 'interactive' },
      targetSignature: { region: 'main', uiObjectDetail: 'Duplicate', waLink: '', href: '' }, runtimeAssets: [],
    },
    {
      scenarioId: 'three', page: '/events', classification: { interaction: 'interactive' },
      targetSignature: {
        region: 'main', uiObjectDetail: 'Absent', waLink: 'absent-campaign', href: '',
      },
      runtimeAssets: [],
    },
    {
      scenarioId: 'four', page: '/events', classification: { interaction: 'passive' },
      targetSignature: {}, runtimeAssets: [],
    },
  ],
});

const candidate = (candidateId, accessibleName, dataTrackId) => ({
  candidateId,
  accessibleName,
  dataTrackId,
  tag: 'A',
  role: 'link',
  region: 'main',
  waLink: '',
  href: '',
  block: dataTrackId === 'event-cards:register' ? 'event-cards' : '',
  ariaExpanded: null,
  visible: true,
});

const inventory = () => ({
  schemaVersion: 1,
  manifest: { schemaVersion: 1, contentHash: 'sha256:manifest', mappingHash: 'sha256:mapping' },
  origin: 'https://stage.erp.intuit.com',
  pages: [{
    pathname: '/events',
    status: 'inventoried',
    expectedScenarioIds: ['one', 'two', 'three', 'four'],
    pageCasId: '/events',
    pageCasIdPass: true,
    candidates: [
      candidate('register', 'Register', 'event-cards:register'),
      candidate('duplicate-a', 'Duplicate', 'duplicate:a'),
      candidate('duplicate-b', 'Duplicate', 'duplicate:b'),
    ],
  }],
});

describe('golden replay locator review', () => {
  it('keeps the complete denominator while joining the legacy campaign through the sheet', () => {
    const review = createLocatorReview({
      manifest: manifest(),
      inventory: inventory(),
      inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from(JSON.stringify({ data: [
        { path: '/events', id: 'event-cards:register', 'wa-link': 'event-register' },
      ] })),
    });

    expect(review.summary).toEqual({
      total: 4, proposed: 1, ambiguous: 1, missing: 1, passive: 1, blocked: 0,
    });
    expect(review.scenarios[0]).toMatchObject({
      scenarioId: 'one',
      status: 'proposed',
      locator: { strategy: 'data-track-id', value: 'event-cards:register' },
      evidence: { reasons: ['region', 'wa-link-sheet', 'name-exact', 'block'] },
    });
    expect(review.pageCasId).toEqual({ total: 1, passing: 1, failing: [] });
    expect(review.scenarios[1]).toMatchObject({ status: 'ambiguous', diagnosis: 'semantic-duplicate' });
    expect(review.scenarios[2]).toMatchObject({ status: 'missing', diagnosis: 'sheet-residue-missing' });
    expect(review.unresolvedCauses).toEqual({
      'semantic-duplicate': 1,
      'sheet-residue-missing': 1,
    });
    expect(review.inputs.trackingSheetSha256).toMatch(/^sha256:[a-f0-9]{64}$/);

    const updated = applyLocatorReviewToManifest(manifest(), review);
    expect(updated.scenarios.map(({ locator }) => locator.status)).toEqual([
      'proposed', 'ambiguous', 'missing', 'passive',
    ]);
    expect(updated.scenarios[0].locator).toMatchObject({
      strategy: 'data-track-id',
      value: 'event-cards:register',
      evidence: { reviewContentHash: review.reviewContentHash },
    });
    expect(updated.manifestContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(updated.manifestContentHash).not.toBe('sha256:manifest');
  });

  it('refuses inventory captured against another manifest', () => {
    const other = inventory();
    other.manifest.contentHash = 'sha256:other';
    expect(() => createLocatorReview({
      manifest: manifest(), inventory: other, inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from('{"data":[]}'),
    })).toThrow(/inventory manifest binding/);
  });

  it('refuses duplicate live sheet identities instead of inheriting last-row-wins ambiguity', () => {
    expect(() => createLocatorReview({
      manifest: manifest(), inventory: inventory(), inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from(JSON.stringify({ data: [
        { path: '/events', id: 'event-cards:register', 'wa-link': 'one' },
        { path: '/events/', id: 'event-cards:register', 'wa-link': 'two' },
      ] })),
    })).toThrow(/duplicate tracking sheet identity/);
  });

  it('quarantines sheet-selected and partial-name locators that conflict with visible identity', () => {
    const testManifest = manifest();
    testManifest.scenarios.push(
      {
        scenarioId: 'five', page: '/events', classification: { interaction: 'interactive' },
        targetSignature: {
          region: 'main', uiObjectDetail: 'Capabilities', waLink: 'nav-capabilities', href: '',
        },
        runtimeAssets: ['/blocks/event-cards/event-cards.js'],
      },
      {
        scenarioId: 'six', page: '/events', classification: { interaction: 'interactive' },
        targetSignature: {
          region: 'main', uiObjectDetail: 'nav|resources_thought-leadership', waLink: 'nav-thought-leadership', href: '',
        },
        runtimeAssets: ['/blocks/event-cards/event-cards.js'],
      },
    );
    const testInventory = inventory();
    testInventory.pages[0].expectedScenarioIds.push('five', 'six');
    testInventory.pages[0].candidates.push(
      candidate('capabilities', 'Capabilities', 'nav:capabilities'),
      candidate('logo', 'Intuit Enterprise Suite', 'nav:erp'),
      candidate('resources', 'Resources', 'nav:resources'),
    );
    testInventory.pages[0].candidates.at(-1).block = 'event-cards';
    const review = createLocatorReview({
      manifest: testManifest,
      inventory: testInventory,
      inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from(JSON.stringify({ data: [
        { path: '/events', id: 'event-cards:register', 'wa-link': 'event-register' },
        { path: '/events', id: 'nav:erp', 'wa-link': 'nav-capabilities' },
        { path: '/events', id: 'nav:erp-4', 'wa-link': 'nav-thought-leadership' },
      ] })),
    });

    expect(review.scenarios[4]).toMatchObject({
      scenarioId: 'five', status: 'ambiguous', diagnosis: 'sheet-semantic-conflict',
      trackingSheetRefs: [{ path: '/events', id: 'nav:erp' }],
    });
    expect(review.scenarios[5]).toMatchObject({
      scenarioId: 'six', status: 'ambiguous', diagnosis: 'semantic-residue-conflict',
      trackingSheetRefs: [{ path: '/events', id: 'nav:erp-4' }],
    });
    expect(review.unresolvedCauses).toMatchObject({
      'sheet-semantic-conflict': 1,
      'semantic-residue-conflict': 1,
    });
  });
});
