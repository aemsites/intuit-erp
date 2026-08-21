import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
  swapMain: vi.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { runPersonalizationPage } from '../scripts/pzn.js';
// eslint-disable-next-line import/first
import { fetchDecision, swapMain } from '../scripts/personalization/decision.js';
// eslint-disable-next-line import/first
import { resetAnalytics } from '../scripts/personalization/analytics.js';
// eslint-disable-next-line import/first
import { resetMarketingProfile } from '../scripts/personalization/marketing-profile.js';

const PROFILE_KEY = 'intuit.marketingProfile';

beforeEach(() => {
  resetAnalytics();
  resetMarketingProfile();
  delete window.appVars;
  // restoreMocks wipes the factory's mockResolvedValue before each test; re-arm the
  // applied-successfully default so swapMain resolves like production.
  swapMain.mockResolvedValue(true);
  // Seed a matching-ivid cache entry with no zoominfo so the pzn tests below resolve the
  // marketing profile from cache (no extra fetchDecision call, no enrichment) and stay
  // focused on the decision path. The tests that exercise enrichment clear this.
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

  // The marketing-profile (ZoomInfo) enrichment itself lives in, and is unit-tested by,
  // scripts/personalization/marketing-profile.js (test/marketing-profile.test.js). These
  // two cases cover pzn.js's OWN integration point: that the resolved profile is merged
  // into the whole-page batch attributes (and that a miss still runs pzn unenriched).
  describe('getMarketingProfile (ZoomInfo) enrichment', () => {
    it('merges the zoominfo fields into the /api/pzn attributes', async () => {
      document.head.innerHTML = '<meta name="personalization-id" content="homepageHero">';
      document.body.innerHTML = '<main></main>';
      resetMarketingProfile();
      window.localStorage.clear();
      fetchDecision
        .mockResolvedValueOnce({
          data: { marketingProfile: { zoominfo: { zi_c_industry_primary: 'Education', zi_c_employees: 2143 } } },
        })
        .mockResolvedValueOnce(batch('homepageHero', '/fragments/pzn/home'));

      await runPersonalizationPage(document);

      expect(fetchDecision).toHaveBeenCalledTimes(2);
      const pznBody = fetchDecision.mock.calls[1][1].body;
      expect(pznBody.attributes).toMatchObject({
        zi_c_industry_primary: 'Education',
        zi_c_employees: 2143,
        newVisitor: true,
      });
    });

    it('still runs pzn (unenriched) when the profile call returns null', async () => {
      document.head.innerHTML = '<meta name="personalization-id" content="homepageHero">';
      document.body.innerHTML = '<main></main>';
      resetMarketingProfile();
      window.localStorage.clear();
      fetchDecision
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(batch('homepageHero', '/fragments/pzn/home'));

      await runPersonalizationPage(document);

      expect(swapMain).toHaveBeenCalledTimes(1);
      expect(fetchDecision.mock.calls[1][1].body.attributes).not.toHaveProperty('zi_c_industry_primary');
    });
  });
});
