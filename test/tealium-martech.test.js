import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import TealiumMartech, {
  isProdHost,
  resolveEnvironment,
  readOptanonConsent,
  readIvid,
  readAkamaiGeo,
  mapConsentToTealium,
  loadOneTrust,
  settleConsent,
} from '../plugins/tealium-martech/src/index.js';

// A realistic (URL-encoded) OneTrust OptanonConsent cookie value: group 1 (strictly necessary)
// and group 3 (performance/analytics) granted, groups 2 (functional) and 4 (targeting) denied.
const OPTANON_COOKIE_VALUE = 'isGpcEnabled=0&datestamp=Fri+Aug+07+2026+12%3A00%3A00+GMT%2B0000+'
  + '(Coordinated+Universal+Time)&version=202401.1.0&isIABGlobal=false&hosts=&landingPath='
  + 'NotLandingPage&groups=1%3A1%2C2%3A0%2C3%3A1%2C4%3A0&AwaitingReconsent=false';

// Canonical hostnames for each resolved environment under the per-host model (see
// plugins/tealium-martech/src/index.js `resolveEnvironment`).
const PROD_HOST = 'erp.intuit.com';
const QA_HOST = 'main--intuit-erp--aemsites.aem.live';
const DEV_HOST_PAGE = 'main--intuit-erp--aemsites.aem.page';
const DEV_HOST_LOCALHOST = 'localhost';
const INERT_HOST = 'something.preview.da.live';

function stubLocation({ hostname = INERT_HOST, search = '' } = {}) {
  vi.stubGlobal('location', { hostname, search });
}

function clearCookies() {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
}

// Flushes pending microtasks/timer-chained continuations (e.g. the await loadOneTrust() ->
// await settleConsent() -> loadUtag() chain inside lazy()). A macrotask boundary always runs
// after the full microtask queue drains, so this reliably lets any number of chained `await`s
// settle. Mirrors plugins/martech/test/helpers.js's flushAsync.
function flushAsync() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

beforeEach(() => {
  clearCookies();
  document.head.innerHTML = '';
  delete window.utag;
  delete window.utag_data;
  delete window.utag_cfg_ovrd;
  delete window.OptanonWrapper;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
  document.head.innerHTML = '';
  delete window.utag;
  delete window.utag_data;
  delete window.utag_cfg_ovrd;
  delete window.OptanonWrapper;
});

describe('resolveEnvironment / isProdHost', () => {
  it('resolves "prod" on the real prod hostname', () => {
    stubLocation({ hostname: PROD_HOST });
    expect(resolveEnvironment()).toBe('prod');
    expect(isProdHost()).toBe(true);
  });

  it('resolves "qa" on the aem.live host', () => {
    stubLocation({ hostname: QA_HOST });
    expect(resolveEnvironment()).toBe('qa');
    expect(isProdHost()).toBe(false);
  });

  it('resolves "qa" on the aem.live host regardless of the leading branch name', () => {
    stubLocation({ hostname: 'feature-xyz--intuit-erp--aemsites.aem.live' });
    expect(resolveEnvironment()).toBe('qa');
  });

  it('resolves "dev" on the aem.page host', () => {
    stubLocation({ hostname: DEV_HOST_PAGE });
    expect(resolveEnvironment()).toBe('dev');
    expect(isProdHost()).toBe(false);
  });

  it('resolves "dev" on localhost', () => {
    stubLocation({ hostname: DEV_HOST_LOCALHOST });
    expect(resolveEnvironment()).toBe('dev');
  });

  it('resolves "dev" on 127.0.0.1', () => {
    stubLocation({ hostname: '127.0.0.1' });
    expect(resolveEnvironment()).toBe('dev');
  });

  it('stays inert (null) on a *.preview.da.live host', () => {
    stubLocation({ hostname: INERT_HOST });
    expect(resolveEnvironment()).toBeNull();
    expect(isProdHost()).toBe(false);
  });

  it('stays inert (null) on a random/unknown host', () => {
    stubLocation({ hostname: 'www.example.com' });
    expect(resolveEnvironment()).toBeNull();
  });

  it('does not resolve qa/dev for a lookalike host where the suffix is not at the very end', () => {
    // Guards the `endsWith` checks against ever being loosened to a substring/`includes` match.
    stubLocation({ hostname: `${QA_HOST}.evil.com` });
    expect(resolveEnvironment()).toBeNull();
    stubLocation({ hostname: `${DEV_HOST_PAGE}.evil.com` });
    expect(resolveEnvironment()).toBeNull();
  });

  it('NEVER resolves "prod" for any host other than the exact erp.intuit.com hostname', () => {
    [
      QA_HOST,
      DEV_HOST_PAGE,
      DEV_HOST_LOCALHOST,
      '127.0.0.1',
      INERT_HOST,
      'www.example.com',
      // Lookalike hostnames — must NOT match via a loose/substring comparison.
      'erp.intuit.com.evil.com',
      'notreallyerp.intuit.com',
    ].forEach((hostname) => {
      stubLocation({ hostname });
      expect(resolveEnvironment()).not.toBe('prod');
    });
  });
});

