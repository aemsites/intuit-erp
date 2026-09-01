import {
  describe, expect, it,
} from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('quarantines semantic conflicts but preserves the runtime label fallback', () => {
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
      {
        scenarioId: 'seven', page: '/events', classification: { interaction: 'interactive' },
        targetSignature: {
          region: 'main', uiObjectDetail: 'Intuit Enterprise Suite', waLink: 'footer-company-profile', href: '',
        },
        runtimeAssets: [],
      },
      {
        scenarioId: 'eight', page: '/events', classification: { interaction: 'interactive' },
        targetSignature: {
          region: 'main', uiObjectDetail: 'Take the tour', waLink: 'hero-tour', href: '',
        },
        runtimeAssets: [],
      },
    );
    const testInventory = inventory();
    testInventory.pages[0].expectedScenarioIds.push('five', 'six', 'seven', 'eight');
    testInventory.pages[0].candidates.push(
      candidate('capabilities', 'Capabilities', 'nav:capabilities'),
      candidate('logo', 'Intuit Enterprise Suite', 'nav:erp'),
      candidate('resources', 'Resources', 'nav:resources'),
      candidate('tour', 'Take the tour', 'hero:navattic-srk05sa'),
    );
    testInventory.pages[0].candidates.at(-2).block = 'event-cards';
    testInventory.pages[0].candidates.at(-1).block = 'hero';
    const review = createLocatorReview({
      manifest: testManifest,
      inventory: testInventory,
      inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from(JSON.stringify({ data: [
        { path: '/events', id: 'event-cards:register', 'wa-link': 'event-register' },
        { path: '/events', id: 'nav:erp', 'wa-link': 'nav-capabilities' },
        { path: '/events', id: 'nav:erp-4', 'wa-link': 'nav-thought-leadership' },
        { path: '/events', id: 'footer:company', 'wa-link': 'footer-company-profile' },
        { path: '/events', id: 'hero:take-the-tour', 'wa-link': 'hero-tour' },
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
    expect(review.scenarios[6]).toMatchObject({
      scenarioId: 'seven', status: 'ambiguous', diagnosis: 'semantic-residue-conflict',
      trackingSheetRefs: [{ path: '/events', id: 'footer:company' }],
    });
    expect(review.scenarios[7]).toMatchObject({
      scenarioId: 'eight', status: 'proposed',
      locator: { strategy: 'data-track-id', value: 'hero:navattic-srk05sa' },
    });
    expect(review.unresolvedCauses).toMatchObject({
      'sheet-semantic-conflict': 1,
      'semantic-residue-conflict': 2,
    });
  });

  it('applies reviewed decisions only through exact scenario, page, and stable candidate identity', () => {
    const reviewedOverrides = {
      schemaVersion: 1,
      reviewId: 'review-2026-08-31',
      evidenceRef: '.jig/click-tracking-harness/evidence/v31-noncaptured-gap-audit.md',
      decisions: [{
        scenarioId: 'two',
        page: '/events',
        candidateIdentity: {
          dataTrackId: 'duplicate:b', accessibleName: 'Duplicate', role: 'link', region: 'main', block: '',
        },
        locator: { requireNoBlock: true },
        rationale: 'reviewed duplicate target',
      }],
    };
    const create = (overrides) => createLocatorReview({
      manifest: manifest(), inventory: inventory(), inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from('{"data":[]}'),
      reviewedOverridesBytes: Buffer.from(JSON.stringify(overrides)),
    });
    const review = create(reviewedOverrides);

    expect(review.scenarios[1]).toMatchObject({
      scenarioId: 'two', status: 'proposed',
      locator: {
        strategy: 'data-track-id', value: 'duplicate:b', region: 'main', role: 'link',
        accessibleName: 'Duplicate', block: '', requireNoBlock: true,
      },
      evidence: {
        reviewedDecision: {
          reviewId: 'review-2026-08-31',
          evidenceRef: '.jig/click-tracking-harness/evidence/v31-noncaptured-gap-audit.md',
          candidateIdentity: reviewedOverrides.decisions[0].candidateIdentity,
        },
      },
    });
    expect(review.inputs.reviewedOverridesSha256).toMatch(/^sha256:[a-f0-9]{64}$/);

    const wrongPage = structuredClone(reviewedOverrides);
    wrongPage.decisions[0].page = '/wrong';
    expect(() => create(wrongPage)).toThrow(/reviewed locator page/i);

    const unstableIdentity = structuredClone(reviewedOverrides);
    unstableIdentity.decisions[0].candidateIdentity = { candidateId: 'duplicate-b' };
    expect(() => create(unstableIdentity)).toThrow(/stable candidate identity/i);
  });

  it('uses reviewed occurrence evidence to disambiguate identical authored targets', () => {
    const testInventory = inventory();
    testInventory.pages[0].candidates = [
      candidate('duplicate-a', 'Schedule a call', ''),
      candidate('duplicate-b', 'Schedule a call', ''),
      candidate('duplicate-c', 'Schedule a call', ''),
    ];
    const reviewedOverrides = {
      schemaVersion: 1,
      reviewId: 'review-2026-09-01',
      evidenceRef: 'audit.md',
      decisions: [{
        scenarioId: 'two',
        page: '/events',
        candidateIdentity: {
          dataTrackId: '', accessibleName: 'Schedule a call', tag: 'A', role: 'link', region: 'main', block: '',
        },
        locator: {
          requireNoBlock: true,
          occurrence: 2,
          occurrenceEvidence: { stableConstraint: 'authored panel order' },
        },
        rationale: 'the reviewed target is in the second authored panel',
      }],
    };

    const review = createLocatorReview({
      manifest: manifest(), inventory: testInventory, inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from('{"data":[]}'),
      reviewedOverridesBytes: Buffer.from(JSON.stringify(reviewedOverrides)),
    });

    expect(review.scenarios[1]).toMatchObject({
      status: 'proposed',
      locator: {
        strategy: 'semantic', occurrence: 2,
        occurrenceEvidence: { stableConstraint: 'authored panel order' },
      },
      evidence: { candidate: { candidateId: 'duplicate-b' } },
    });

    delete reviewedOverrides.decisions[0].locator.occurrenceEvidence;
    expect(() => createLocatorReview({
      manifest: manifest(), inventory: testInventory, inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from('{"data":[]}'),
      reviewedOverridesBytes: Buffer.from(JSON.stringify(reviewedOverrides)),
    })).toThrow(/occurrence lacks stable evidence/i);
  });

  it('carries reviewed setup and duplicate-target decisions into the replay manifest', () => {
    const testManifest = manifest();
    const testInventory = inventory();
    const reviewedOverrides = {
      schemaVersion: 1,
      reviewId: 'review-2026-08-31',
      evidenceRef: 'audit.md',
      decisions: ['one', 'two'].map((scenarioId) => ({
        scenarioId,
        page: '/events',
        candidateIdentity: {
          dataTrackId: 'event-cards:register', accessibleName: 'Register', role: 'link', region: 'main', block: 'event-cards',
        },
        locator: { block: 'event-cards' },
        setupSteps: [{
          type: 'click',
          locator: { trackId: 'widget:open', role: 'button', name: 'Open', region: 'widget', exact: true },
          expect: { state: 'visible' },
        }],
        duplicateOf: scenarioId === 'two' ? 'one' : null,
        rationale: 'reviewed target',
      })),
    };
    const review = createLocatorReview({
      manifest: testManifest, inventory: testInventory, inventoryBytes: Buffer.from('inventory'),
      trackingSheetBytes: Buffer.from('{"data":[]}'),
      reviewedOverridesBytes: Buffer.from(JSON.stringify(reviewedOverrides)),
    });
    const updated = applyLocatorReviewToManifest(testManifest, review);
    expect(updated.scenarios[0].setupSteps).toHaveLength(1);
    expect(updated.scenarios[1]).toMatchObject({
      locator: { status: 'proposed', value: 'event-cards:register' },
      setupSteps: [{ type: 'click' }],
    });
    expect(updated.scenarios[1].locator.evidence.reviewedDecision.duplicateOf).toBe('one');
  });

  it('ships the reviewed harness-owned decisions without closing ambiguous owner-owned gaps', () => {
    const artifact = JSON.parse(readFileSync(
      'scripts/diff/fixtures/golden-replay-reviewed-locator-overrides.json', 'utf8',
    ));
    expect(artifact.decisions).toHaveLength(32);
    expect(new Set(artifact.decisions.map(({ scenarioId }) => scenarioId)).size).toBe(32);
    expect(artifact.decisions.find(({ scenarioId }) => (
      scenarioId === 'customer-professional-services-aa56645bc6c8'
    ))).toMatchObject({
      candidateIdentity: {
        dataTrackId: 'cards:quickbooks-r-enterprise-intuit-enterprise-suite-professional-service-business',
        accessibleName: 'Intuit Enterprise Suite for professional service firms: Read more',
        href: 'https://quickbooks.intuit.com/r/enterprise/intuit-enterprise-suite-professional-service-business/',
      },
      locator: { block: 'cards' },
    });
    expect(artifact.decisions.map(({ scenarioId }) => scenarioId)).not.toContain(
      'customer-blog-construction-automation-in-cons-e622b3154851',
    );
    const headerReplacements = {
      'customer-accounting-business-intelligence-rep-f5394eada35a': 'nav:schedule-a-call-2',
      'customer-accounting-business-intelligence-rep-59676cca353e': 'nav:accountant',
      'customer-accounting-business-intelligence-rep-da515b45f064': 'nav:accounting',
      'customer-home-f1a7df4ec339': 'nav:schedule-a-call-2',
      'customer-compare-70f348c74e9d': 'nav:accountant',
      'customer-blog-construction-automation-in-cons-0e10ba8ddb3e': 'nav:accountant',
      'customer-blog-construction-automation-in-cons-7b3473b467b0': 'nav:accounting',
      'customer-blog-construction-automation-in-cons-67db829b55cf': 'nav:schedule-a-call-2',
    };
    for (const [scenarioId, dataTrackId] of Object.entries(headerReplacements)) {
      expect(artifact.decisions.find((decision) => decision.scenarioId === scenarioId))
        .toMatchObject({ candidateIdentity: { dataTrackId, region: 'header', block: 'header' } });
    }
    for (const scenarioId of [
      'customer-accounting-business-intelligence-rep-da515b45f064',
      'customer-blog-construction-automation-in-cons-7b3473b467b0',
    ]) {
      expect(artifact.decisions.find((decision) => decision.scenarioId === scenarioId)?.setupSteps)
        .toMatchObject([{ locator: { trackId: 'nav:capabilities' } }]);
    }
    expect(artifact.decisions.find(({ scenarioId }) => (
      scenarioId === 'customer-accountant-a977351edbd2'
    ))).toMatchObject({
      candidateIdentity: {
        accessibleName: 'Schedule a consultation', role: 'link', region: 'main', block: '',
      },
      locator: { requireNoBlock: true, href: '' },
    });
    expect(artifact.decisions.find(({ scenarioId }) => (
      scenarioId === 'customer-migration-5a4d66ef88d4'
    ))).toMatchObject({
      candidateIdentity: { accessibleName: 'Schedule a call', role: 'link', block: 'tabs' },
      locator: {
        href: '', occurrence: 1, occurrenceEvidence: { stableConstraint: expect.any(String) },
      },
    });
    expect(artifact.decisions.find(({ scenarioId }) => (
      scenarioId === 'customer-events-ea3f92116675'
    ))).toMatchObject({
      candidateIdentity: {
        dataTrackId: 'cards:quickbooks-r-midsize-business-what-is-cloud-erp-benefits-examples',
        accessibleName: 'What is cloud ERP? How it works, benefits, and tips: Read more',
        block: 'cards',
      },
      locator: { block: 'cards' },
    });
    for (const decision of artifact.decisions) {
      expect(decision).toMatchObject({
        scenarioId: expect.stringMatching(/^customer-/),
        page: expect.stringMatching(/^\//),
        rationale: expect.any(String),
      });
      expect(Object.keys(decision.candidateIdentity).some((key) => key !== 'candidateId')).toBe(true);
    }
    for (const scenarioId of ['customer-events-170319f758b0', 'customer-events-03760052fa48']) {
      expect(artifact.decisions.find((decision) => decision.scenarioId === scenarioId)?.setupSteps)
        .toMatchObject([{ locator: { trackId: 'cards:next-events' } }]);
    }
    for (const scenarioId of [
      'customer-events-7efa0bd38349',
      'customer-blog-construction-automation-in-cons-f31673a3238c',
    ]) {
      expect(artifact.decisions.find((decision) => decision.scenarioId === scenarioId)?.candidateIdentity)
        .not.toHaveProperty('href');
    }
  });
});
