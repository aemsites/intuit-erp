import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  getMarketingProfile, resetMarketingProfile, zoominfoSource,
} from '../scripts/personalization/marketing-profile.js';
// eslint-disable-next-line import/first
import { fetchDecision } from '../scripts/personalization/decision.js';

const PROFILE_KEY = 'intuit.marketingProfile';
const PROFILE_COOKIES = [
  'ivid', 'akid', 'ajs_user_id', 'coreId', 'ccpa',
  'kndctr_969430F0543F253D0A4C98C6_AdobeOrg_identity',
];
const profileResponse = (zoominfo) => ({ data: { marketingProfile: { zoominfo } } });

beforeEach(() => {
  resetMarketingProfile();
  window.localStorage.clear();
  document.head.innerHTML = '';
});
afterEach(() => {
  vi.clearAllMocks();
  resetMarketingProfile();
  window.localStorage.clear();
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

describe('getMarketingProfile (ZoomInfo enrichment)', () => {
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
});
