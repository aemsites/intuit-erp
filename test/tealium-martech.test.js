import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import TealiumMartech, {
  isProdHost,
  resolveEnvironment,
  readOptanonConsent,
  readIvid,
  readAkamaiGeo,
  consentCdnHost,
  loadUtag,
  loadConsentStack,
  loadObservabilityRum,
  initObservabilityRum,
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
  delete window.O11yRUM;
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

  it('resolves "prod" on the Intuit staging host (stage.erp.intuit.com — runs the prod profile)', () => {
    stubLocation({ hostname: STAGE_HOST });
    expect(resolveEnvironment()).toBe('prod');
    expect(isProdHost()).toBe(true);
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

  it('resolves "prod" ONLY for the exact erp.intuit.com / stage.erp.intuit.com hostnames', () => {
    [
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

  it('does NOT force utag_cfg_ovrd.noview — prod parity: utag fires its own consent-gated view', () => {
    stubLocation({ hostname: PROD_HOST });
    window.utag_cfg_ovrd = { noview: false, other: 1 };
    // eslint-disable-next-line no-new
    new TealiumMartech();
    // erp.intuit.com sets no `noview` override. Forcing it suppressed utag's own view, which is why
    // the loader then fired a manual view — the call that seeded the profile consent extension's
    // infinite processQueue <-> setPreferencesValues recursion. Leave utag's own view alone.
    expect(window.utag_cfg_ovrd.noview).toBe(false);
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
  it('sets no utag_cfg_ovrd for the prod environment (stage.erp.intuit.com host)', () => {
    stubLocation({ hostname: STAGE_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    // stage.erp.intuit.com runs the prod profile — prod parity: no utagdb, no noview.
    expect(window.utag_cfg_ovrd?.utagdb).toBeFalsy();
    expect(window.utag_cfg_ovrd?.noview).toBeFalsy();
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

  it('does not set utagdb for the prod environment (and adds no utag_cfg_ovrd overrides at all)', () => {
    stubLocation({ hostname: PROD_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    // Prod parity: erp.intuit.com sets no utag_cfg_ovrd; we add none either (no utagdb, no noview).
    expect(window.utag_cfg_ovrd?.utagdb).toBeFalsy();
    expect(window.utag_cfg_ovrd?.noview).toBeFalsy();
  });

  it('does not set utagdb (or noview) on an inert host', () => {
    stubLocation({ hostname: INERT_HOST });
    // eslint-disable-next-line no-new
    new TealiumMartech();
    expect(window.utag_cfg_ovrd?.utagdb).toBeFalsy();
    expect(window.utag_cfg_ovrd?.noview).toBeFalsy();
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
    // Mirrors the CDN layout so otSDKStub resolves its config to stable/consent/<id>/<id>.json.
    expect(stub.src).toContain('/scripts/martech/stable/scripttemplates/otSDKStub.js');
    expect(stub.src).not.toContain('privacy-cdn');
    stub.dispatchEvent(new Event('load'));
    await settle();
    const wrapper = document.getElementById('intuit-consent-wrapper');
    expect(wrapper.src).toContain('/scripts/martech/stable/consent-wrapper/cookies-consent-wrapper.min.js');
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

describe('loadObservabilityRum (Intuit o11y RUM — page-authored on prod, prod-only)', () => {
  it('env "prod": appends o11y-rum-web then o11y-rum-init, in order (init waits for the bundle)', async () => {
    const promise = loadObservabilityRum('prod');

    // 1. The RUM bundle loads first; the init/config script is not requested until it resolves,
    //    so init never runs before window.O11yRUM (which the bundle defines) exists.
    const bundle = document.getElementById('o11y-rum-web');
    expect(bundle).toBeTruthy();
    expect(bundle.src).toBe('https://uxfabric.intuitcdn.net/@cloud-monitoring/prod/o11y-rum-web.min.js');
    expect(document.getElementById('o11y-rum-init')).toBeNull();
    bundle.dispatchEvent(new Event('load'));

    // 2. init loads only once the bundle has resolved.
    await settle();
    const init = document.getElementById('o11y-rum-init');
    expect(init).toBeTruthy();
    expect(init.src).toBe('https://www.intuit.com/qbmds-components/scripts/o11y/init-0.0.1.js');
    init.dispatchEvent(new Event('load'));

    await promise;
    expect(document.head.querySelectorAll('script').length).toBe(2);
  });

  it.each([['dev'], ['qa'], [null]])('env "%s": no-op — o11y is prod-only, loads nothing', async (env) => {
    const promise = loadObservabilityRum(env);
    expect(document.getElementById('o11y-rum-web')).toBeNull();
    expect(document.getElementById('o11y-rum-init')).toBeNull();
    await expect(promise).resolves.toBeUndefined();
    expect(document.head.querySelectorAll('script').length).toBe(0);
  });

  it('is idempotent — a second prod call appends nothing new', async () => {
    const first = loadObservabilityRum('prod');
    document.getElementById('o11y-rum-web').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('o11y-rum-init').dispatchEvent(new Event('load'));
    await first;
    expect(document.head.querySelectorAll('script').length).toBe(2);

    await loadObservabilityRum('prod');
    expect(document.head.querySelectorAll('script').length).toBe(2);
  });

  it('resolves fail-open (never rejects) when a RUM script errors out (e.g. ad-blocked)', async () => {
    const promise = loadObservabilityRum('prod');
    document.getElementById('o11y-rum-web').dispatchEvent(new Event('error'));
    await settle();
    document.getElementById('o11y-rum-init').dispatchEvent(new Event('error'));
    await expect(promise).resolves.toBeUndefined();
  });

  it('starts the RUM reporter once the scripts load when the document is past "loading" '
    + '(regression: init-0.0.1.js defers start to a DOMContentLoaded already fired under EDS)', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    const RumReporter = vi.fn();
    window.O11yRUM = { RumReporter };

    const promise = loadObservabilityRum('prod');
    document.getElementById('o11y-rum-web').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('o11y-rum-init').dispatchEvent(new Event('load'));
    await promise;

    // The bug was RumReporter never being constructed -> zero rum.api.intuit.com beacons.
    expect(RumReporter).toHaveBeenCalledTimes(1);
    const cfg = RumReporter.mock.calls[0][0];
    expect(cfg.apiURL).toBe('https://rum.api.intuit.com/v1/rum/web');
    expect(cfg.tags.env).toBe('prod');
    expect(cfg.reportWebVitals).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('initObservabilityRum (compensates for init-0.0.1.js DOMContentLoaded gating)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('constructs the RumReporter with Intuit config when readyState is past "loading"', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const RumReporter = vi.fn();
    window.O11yRUM = { RumReporter };

    initObservabilityRum();

    expect(RumReporter).toHaveBeenCalledTimes(1);
    expect(RumReporter.mock.calls[0][0]).toMatchObject({
      apiURL: 'https://rum.api.intuit.com/v1/rum/web',
      reportNavigation: true,
      reportResources: true,
      reportWebVitals: true,
      tags: { env: 'prod' },
    });
  });

  it('defers to init-0.0.1.js while the document is still "loading" (no double init)', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const RumReporter = vi.fn();
    window.O11yRUM = { RumReporter };

    initObservabilityRum();

    expect(RumReporter).not.toHaveBeenCalled();
  });

  it('is a no-op when the bundle never defined window.O11yRUM (blocked/failed)', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    expect(() => initObservabilityRum()).not.toThrow();
  });

  it('fails open when the RumReporter constructor throws', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    window.O11yRUM = { RumReporter: vi.fn(() => { throw new Error('boom'); }) };
    expect(() => initObservabilityRum()).not.toThrow();
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

describe("enabled instance — lazy() loads the consent stack, settles consent, loads utag.js, then fires the CONSENT-GATED initial view", () => {
  it.each([
    ['prod', PROD_HOST, 'privacy-cdn.a.intuit.com'],
    ['prod', STAGE_HOST, 'privacy-cdn.a.intuit.com'],
  ])('env "%s" (host %s): eager() does no network; lazy() loads the consent stack (CDN %s) before utag.js, then fires the initial view once consent is resolved', async (env, hostname, cdnHost) => {
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
    // getConsentState() !== 0 here → consent already RESOLVED, so the consent-gated initial view
    // (whenConsentResolved) fires immediately and utag sends it directly (never enqueued).
    window.utag = {
      view: vi.fn(),
      link: vi.fn(),
      gdpr: { setPreferencesValues: vi.fn(), getConsentState: vi.fn(() => 1) },
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

    // head.html sets `noview:true` (suppressing utag's own auto-view), so the loader fires the
    // initial view — but only via whenConsentResolved. Consent is resolved here, so it fires now.
    expect(window.utag.view).toHaveBeenCalledWith(window.utag_data);
    // We never drive utag.gdpr.* at load (same recursion class).
    expect(window.utag.gdpr.setPreferencesValues).not.toHaveBeenCalled();
  });

  it('withholds the initial view while Tealium consent is unresolved (getConsentState()===0) — the loop guard', async () => {
    stubLocation({ hostname: PROD_HOST });
    document.cookie = `OptanonConsent=${OPTANON_COOKIE_VALUE}`;
    const tealium = new TealiumMartech();
    // Consent UNRESOLVED: firing utag.view/link now would enqueue onto utag.gdpr.queue, and the
    // ies-erp profile consent extension would recurse over it (processQueue <-> setPreferencesValues
    // — the reported infinite loop). whenConsentResolved must hold the view back, not enqueue it.
    window.utag = { view: vi.fn(), link: vi.fn(), gdpr: { getConsentState: vi.fn(() => 0) } };
    const lazyPromise = tealium.lazy();
    document.getElementById('onetrust-stub').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-consent-wrapper').dispatchEvent(new Event('load'));
    await settle();
    document.getElementById('intuit-gdpr-util').dispatchEvent(new Event('load'));
    await settle();
    document.head.querySelector('script[src*="tiqcdn"]').dispatchEvent(new Event('load'));
    await lazyPromise;
    expect(window.utag.view).not.toHaveBeenCalled();
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
