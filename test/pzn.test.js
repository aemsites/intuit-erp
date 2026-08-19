import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
  applyFragment: vi.fn().mockResolvedValue(true),
  swapMain: vi.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import {
  collectSlots, runPersonalization, runPersonalizationPage,
  getMarketingProfile, resetMarketingProfile, zoominfoSource,
} from '../scripts/pzn.js';
// eslint-disable-next-line import/first
import { fetchDecision, applyFragment, swapMain } from '../scripts/personalization/decision.js';
// eslint-disable-next-line import/first
import { resetAnalytics } from '../scripts/personalization/analytics.js';

const PROFILE_KEY = 'intuit.marketingProfile';

beforeEach(() => {
  resetAnalytics();
  resetMarketingProfile();
  delete window.appVars;
  // restoreMocks wipes the factory's mockResolvedValue before each test; re-arm the
  // applied-successfully default so applyFragment resolves like production.
  applyFragment.mockResolvedValue(true);
  swapMain.mockResolvedValue(true);
  // Seed a matching-ivid cache entry with no zoominfo so the pzn tests below resolve the
  // marketing profile from cache (no extra fetchDecision call, no enrichment) and stay
  // focused on the decision path. The marketing-profile suite clears this to exercise it.
  window.localStorage.clear();
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ivid: '', profile: {} }));
  // Run the idle-deferred analytics flush synchronously for deterministic asserts.
  window.requestIdleCallback = (cb) => { cb(); return 0; };
});
afterEach(() => {
  vi.clearAllMocks();
  delete window.requestIdleCallback;
  resetAnalytics();
  resetMarketingProfile();
  window.localStorage.clear();
  document.cookie = 'ivid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  delete window.appVars;
});

function main(html) {
  const m = document.createElement('main');
  m.innerHTML = html;
  return m;
}

// A raw batch response entry keyed <experience>_<placement>_<locale>. `placement`
// is echoed (case may differ from the slot); recommendations nest under
// `.recommendation[]` and the EDS fragment path is copyData.pznblock (real shape).
function batch(placement, pznblock, extra = {}) {
  return {
    [`ttcom_${placement}_en_US`]: {
      data: {
        recommendations: {
          recommendation: [{
            id: `rec-${placement}`, accessPoint: placement, copyData: { pznblock, contentId: '1223344' }, ...extra,
          }],
        },
      },
      placement,
      experience: 'ttcom',
      status: 200,
    },
  };
}

