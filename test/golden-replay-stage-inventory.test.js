import {
  describe, expect, it,
} from 'vitest';
import {
  indexTrackingSheet, matchScenarioToInventory, retryTransientInventoryPage,
  safeInventoryResourceUrl, summarizeStageInventory,
} from '../scripts/diff/golden-replay-stage-inventory.mjs';

const candidate = (overrides = {}) => ({
  candidateId: 'candidate-1',
  tag: 'A',
  role: 'link',
  region: 'main',
  accessibleName: 'Register',
  dataTrackId: 'event-cards:register',
  waLink: 'event-register',
  href: 'https://stage.erp.intuit.com/events/register',
  block: 'event-cards',
  visible: true,
  ...overrides,
});

const scenario = (overrides = {}) => ({
  scenarioId: 'register-event-card',
  page: '/events',
  classification: { interaction: 'interactive' },
  targetSignature: {
    page: '/events',
    region: 'main',
    uiObject: 'button',
    uiObjectDetail: 'Register',
    uiAccessPoint: 'rw_cards_container|carousel|rw_card_1',
    waLink: 'event-register',
    href: 'https://erp.intuit.com/events/register',
  },
  runtimeAssets: ['/blocks/event-cards/event-cards.js'],
  ...overrides,
});

describe('authenticated stage locator inventory', () => {
  it('selects a unique region/block/wa-link candidate when labels repeat', () => {
    const result = matchScenarioToInventory(scenario(), [
      candidate(),
      candidate({
        candidateId: 'feature-register', dataTrackId: 'feature:register', waLink: '', block: 'feature-grid',
      }),
    ]);
    expect(result).toMatchObject({
      status: 'proposed', candidate: { candidateId: 'candidate-1', block: 'event-cards' },
    });
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
  });

  it('refuses equal-best duplicate labels instead of using DOM order or nth', () => {
    const result = matchScenarioToInventory(scenario({
      targetSignature: { ...scenario().targetSignature, waLink: '', href: '' }, runtimeAssets: [],
    }), [
      candidate({ candidateId: 'copy-a', waLink: '', href: '', dataTrackId: 'footer:company' }),
      candidate({ candidateId: 'copy-b', waLink: '', href: '', dataTrackId: 'footer:company-2' }),
    ]);
    expect(result).toMatchObject({ status: 'ambiguous' });
    expect(result.candidates).toHaveLength(2);
  });

  it('joins legacy wa-link identity through the page-scoped tracking sheet row', () => {
    const sheet = indexTrackingSheet([
      { path: '/events', id: 'event-cards:register', 'wa-link': 'event-register' },
      { path: '*', id: 'feature:register', 'wa-link': 'different-campaign' },
    ]);
    const result = matchScenarioToInventory(scenario(), [
      candidate({ waLink: '' }),
      candidate({
        candidateId: 'feature-register', dataTrackId: 'feature:register', waLink: '', block: 'feature-grid',
      }),
    ], { trackingSheet: sheet });

    expect(result).toMatchObject({
      status: 'proposed',
      candidate: {
        candidateId: 'candidate-1',
        sheetResidue: { 'wa-link': 'event-register' },
      },
    });
    expect(result.candidates[0]).toMatchObject({
      score: 207,
      reasons: ['region', 'wa-link-sheet', 'name-exact', 'href', 'block'],
    });
  });

  it('classifies passive samples without inventing a click locator', () => {
    expect(matchScenarioToInventory(scenario({
      classification: { interaction: 'passive', disposition: 'passive' },
    }), [candidate()])).toEqual({ status: 'passive', candidates: [] });
  });

  it('canonicalizes only safe exact-stage runtime resources', () => {
    expect(safeInventoryResourceUrl('https://stage.erp.intuit.com/blocks/faq/faq.js?v=1#x'))
      .toBe('https://stage.erp.intuit.com/blocks/faq/faq.js');
    expect(safeInventoryResourceUrl('https://stage.erp.intuit.com/nav.plain.html?x=1'))
      .toBe('https://stage.erp.intuit.com/nav.plain.html');
    expect(safeInventoryResourceUrl('https://evil.example/blocks/faq/faq.js')).toBeNull();
    expect(safeInventoryResourceUrl('https://stage.erp.intuit.com/private/account')).toBeNull();
  });

  it('summarizes every scenario disposition without reducing the denominator', () => {
    const inventory = {
      pages: [{
        pathname: '/events',
        matches: [
          { scenarioId: 'one', status: 'proposed' },
          { scenarioId: 'two', status: 'ambiguous' },
          { scenarioId: 'three', status: 'missing' },
          { scenarioId: 'four', status: 'passive' },
        ],
      }, { pathname: '/blocked', status: 'blocked', expectedScenarioIds: ['five', 'six'] }],
    };
    expect(summarizeStageInventory(inventory)).toEqual({
      total: 6, proposed: 1, ambiguous: 1, missing: 1, passive: 1, blocked: 2,
    });
  });

  it('retries one transient page failure but never retries containment errors', async () => {
    let attempts = 0;
    await expect(retryTransientInventoryPage(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('page readiness failed');
      return 'inventoried';
    })).resolves.toBe('inventoried');
    expect(attempts).toBe(2);

    attempts = 0;
    await expect(retryTransientInventoryPage(async () => {
      attempts += 1;
      throw new Error('bound target must use exact origin');
    })).rejects.toThrow(/exact origin/);
    expect(attempts).toBe(1);
  });
});
