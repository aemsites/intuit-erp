import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import TealiumMartech, {
  DEFAULT_CONFIG,
  TEALIUM_PROD_HOSTS,
  isProdHost,
  resolveEnvironment,
  readOptanonConsent,
  readIvid,
  readAkamaiGeo,
  mapConsentToTealium,
} from '../plugins/tealium-martech/src/index.js';

// A realistic (URL-encoded) OneTrust OptanonConsent cookie value: group 1 (strictly necessary)
// and group 3 (performance/analytics) granted, groups 2 (functional) and 4 (targeting) denied.
const OPTANON_COOKIE_VALUE = 'isGpcEnabled=0&datestamp=Fri+Aug+07+2026+12%3A00%3A00+GMT%2B0000+'
  + '(Coordinated+Universal+Time)&version=202401.1.0&isIABGlobal=false&hosts=&landingPath='
  + 'NotLandingPage&groups=1%3A1%2C2%3A0%2C3%3A1%2C4%3A0&AwaitingReconsent=false';

function stubLocation({ hostname = 'localhost', search = '' } = {}) {
  vi.stubGlobal('location', { hostname, search });
}

function clearCookies() {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
}

beforeEach(() => {
  clearCookies();
  document.head.innerHTML = '';
  delete window.utag;
  delete window.utag_data;
  delete window.utag_cfg_ovrd;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
  document.head.innerHTML = '';
  delete window.utag;
  delete window.utag_data;
  delete window.utag_cfg_ovrd;
});

describe('resolveEnvironment / isProdHost', () => {
  it('resolves the configured prod environment on a configured prod host', () => {
    stubLocation({ hostname: 'erp.intuit.com' });
    expect(isProdHost(DEFAULT_CONFIG)).toBe(true);
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBe('prod');
  });

  it('resolves the configured prod environment on the other configured prod host', () => {
    stubLocation({ hostname: 'aem.erp.intuit.com' });
    expect(isProdHost(DEFAULT_CONFIG)).toBe(true);
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBe('prod');
  });

  it('stays inert on localhost with no debug flag', () => {
    stubLocation({ hostname: 'localhost', search: '' });
    expect(isProdHost(DEFAULT_CONFIG)).toBe(false);
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBeNull();
  });

  it('stays inert on an *.aem.page preview host with no debug flag', () => {
    stubLocation({ hostname: 'main--site--org.aem.page', search: '' });
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBeNull();
  });

  it('stays inert on an *.aem.live host with no debug flag', () => {
    stubLocation({ hostname: 'main--site--org.aem.live', search: '' });
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBeNull();
  });

  it('resolves debugEnvironment ("qa") on a non-prod host when ?martech-debug is present', () => {
    stubLocation({ hostname: 'main--site--org.aem.page', search: '?martech-debug' });
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBe('qa');
  });

  it('ignores ?martech-debug on a prod host and still resolves the prod environment', () => {
    stubLocation({ hostname: 'erp.intuit.com', search: '?martech-debug' });
    expect(resolveEnvironment(DEFAULT_CONFIG)).toBe('prod');
  });

  it('NEVER resolves to "prod" off a prod host, even if debugEnvironment is misconfigured', () => {
    stubLocation({ hostname: 'main--site--org.aem.page', search: '?martech-debug' });
    const misconfigured = { ...DEFAULT_CONFIG, debugEnvironment: 'prod' };
    expect(resolveEnvironment(misconfigured)).not.toBe('prod');
    expect(resolveEnvironment(misconfigured)).toBeNull();
  });

  it('stays inert on a non-prod host when debug flag is present but debugEnvironment is unset', () => {
    stubLocation({ hostname: 'localhost', search: '?martech-debug' });
    const noDebugEnv = { ...DEFAULT_CONFIG, debugEnvironment: undefined };
    expect(resolveEnvironment(noDebugEnv)).toBeNull();
  });
});

describe('TEALIUM_PROD_HOSTS', () => {
  it('is the single source of truth backing DEFAULT_CONFIG.prodHosts (no duplicate list)', () => {
    expect(TEALIUM_PROD_HOSTS).toEqual(['erp.intuit.com', 'aem.erp.intuit.com']);
    expect(DEFAULT_CONFIG.prodHosts).toBe(TEALIUM_PROD_HOSTS);
  });
});