describe('collectSlots', () => {
  it('finds data-pzn sections and reads the placement verbatim; whole-section target', () => {
    const m = main('<div data-pzn="sbsegQbmRetail"><p>base</p></div><div class="hero"></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].placement).toBe('sbsegQbmRetail');
    expect(slots[0].el).toBe(m.querySelector('[data-pzn]'));
  });

  it('scopes to the named block when data-pzn-block is set', () => {
    const m = main('<div data-pzn="x" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div><div class="hero" data-block-name="hero"></div></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
  });

  it('matches the root section itself', () => {
    const m = main('<div data-pzn="alpha"></div>');
    const section = m.querySelector('[data-pzn]');
    const slots = collectSlots(section);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(section);
  });

  it('excludes the skipped section', () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    const slots = collectSlots(m, first);
    expect(slots.map((s) => s.placement)).toEqual(['beta']);
  });

  it('drops a block-scoped tag whose block is not found', () => {
    const m = main('<div data-pzn="x" data-pzn-block="missing"><div class="hero" data-block-name="hero"></div></div>');
    expect(collectSlots(m)).toEqual([]);
  });

  it('returns [] when there are no data-pzn sections', () => {
    expect(collectSlots(main('<div class="hero"></div>'))).toEqual([]);
  });

  // Req 4: when the same target carries both pzn and exp, IXP wins — drop the pzn slot.
  describe('IXP precedence (Req 4)', () => {
    it('drops a whole-section pzn slot when the section also has a whole-section exp', () => {
      const m = main('<div data-pzn="p" data-exp="385944"></div>');
      expect(collectSlots(m)).toEqual([]);
    });

    it('drops a block-scoped pzn slot when exp targets the same block', () => {
      const m = main('<div data-pzn="p" data-pzn-block="cards" data-exp="e" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
      expect(collectSlots(m)).toEqual([]);
    });

    it('keeps pzn when exp targets a different block (independent targets)', () => {
      const m = main('<div data-pzn="p" data-pzn-block="cards" data-exp="e" data-exp-block="hero"><div class="cards" data-block-name="cards"></div><div class="hero" data-block-name="hero"></div></div>');
      const slots = collectSlots(m);
      expect(slots).toHaveLength(1);
      expect(slots[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
    });

    it('keeps pzn (whole section) when exp is scoped to a block (different targets)', () => {
      const m = main('<div data-pzn="p" data-exp="e" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
      const slots = collectSlots(m);
      expect(slots).toHaveLength(1);
      expect(slots[0].el).toBe(m.querySelector('[data-pzn]'));
    });
  });
});

describe('runPersonalization', () => {
  it('batches all placements into one /api/pzn call and swaps each matched slot', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    // Response echoes ALPHA (upper), slot is alpha → matched case-insensitively.
    fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
    await runPersonalization(m);

    expect(fetchDecision).toHaveBeenCalledTimes(1);
    const [source, opts] = fetchDecision.mock.calls[0];
    expect(source).toBe('pzn');
    expect(opts.method).toBe('POST');
    // Full upstream batch body: one batchItem per placement + a shared attributes object.
    expect(opts.body.batchItems.map((b) => b.placement)).toEqual(['alpha', 'beta']);
    expect(opts.body.batchItems[0]).toMatchObject({
      experience: 'marketing', numberOfRecommendations: 1, recommendationMetadata: true,
    });
    expect(opts.body.attributes).toMatchObject({ permalink: expect.any(String), newVisitor: true });

    expect(applyFragment).toHaveBeenCalledTimes(1);
    expect(applyFragment.mock.calls[0][0]).toBe(m.querySelector('[data-pzn="alpha"]'));
    expect(applyFragment.mock.calls[0][1]).toBe('/fragments/pzn/a');
  });

  it('publishes the pzn analytics record onto window.appVars', async () => {
    const m = main('<div data-pzn="alpha"></div>');
    fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
    await runPersonalization(m);

    const records = window.appVars.pznRecDetailsArr;
    expect(Array.isArray(records)).toBe(true);
    expect(records).toEqual([expect.objectContaining({
      personalization_placement: 'ALPHA',
      personalization_id: 'rec-ALPHA',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      content_id: '1223344',
      externalContentIdentifier: '1223344',
    })]);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([]);
  });

  it('applies a block-scoped decision to the named block, not the section', async () => {
    const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(m);
    expect(applyFragment).toHaveBeenCalledWith(m.querySelector('[data-block-name="cards"]'), '/fragments/pzn/a');
  });

  it('applies a decision to every section sharing the same placement', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="alpha"></div>');
    fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(m);
    expect(fetchDecision.mock.calls[0][1].body.batchItems.map((b) => b.placement)).toEqual(['alpha']);
    expect(applyFragment).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no slots (no api call)', async () => {
    await runPersonalization(main('<div class="hero"></div>'));
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('leaves the baseline when the api returns null / empty', async () => {
    fetchDecision.mockResolvedValue(null);
    await runPersonalization(main('<div data-pzn="alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();

    fetchDecision.mockResolvedValue({});
    await runPersonalization(main('<div data-pzn="alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();
  });

  it('honors { skip } to exclude a section', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    fetchDecision.mockResolvedValue({});
    await runPersonalization(m, { skip: first });
    expect(fetchDecision.mock.calls[0][1].body.batchItems.map((b) => b.placement)).toEqual(['beta']);
  });

  // The block-level click channel: the applied slot carries the offer identity as the
  // data-* attributes the SBSEG click tracker walks ancestors for.
  describe('click-channel stamping', () => {
    it('stamps data-pzn-placement and data-pzn-id (from the response, not the config) on the applied slot', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      // Slot config is `alpha`; the response echoes `ALPHA` — the stamp uses the
      // response value, matching the analytics record's personalization_placement.
      fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.getAttribute('data-pzn-placement')).toBe('ALPHA');
      expect(el.getAttribute('data-pzn-id')).toBe('rec-ALPHA');
    });

    it('stamps the experiment identity when the offer carries one', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a', {
        experimentId: 385944, experimentVersion: 7, treatmentId: 39927,
      }));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.getAttribute('data-experiment-id')).toBe('385944');
      expect(el.getAttribute('data-experiment-version')).toBe('7');
      expect(el.getAttribute('data-treatment-id')).toBe('39927');
    });

    it('omits the experiment attributes when the offer has none', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.hasAttribute('data-experiment-id')).toBe(false);
      expect(el.hasAttribute('data-experiment-version')).toBe(false);
      expect(el.hasAttribute('data-treatment-id')).toBe(false);
    });

    it('stamps the named block, not the section, for a block-scoped slot', async () => {
      const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const block = m.querySelector('[data-block-name="cards"]');
      expect(block.getAttribute('data-pzn-placement')).toBe('alpha');
      expect(block.getAttribute('data-pzn-id')).toBe('rec-alpha');
      expect(m.querySelector('[data-pzn]').hasAttribute('data-pzn-placement')).toBe(false);
    });

    it('stamps every slot sharing the placement', async () => {
      const m = main('<div data-pzn="alpha"></div><div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const els = [...m.querySelectorAll('[data-pzn="alpha"]')];
      expect(els).toHaveLength(2);
      els.forEach((el) => expect(el.getAttribute('data-pzn-id')).toBe('rec-alpha'));
    });

    it('does not stamp when the swap does not land (applyFragment returns false)', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      applyFragment.mockResolvedValueOnce(false);
      await runPersonalization(m);
      expect(m.querySelector('[data-pzn="alpha"]').hasAttribute('data-pzn-placement')).toBe(false);
    });
  });
});

