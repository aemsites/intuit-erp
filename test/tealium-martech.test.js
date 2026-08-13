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
  consentCdnHost,
  loadUtag,
  loadConsentStack,
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
const STAGE_HOST = 'stage.erp.intuit.com';
const DEV_HOST_LOCALHOST = 'localhost';
// The AEM preview hosts are now INERT (not intuit.com origins → consent CDN unreachable).
const AEM_LIVE_HOST = 'main--intuit-erp--aemsites.aem.live';
const AEM_PAGE_HOST = 'main--intuit-erp--aemsites.aem.page';
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

// Flushes the microtask queue via a real macrotask boundary (jsdom's setTimeout), so chained
// `await`s inside the loader (loadScriptOnce -> loadConsentStack -> settleConsent -> loadUtag)
// have a chance to run before the next assertion, without hand-counting microtask hops. Real
// timers only — tests that need fake timers (e.g. for settleConsent's timeout) use their own
// advanceTimersByTimeAsync calls instead of this helper.
function settle() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
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
  it('resolves "prod" on the real prod hostname', () => {
    stubLocation({ hostname: PROD_HOST });
    expect(resolveEnvironment()).toBe('prod');
    expect(isProdHost()).toBe(true);
  });

  it('resolves "dev" on the Intuit staging host (stage.erp.intuit.com)', () => {
    stubLocation({ hostname: STAGE_HOST });
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

  it('resolves "dev" on the AEM preview hosts (aem.page / aem.live, any branch prefix)', () => {
    stubLocation({ hostname: AEM_PAGE_HOST });
    expect(resolveEnvironment()).toBe('dev');
    stubLocation({ hostname: AEM_LIVE_HOST });
    expect(resolveEnvironment()).toBe('dev');
    // ...regardless of the leading branch name.
    stubLocation({ hostname: 'feature-xyz--intuit-erp--aemsites.aem.page' });
    expect(resolveEnvironment()).toBe('dev');
    stubLocation({ hostname: 'feature-xyz--intuit-erp--aemsites.aem.live' });
    expect(resolveEnvironment()).toBe('dev');
    expect(isProdHost()).toBe(false);
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

  it('rejects lookalike hosts with trailing junk — never prod/dev', () => {
    // The exact (`===`) checks guard against substring matching; the aem-preview `endsWith` checks
    // guard against a suffix appearing anywhere but the very end. A trailing `.evil.com` defeats both.
    [
      'erp.intuit.com.evil.com',
      'stage.erp.intuit.com.evil.com',
      'notreallyerp.intuit.com',
      'xstage.erp.intuit.com',
      'x--intuit-erp--aemsites.aem.live.evil.com',
      'x--intuit-erp--aemsites.aem.page.evil.com',
    ].forEach((hostname) => {
      stubLocation({ hostname });
      expect(resolveEnvironment()).toBeNull();
    });
  });

  it('NEVER resolves "prod" for any host other than the exact erp.intuit.com hostname', () => {
    [
      STAGE_HOST,
      DEV_HOST_LOCALHOST,
      '127.0.0.1',
      AEM_PAGE_HOST,
      AEM_LIVE_HOST,
      INERT_HOST,
      'www.example.com',
      // Lookalike hostnames — must NOT match via a loose/substring comparison.
      'erp.intuit.com.evil.com',
      'stage.erp.intuit.com.evil.com',
      'notreallyerp.intuit.com',
    ].forEach((hostname) => {
      stubLocation({ hostname });
      expect(resolveEnvironment()).not.toBe('prod');
    });
  });
});

describe('consentCdnHost', () => {
  it('resolves the prod privacy CDN for env "prod"', () => {
    expect(consentCdnHost('prod')).toBe('privacy-cdn.a.intuit.com');
  });

  it('resolves the e2e privacy CDN for env "qa"', () => {
    expect(consentCdnHost('qa')).toBe('privacy-cdn.e2e.a.intuit.com');
  });

  it('resolves the e2e privacy CDN for env "dev"', () => {
    expect(consentCdnHost('dev')).toBe('privacy-cdn.e2e.a.intuit.com');
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
  it('sets utagdb=true for the dev environment (stage.erp.intuit.com host)', () => {
    stubLocation({ hostname: STAGE_HOST });
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

  it('sets utagdb=true for the dev environment (aem.page preview host)', () => {
    stubLocation({ hostname: AEM_PAGE_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd.utagdb).toBe(true);
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

describe('settleConsent', () => {
  it('resolves as soon as a parseable OptanonConsent cookie is present, without waiting', async () => {
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    await expect(settleConsent(3000)).resolves.toBeUndefined();
  });

  it('fails open and resolves once timeoutMs elapses when consent never settles', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      settleConsent(300).then(() => { settled = true; });

      // Not yet at the timeout: still polling, never resolved.
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBe(false);

      // Past the timeout: fail-open resolution fires even with no OptanonConsent cookie ever set.
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

describe('local mode (?martech=local) source paths', () => {
  it('loadUtag(env, true) loads utag.js from /scripts/martech/, not the Tealium CDN', async () => {
    const p = loadUtag('dev', true);
    const s = document.head.querySelector('script[src*="utag.js"]');
    expect(s.src).toContain('/scripts/martech/utag.js');
    expect(s.src).not.toContain('tiqcdn');
    s.dispatchEvent(new Event('load'));
    await p;
  });

  it('loadConsentStack(env, true) loads the 3 consent scripts from /scripts/martech/', async () => {
    const promise = loadConsentStack('dev', true);
    const stub = document.getElementById('onetrust-stub');
    expect(stub.src).toContain('/scripts/martech/otSDKStub.js');
    expect(stub.src).not.toContain('privacy-cdn');
    stub.dispatchEvent(new Event('load'));
    await settle();
    const wrapper = document.getElementById('intuit-consent-wrapper');
    expect(wrapper.src).toContain('/scripts/martech/cookies-consent-wrapper.min.js');
    wrapper.dispatchEvent(new Event('load'));
    await settle();
    const gdprUtil = document.getElementById('intuit-gdpr-util');
    expect(gdprUtil.src).toContain('/scripts/martech/gdprUtilBundle.js');
    gdprUtil.dispatchEvent(new Event('load'));
    await promise;
  });
});

describe('loadConsentStack', () => {
  it.each([
    ['prod', 'privacy-cdn.a.intuit.com'],
    ['qa', 'privacy-cdn.e2e.a.intuit.com'],
    ['dev', 'privacy-cdn.e2e.a.intuit.com'],
  ])('env "%s": appends the 3 consent scripts, in order (otSDKStub -> wrapper -> gdpr-util), from CDN host %s', async (env, cdnHost) => {
    const promise = loadConsentStack(env);

    // 1. OneTrust stub loads first; nothing else exists yet.
    const stub = document.getElementById('onetrust-stub');
    expect(stub).toBeTruthy();
    expect(stub.src).toBe(`https://${cdnHost}/stable/scripttemplates/otSDKStub.js`);
    expect(stub.getAttribute('data-domain-script')).toBe('74130b76-29e2-4d72-ab52-09f9ed5818fb');
    expect(stub.getAttribute('charset')).toBe('UTF-8');
    expect(stub.async).toBe(true);
    expect(document.getElementById('intuit-consent-wrapper')).toBeNull();
    expect(document.getElementById('intuit-gdpr-util')).toBeNull();
    stub.dispatchEvent(new Event('load'));

    // 2. Intuit's consent-wrapper loads next, only once the stub has resolved.
    await settle();
    const wrapper = document.getElementById('intuit-consent-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper.src).toBe(`https://${cdnHost}/stable/consent-wrapper/cookies-consent-wrapper.min.js`);
    expect(document.getElementById('intuit-gdpr-util')).toBeNull();
    wrapper.dispatchEvent(new Event('load'));

    // 3. gdpr-util loads last, only once the wrapper has resolved. Env-independent URL.
    await settle();
    const gdprUtil = document.getElementById('intuit-gdpr-util');
    expect(gdprUtil).toBeTruthy();
    expect(gdprUtil.src).toBe('https://uxfabric.intuitcdn.net/gdpr-util/2.11.0/gdprUtilBundle.js');
    gdprUtil.dispatchEvent(new Event('load'));

    await promise;
    expect(document.head.querySelectorAll('script').length).toBe(3);
    expect(window.OptanonWrapper).toBeTypeOf('function');
  });

  it('is idempotent — a second call appends nothing new', async () => {
    const first = loadConsentStack('prod');
    document.getElementById('onetrust-stub').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-consent-wrapper').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-gdpr-util').dispatchEvent(new Event('load'));
    await first;
    expect(document.head.querySelectorAll('script').length).toBe(3);

    // Every id already exists, so the second call resolves via loadScriptOnce's fast path for
    // all three scripts — no new elements appended, no load/error events to dispatch.
    await loadConsentStack('prod');
    expect(document.head.querySelectorAll('script').length).toBe(3);
  });

  it('resolves fail-open (never rejects) when a consent script errors out (e.g. ad-blocked)', async () => {
    const promise = loadConsentStack('prod');
    document.getElementById('onetrust-stub').dispatchEvent(new Event('error'));
    await settle();
    document.getElementById('intuit-consent-wrapper').dispatchEvent(new Event('error'));
    await settle();
    document.getElementById('intuit-gdpr-util').dispatchEvent(new Event('error'));

    await expect(promise).resolves.toBeUndefined();
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

describe("enabled instance — lazy() loads the consent stack, settles consent, then loads the resolved env's utag.js and fires the initial view", () => {
  it.each([
    ['prod', PROD_HOST, 'privacy-cdn.a.intuit.com'],
    ['dev', STAGE_HOST, 'privacy-cdn.e2e.a.intuit.com'],
  ])('env "%s" (host %s): eager() does no network; lazy() loads the consent stack (CDN %s) before utag.js and calls utag.view', async (env, hostname, cdnHost) => {
    stubLocation({ hostname });
    // A pre-existing OptanonConsent cookie lets settleConsent() resolve as soon as it's invoked
    // (its first, synchronous check), so this test doesn't need to advance any timers — the
    // timeout/fail-open path of settleConsent itself is covered by the dedicated `settleConsent`
    // tests above.
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();
    expect(tealium.enabled).toBe(true);
    expect(tealium.env).toBe(env);

    tealium.eager();
    // eager() must never touch the network, even when enabled.
    expect(document.querySelectorAll('script').length).toBe(0);

    // Stub the utag global that loadUtag's injected script would normally define once it runs.
    window.utag = {
      view: vi.fn(),
      link: vi.fn(),
      gdpr: { setPreferencesValues: vi.fn() },
    };

    const lazyPromise = tealium.lazy();

    // 1. OneTrust stub loads first — before anything else, including utag.js.
    const stub = document.getElementById('onetrust-stub');
    expect(stub).toBeTruthy();
    expect(stub.src).toBe(`https://${cdnHost}/stable/scripttemplates/otSDKStub.js`);
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    stub.dispatchEvent(new Event('load'));

    // 2. Intuit consent-wrapper loads next.
    await settle();
    const wrapper = document.getElementById('intuit-consent-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper.src).toBe(`https://${cdnHost}/stable/consent-wrapper/cookies-consent-wrapper.min.js`);
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    wrapper.dispatchEvent(new Event('load'));

    // 3. Intuit gdpr-util loads last of the consent stack.
    await settle();
    const gdprUtil = document.getElementById('intuit-gdpr-util');
    expect(gdprUtil).toBeTruthy();
    expect(gdprUtil.src).toBe('https://uxfabric.intuitcdn.net/gdpr-util/2.11.0/gdprUtilBundle.js');
    expect(document.querySelectorAll('script[src*="tiqcdn"]').length).toBe(0);
    gdprUtil.dispatchEvent(new Event('load'));

    // 4. Only once the consent stack has resolved AND consent has settled does utag.js load.
    await settle();
    const script = document.head.querySelector('script[src*="tiqcdn"]');
    expect(script).toBeTruthy();
    expect(script.src).toBe(`https://tags.tiqcdn.com/utag/intuit/ies-erp/${env}/utag.js`);
    expect(script.async).toBe(true);
    // jsdom never fires load/error for external scripts on its own, so resolve it ourselves to
    // simulate a successful utag.js load.
    script.dispatchEvent(new Event('load'));
    await lazyPromise;

    expect(window.utag.view).toHaveBeenCalledTimes(1);
    expect(window.utag.view).toHaveBeenCalledWith(window.utag_data);
    // Regression: lazy() must NOT drive utag.gdpr at load. Calling setPreferencesValues before
    // utag finishes its async INIT triggered an infinite processQueue <-> setPreferencesValues
    // recursion inside utag.js. Consent is delegated to the Tealium profile's OneTrust
    // integration (bootstrapped by the consent stack above), so the client never calls it here.
    expect(window.utag.gdpr.setPreferencesValues).not.toHaveBeenCalled();
  });

  it('propagates a loadUtag failure (network/blocked) as a rejected lazy() promise, once the consent stack has settled', async () => {
    stubLocation({ hostname: PROD_HOST });
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();

    const lazyPromise = tealium.lazy();
    document.getElementById('onetrust-stub').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-consent-wrapper').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-gdpr-util').dispatchEvent(new Event('load'));
    await settle();

    const script = document.head.querySelector('script[src*="tiqcdn"]');
    expect(script).toBeTruthy();
    script.dispatchEvent(new Event('error'));

    await expect(lazyPromise).rejects.toThrow('Could not load Tealium utag.js');
  });
});