describe('TealiumMartech constructor', () => {
  it('seeds window.utag_data with config.data and merges with any pre-existing data', () => {
    stubLocation({ hostname: 'localhost' });
    window.utag_data = { existing: 'value' };
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { foo: 'bar' } });
    // Targeted keys only — window.utag_data also carries the UDO fields (consent_req/user_geo;
    // see the dedicated "UDO seed" describe block below), which this test isn't about.
    expect(window.utag_data.existing).toBe('value');
    expect(window.utag_data.foo).toBe('bar');
  });

  it('forces window.utag_cfg_ovrd.noview to true', () => {
    stubLocation({ hostname: 'localhost' });
    window.utag_cfg_ovrd = { noview: false, other: 1 };
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.noview).toBe(true);
    expect(window.utag_cfg_ovrd.other).toBe(1);
  });

  it('sets enabled=true and env="prod" on a configured prod host', () => {
    stubLocation({ hostname: 'aem.erp.intuit.com' });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(true);
    expect(tealium.env).toBe('prod');
  });

  it('sets enabled=false and env=null on a non-prod host with no debug flag', () => {
    stubLocation({ hostname: 'localhost' });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(false);
    expect(tealium.env).toBeNull();
  });
});

describe('readOptanonConsent', () => {
  it('parses a realistic OptanonConsent cookie into a groupId -> granted map', () => {
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    expect(readOptanonConsent()).toEqual({
      1: true,
      2: false,
      3: true,
      4: false,
    });
  });

  it('returns null when the cookie is absent', () => {
    expect(readOptanonConsent()).toBeNull();
  });

  it('returns null when the cookie has no parseable groups field', () => {
    document.cookie = 'OptanonConsent=isGpcEnabled=0&datestamp=Fri+Aug+07+2026';
    expect(readOptanonConsent()).toBeNull();
  });
});

describe('readIvid', () => {
  it('returns the decoded cookie value when present', () => {
    document.cookie = 'ivid=abc-123-def';
    expect(readIvid()).toBe('abc-123-def');
  });

  it('decodes a URL-encoded value', () => {
    document.cookie = `ivid=${encodeURIComponent('visitor id/with special+chars')}`;
    expect(readIvid()).toBe('visitor id/with special+chars');
  });

  it('returns null when absent', () => {
    expect(readIvid()).toBeNull();
  });
});

describe('readAkamaiGeo', () => {
  it('returns the decoded AKES_GEO cookie value when present', () => {
    document.cookie = 'AKES_GEO=US_CA';
    expect(readAkamaiGeo()).toBe('US_CA');
  });

  it('returns null when absent', () => {
    expect(readAkamaiGeo()).toBeNull();
  });
});

describe('UDO seed (window.utag_data.consent_req / .user_geo)', () => {
  it('defaults consent_req to false and leaves user_geo unset with no AKES_GEO cookie', () => {
    stubLocation({ hostname: 'localhost' });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_data.consent_req).toBe(false);
    expect('user_geo' in window.utag_data).toBe(false);
  });

  it('sets user_geo from the AKES_GEO cookie when present', () => {
    stubLocation({ hostname: 'localhost' });
    document.cookie = 'AKES_GEO=US_CA';
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_data.user_geo).toBe('US_CA');
    expect(window.utag_data.consent_req).toBe(false);
  });

  it('lets an explicit config.data.consent_req override the default', () => {
    stubLocation({ hostname: 'localhost' });
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { consent_req: true } });
    expect(window.utag_data.consent_req).toBe(true);
  });

  it('lets an explicit config.data.user_geo win over the AKES_GEO cookie', () => {
    stubLocation({ hostname: 'localhost' });
    document.cookie = 'AKES_GEO=US_CA';
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { user_geo: 'CA_ON' } });
    expect(window.utag_data.user_geo).toBe('CA_ON');
  });

  it('seeds on a disabled (non-prod, no-debug) instance too — UDO parity does not depend on enabled', () => {
    stubLocation({ hostname: 'localhost' });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(false);
    expect(window.utag_data.consent_req).toBe(false);
  });
});