describe('runPersonalizationPage (whole-page pzn)', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('does nothing when the page has no personalization-id metadata', async () => {
    await runPersonalizationPage(document);
    expect(fetchDecision).not.toHaveBeenCalled();
    expect(swapMain).not.toHaveBeenCalled();
  });

  it('POSTs a one-placement batch, swaps <main>, stamps it, and records page analytics', async () => {
    document.head.innerHTML = '<meta name="personalization-id" content="homepageHero">';
    document.body.innerHTML = '<main></main>';
    fetchDecision.mockResolvedValue(batch('homepageHero', '/fragments/pzn/home'));

    await runPersonalizationPage(document);

    const [source, opts] = fetchDecision.mock.calls[0];
    expect(source).toBe('pzn');
    expect(opts.method).toBe('POST');
    expect(opts.body.batchItems.map((b) => b.placement)).toEqual(['homepageHero']);

    expect(swapMain).toHaveBeenCalledTimes(1);
    expect(swapMain.mock.calls[0][1]).toBe('/fragments/pzn/home');

    // Whole-page pzn feeds the page analytics channel (was always empty before).
    expect(window.appVars.pznPageRecDetailsArr).toEqual([expect.objectContaining({
      personalization_placement: 'homepageHero',
      personalization_id: 'rec-homepageHero',
    })]);
    // …and stamps <main> for the click channel (parity with page IXP).
    expect(document.querySelector('main').getAttribute('data-pzn-id')).toBe('rec-homepageHero');
  });

  it('leaves the baseline (no swap) when the api returns null', async () => {
    document.head.innerHTML = '<meta name="personalization-id" content="homepageHero">';
    document.body.innerHTML = '<main></main>';
    fetchDecision.mockResolvedValue(null);
    await runPersonalizationPage(document);
    expect(swapMain).not.toHaveBeenCalled();
  });
});