describe('TealiumMartech constructor', () => {
  it('seeds window.utag_data with config.data and merges with any pre-existing data', () => {
    stubLocation({ hostname: INERT_HOST });
    window.utag_data = { existing: 'value' };
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { foo: 'bar' } });
    // Targeted keys only — window.utag_data also carries the UDO fields (consent_req/user_geo;
    // see the dedicated "UDO seed" describe block below), which this test isn't about.
    expect(window.utag_data.existing).toBe('value');
    expect(window.utag_data.foo).toBe('bar');
  });

  it('forces window.utag_cfg_ovrd.noview to true regardless of the resolved env', () => {
    stubLocation({ hostname: PROD_HOST });
    window.utag_cfg_ovrd = { noview: false, other: 1 };
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.noview).toBe(true);
    expect(window.utag_cfg_ovrd.other).toBe(1);
  });

  it('sets enabled=true and env="prod" on the real prod hostname', () => {
    stubLocation({ hostname: PROD_HOST });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(true);
    expect(tealium.env).toBe('prod');
  });

  it('sets enabled=false and env=null on a hostname resolveEnvironment does not recognize', () => {
    stubLocation({ hostname: INERT_HOST });
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(false);
    expect(tealium.env).toBeNull();
  });
});

describe('utag_cfg_ovrd.utagdb (Tealium debug console) by resolved environment', () => {
  it('sets utagdb=true for the dev environment (aem.page host)', () => {
    stubLocation({ hostname: DEV_HOST_PAGE });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBe(true);
  });

  it('sets utagdb=true for the dev environment (localhost)', () => {
    stubLocation({ hostname: DEV_HOST_LOCALHOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBe(true);
  });

  it('does not set utagdb for the qa environment', () => {
    stubLocation({ hostname: QA_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBeFalsy();
  });

  it('does not set utagdb for the prod environment', () => {
    stubLocation({ hostname: PROD_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBeFalsy();
  });

  it('does not set utagdb on an inert host (still sets noview though)', () => {
    stubLocation({ hostname: INERT_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBeFalsy();
    expect(window.utag_cfg_ovrd.noview).toBe(true);
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
    stubLocation({ hostname: INERT_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_data.consent_req).toBe(false);
    expect('user_geo' in window.utag_data).toBe(false);
  });

  it('sets user_geo from the AKES_GEO cookie when present', () => {
    stubLocation({ hostname: INERT_HOST });
    document.cookie = 'AKES_GEO=US_CA';
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_data.user_geo).toBe('US_CA');
    expect(window.utag_data.consent_req).toBe(false);
  });

  it('lets an explicit config.data.consent_req override the default', () => {
    stubLocation({ hostname: INERT_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { consent_req: true } });
    expect(window.utag_data.consent_req).toBe(true);
  });

  it('lets an explicit config.data.user_geo win over the AKES_GEO cookie', () => {
    stubLocation({ hostname: INERT_HOST });
    document.cookie = 'AKES_GEO=US_CA';
    // eslint-disable-next-line no-new
    new TealiumMartech({ data: { user_geo: 'CA_ON' } });
    expect(window.utag_data.user_geo).toBe('CA_ON');
  });

  it('seeds UDO on a disabled instance too — UDO parity does not depend on being enabled', () => {
    stubLocation({ hostname: INERT_HOST });
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

describe('loadOneTrust', () => {
  it('appends the OneTrust stub script with the expected id/src/attributes', () => {
    const promise = loadOneTrust();
    const script = document.getElementById('onetrust-stub');
    expect(script).toBeTruthy();
    expect(script.src).toBe('https://privacy-cdn.a.intuit.com/stable/scripttemplates/otSDKStub.js');
    expect(script.getAttribute('data-domain-script')).toBe('74130b76-29e2-4d72-ab52-09f9ed5818fb');
    expect(script.async).toBe(true);
    expect(typeof window.OptanonWrapper).toBe('function');
    script.dispatchEvent(new Event('load'));
    return expect(promise).resolves.toBeUndefined();
  });

  it('is idempotent — a second call does not append a second #onetrust-stub script', async () => {
    const first = loadOneTrust();
    document.getElementById('onetrust-stub').dispatchEvent(new Event('load'));
    await first;

    await loadOneTrust();
    expect(document.querySelectorAll('#onetrust-stub').length).toBe(1);
  });

  it('resolves (fail-open) even when the script errors', async () => {
    const promise = loadOneTrust();
    document.getElementById('onetrust-stub').dispatchEvent(new Event('error'));
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('settleConsent', () => {
  it('resolves near-immediately when the OptanonConsent cookie is already present', async () => {
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const start = Date.now();
    await settleConsent(2000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('fails open and resolves after the timeout when the cookie never appears', async () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      settleConsent(250).then(settled);

      await vi.advanceTimersByTimeAsync(100);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('disabled instance (hostname resolveEnvironment does not recognize) — eager/lazy/delayed are no-ops', () => {
  it('does not append any tiqcdn script tag and does not throw across the full lifecycle', async () => {
    stubLocation({ hostname: INERT_HOST, search: '' });
    const createElementSpy = vi.spyOn(document, 'createElement');
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(false);

    expect(() => tealium.eager()).not.toThrow();
    await expect(tealium.lazy()).resolves.toBeUndefined();
    expect(() => tealium.delayed()).not.toThrow();

    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    expect(document.getElementById('onetrust-stub')).toBeNull();
    expect(createElementSpy).not.toHaveBeenCalledWith('script');
  });

  it('never touches window.utag across the lifecycle (which does not exist on an inert host)', async () => {
    stubLocation({ hostname: INERT_HOST, search: '' });
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();

    tealium.eager();
    await tealium.lazy();
    tealium.delayed();
    // A real consent cookie is present, but a disabled instance loads no utag and drives nothing.
    expect(window.utag).toBeUndefined();
  });
});

describe("enabled instance — lazy() loads OneTrust, settles consent, then the resolved env's utag.js", () => {
  it.each([
    ['prod', PROD_HOST],
    ['qa', QA_HOST],
    ['dev', DEV_HOST_PAGE],
  ])('env "%s" (host %s): OneTrust loads before utag.js, eager() does no network, utag.view fires', async (env, hostname) => {
    stubLocation({ hostname });
    // A pre-existing consent cookie lets settleConsent() resolve on its first synchronous poll,
    // so this test doesn't need to wait out its 2s fail-open timeout.
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(true);
    expect(tealium.env).toBe(env);

    tealium.eager();
    // eager() must never touch the network, even when enabled.
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    expect(document.getElementById('onetrust-stub')).toBeNull();

    // Stub the utag global that loadUtag's injected script would normally define once it runs.
    window.utag = {
      view: vi.fn(),
      link: vi.fn(),
      gdpr: { setPreferencesValues: vi.fn() },
    };

    const lazyPromise = tealium.lazy();

    // 1) OneTrust loads FIRST — and utag.js must not exist yet (order matters: this is the
    // consent-recursion mitigation — utag.js must not load until OneTrust has had a chance to
    // settle real consent).
    const oneTrustScript = document.getElementById('onetrust-stub');
    expect(oneTrustScript).toBeTruthy();
    expect(oneTrustScript.src).toContain('privacy-cdn.a.intuit.com');
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    oneTrustScript.dispatchEvent(new Event('load'));

    // Let loadOneTrust() resolve, settleConsent() resolve (cookie already present, so no real
    // wait needed), and loadUtag() synchronously append its script.
    await flushAsync();
    await flushAsync();

    // 2) utag.js loads SECOND, only after OneTrust + consent settle.
    const utagScript = document.head.querySelector('script[src*="tiqcdn"]');
    expect(utagScript).toBeTruthy();
    expect(utagScript.src).toBe(`https://tags.tiqcdn.com/utag/intuit/ies-erp/${env}/utag.js`);
    expect(utagScript.async).toBe(true);
    utagScript.dispatchEvent(new Event('load'));
    await lazyPromise;

    expect(window.utag.view).toHaveBeenCalledTimes(1);
    expect(window.utag.view).toHaveBeenCalledWith(window.utag_data);
    // Regression: lazy() must NOT drive utag.gdpr at load. Calling setPreferencesValues before
    // utag finishes its async INIT triggered an infinite processQueue <-> setPreferencesValues
    // recursion inside utag.js. Consent is delegated to the Tealium profile's OneTrust
    // integration, so the client never calls it here.
    expect(window.utag.gdpr.setPreferencesValues).not.toHaveBeenCalled();
  });

  it('propagates a loadUtag failure (network/blocked) as a rejected lazy() promise', async () => {
    stubLocation({ hostname: PROD_HOST });
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();

    const lazyPromise = tealium.lazy();
    const oneTrustScript = document.getElementById('onetrust-stub');
    expect(oneTrustScript).toBeTruthy();
    oneTrustScript.dispatchEvent(new Event('load'));
    await flushAsync();
    await flushAsync();

    const script = document.head.querySelector('script[src*="tiqcdn"]');
    expect(script).toBeTruthy();
    script.dispatchEvent(new Event('error'));

    await expect(lazyPromise).rejects.toThrow('Could not load Tealium utag.js');
  });
});