describe('mapConsentToTealium', () => {
  it('marks analytics/targeting/personalization prefs granted or denied per OneTrust group', () => {
    const optanon = { 1: true, 2: false, 3: true, 4: false };
    expect(mapConsentToTealium(optanon)).toEqual({
      analytics: '1',
      display_ads: '0',
      search: '0',
      social: '0',
      affiliates: '0',
      big_data: '0',
      personalization: '0',
    });
  });

  it('grants the targeting-derived categories when group 4 is granted', () => {
    const optanon = { 2: true, 3: false, 4: true };
    const prefs = mapConsentToTealium(optanon);
    expect(prefs.display_ads).toBe('1');
    expect(prefs.search).toBe('1');
    expect(prefs.social).toBe('1');
    expect(prefs.affiliates).toBe('1');
    expect(prefs.big_data).toBe('1');
    expect(prefs.personalization).toBe('1');
    expect(prefs.analytics).toBe('0');
  });

  it('denies everything (fail-safe) when given null/undefined', () => {
    const prefs = mapConsentToTealium(null);
    expect(Object.values(prefs).every((v) => v === '0')).toBe(true);
    expect(mapConsentToTealium(undefined)).toEqual(prefs);
  });
});

describe('disabled instance (non-prod host, no debug) — eager/lazy/delayed are no-ops', () => {
  it('does not append any tiqcdn script tag and does not throw across the full lifecycle', async () => {
    stubLocation({ hostname: 'main--site--org.aem.page', search: '' });
    const createElementSpy = vi.spyOn(document, 'createElement');
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(false);

    expect(() => tealium.eager()).not.toThrow();
    await expect(tealium.lazy()).resolves.toBeUndefined();
    expect(() => tealium.delayed()).not.toThrow();

    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    expect(createElementSpy).not.toHaveBeenCalledWith('script');
  });

  it('leaves this.consent undefined and never calls window.utag (which does not exist)', async () => {
    stubLocation({ hostname: 'localhost', search: '' });
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();

    tealium.eager();
    // Even though a real consent cookie is present, a disabled instance must not read it —
    // reading it would be pointless work on a host that will never load utag.js.
    expect(tealium.consent).toBeUndefined();

    await tealium.lazy();
    expect(window.utag).toBeUndefined();
  });
});

describe('enabled instance on a prod host — lazy() loads utag.js and fires the initial view', () => {
  it('eager() does no network, then lazy() appends utag.js and calls window.utag.view once loaded', async () => {
    stubLocation({ hostname: 'erp.intuit.com' });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(true);
    expect(tealium.env).toBe('prod');

    tealium.eager();
    // eager() must never touch the network, even when enabled.
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);

    // Stub the utag global that loadUtag's injected script would normally define once it runs.
    window.utag = {
      view: vi.fn(),
      link: vi.fn(),
      gdpr: { setPreferencesValues: vi.fn() },
    };

    const lazyPromise = tealium.lazy();
    // loadUtag appended the script synchronously; jsdom never fires load/error for external
    // scripts on its own, so resolve it ourselves to simulate a successful utag.js load.
    const script = document.head.querySelector('script[src*="tiqcdn"]');
    expect(script).toBeTruthy();
    expect(script.src).toBe('https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js');
    expect(script.async).toBe(true);
    script.dispatchEvent(new Event('load'));
    await lazyPromise;

    expect(window.utag.view).toHaveBeenCalledTimes(1);
    expect(window.utag.view).toHaveBeenCalledWith(window.utag_data);
  });

  it('propagates a loadUtag failure (network/blocked) as a rejected lazy() promise', async () => {
    stubLocation({ hostname: 'erp.intuit.com' });
    const tealium = new TealiumMartech();

    const lazyPromise = tealium.lazy();
    const script = document.head.querySelector('script[src*="tiqcdn"]');
    expect(script).toBeTruthy();
    script.dispatchEvent(new Event('error'));

    await expect(lazyPromise).rejects.toThrow('Could not load Tealium utag.js');
  });
});