describe('getMarketingProfile (ZoomInfo enrichment)', () => {
  const PROFILE_COOKIES = [
    'ivid', 'akid', 'ajs_user_id', 'coreId', 'ccpa',
    'kndctr_969430F0543F253D0A4C98C6_AdobeOrg_identity',
  ];
  const profileResponse = (zoominfo) => ({ data: { marketingProfile: { zoominfo } } });

  beforeEach(() => {
    // The outer beforeEach seeds a cache hit; clear it so this suite exercises the real path.
    resetMarketingProfile();
    window.localStorage.clear();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    document.head.innerHTML = '';
    PROFILE_COOKIES.forEach((k) => { document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`; });
  });

  describe('zoominfoSource', () => {
    it('maps the hostname to the /api source path', () => {
      expect(zoominfoSource('erp.intuit.com')).toBe('zoominfo');
      expect(zoominfoSource('stage.erp.intuit.com')).toBe('e2e/zoominfo');
      expect(zoominfoSource('main--repo--owner.aem.page')).toBe('qa/zoominfo');
      expect(zoominfoSource('localhost')).toBe('qa/zoominfo');
    });

    it('returns the zoominfo-endpoint metadata override verbatim (direct testing)', () => {
      document.head.innerHTML = '<meta name="zoominfo-endpoint" content="https://direct.example/graphql">';
      expect(zoominfoSource('erp.intuit.com')).toBe('https://direct.example/graphql');
    });
  });

  it('resolves from localStorage without a network call when the ivid matches', async () => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ivid: '', profile: { zoominfo: { zi_c_city: 'Cache' } } }));
    const result = await getMarketingProfile();
    expect(result).toEqual({ zi_c_city: 'Cache' });
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('fetches on a cache miss and stores the full profile keyed by ivid', async () => {
    fetchDecision.mockResolvedValue(profileResponse({ zi_c_city: 'Oakland' }));
    const result = await getMarketingProfile();
    expect(result).toEqual({ zi_c_city: 'Oakland' });
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(PROFILE_KEY)))
      .toEqual({ ivid: '', profile: { zoominfo: { zi_c_city: 'Oakland' } } });
  });

  it('refetches when the stored ivid no longer matches the visitor', async () => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ivid: 'old', profile: { zoominfo: { zi_c_city: 'Stale' } } }));
    document.cookie = 'ivid=fresh';
    fetchDecision.mockResolvedValue(profileResponse({ zi_c_city: 'Fresh' }));
    const result = await getMarketingProfile();
    expect(result).toEqual({ zi_c_city: 'Fresh' });
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(PROFILE_KEY)).ivid).toBe('fresh');
  });

  it('returns null and does NOT cache on failure/timeout', async () => {
    fetchDecision.mockResolvedValue(null);
    expect(await getMarketingProfile()).toBeNull();
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
  });

  it('returns null when the response carries no marketingProfile (e.g. GraphQL errors)', async () => {
    fetchDecision.mockResolvedValue({ errors: [{ message: 'nope' }] });
    expect(await getMarketingProfile()).toBeNull();
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
  });

  it('memoizes: concurrent callers share a single fetch', async () => {
    fetchDecision.mockResolvedValue(profileResponse({ zi_c_city: 'Once' }));
    const [a, b] = await Promise.all([getMarketingProfile(), getMarketingProfile()]);
    expect(a).toEqual({ zi_c_city: 'Once' });
    expect(b).toEqual({ zi_c_city: 'Once' });
    expect(fetchDecision).toHaveBeenCalledTimes(1);
  });

  it('builds the GraphQL input from cookies, ivid and constants (ipAddress omitted)', async () => {
    document.cookie = 'ivid=visitor-1';
    document.cookie = 'akid=ak-1';
    document.cookie = 'ccpa=1|1';
    document.cookie = 'kndctr_969430F0543F253D0A4C98C6_AdobeOrg_identity=ident-1';
    fetchDecision.mockResolvedValue(profileResponse({ zi_c_city: 'Oakland' }));
    await getMarketingProfile();

    const [, opts] = fetchDecision.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.timeoutMs).toBe(500);
    expect(opts.body.query).toContain('MarketingProfile');
    const { input } = opts.body.variables;
    expect(input).toMatchObject({
      org: 'sbseg',
      scope: 'qbo',
      purpose: 'mktg',
      newVisitor: true,
      visitorRegion: 'US',
      ivid: 'visitor-1',
    });
    expect(input.pageURL).toBe(window.location.href);
    expect(input).not.toHaveProperty('ipAddress');
    expect(input.cookies.map((c) => c.key)).toEqual(expect.arrayContaining([
      'ivid', 'akid', 'ccpa', 'kndctr_969430F0543F253D0A4C98C6_AdobeOrg_identity',
    ]));
  });

  it('merges the zoominfo fields into the /api/pzn attributes', async () => {
    fetchDecision
      .mockResolvedValueOnce(profileResponse({ zi_c_industry_primary: 'Education', zi_c_employees: 2143 }))
      .mockResolvedValueOnce(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(main('<div data-pzn="alpha"></div>'));

    expect(fetchDecision).toHaveBeenCalledTimes(2);
    const pznBody = fetchDecision.mock.calls[1][1].body;
    expect(pznBody.attributes).toMatchObject({
      zi_c_industry_primary: 'Education',
      zi_c_employees: 2143,
      newVisitor: true,
    });
  });

  it('still runs pzn (unenriched) when the profile call returns null', async () => {
    fetchDecision
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(main('<div data-pzn="alpha"></div>'));

    expect(applyFragment).toHaveBeenCalledTimes(1);
    expect(fetchDecision.mock.calls[1][1].body.attributes).not.toHaveProperty('zi_c_industry_primary');
  });
});
