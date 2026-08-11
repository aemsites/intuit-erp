/**
 * Tealium iQ client-side loader.
 *
 * SAFETY: real Tealium (utag.js) — and the live ad pixels/analytics tags it can fire — must
 * NEVER load the prod environment off the real prod hostname. `resolveEnvironment` is the single
 * gate that maps the current `window.location.hostname` to a utag environment or `null` (inert);
 * first match wins:
 *
 *   erp.intuit.com                              -> 'prod'
 *   *--intuit-erp--aemsites.aem.live            -> 'qa'
 *   *--intuit-erp--aemsites.aem.page            -> 'dev'
 *   localhost, 127.0.0.1                        -> 'dev'
 *   anything else (e.g. *.preview.da.live)      -> null (inert)
 *
 * Only `erp.intuit.com` can ever resolve to `'prod'` — there is no override/config path that can
 * escalate a non-prod host to `'prod'`.
 *
 * Consumed from `scripts/scripts.js` (eager/lazy/delayed phases) — Tealium is that file's default
 * provider; the legacy Adobe/aem-martech path is opt-in only via `?martech=adobe`. Whichever
 * provider scripts.js selects, this loader still self-gates via `resolveEnvironment`: on an inert
 * host `enabled` is `false` and every method below is a no-op.
 *
 * CONSENT: on the real erp.intuit.com prod page, a full OneTrust consent stack loads and settles
 * BEFORE utag.js, so a consistent `OptanonConsent` cookie already exists by the time Tealium's own
 * OneTrust integration reads it at utag INIT. This loader used to load only utag.js, so
 * `OptanonConsent` was never set, consent state was inconsistent, and the `ies-erp` profile's
 * consent extension recursed infinitely at INIT (see `lazy()`'s doc comment for the recursion
 * writeup). The fix replicates Intuit's prod consent stack — the OneTrust stub, Intuit's own
 * consent-wrapper, and gdpr-util (see `loadConsentStack`) — and loads it to settlement (see
 * `settleConsent`) BEFORE utag.js (see `lazy()`), so the same consistent `OptanonConsent` the
 * profile expects is already in place at INIT. This works around a profile-side bug (the
 * recursion itself lives in the `ies-erp` profile's consent extension, which this loader cannot
 * change) by establishing consistent consent first; it does not call any `utag.gdpr.*` API.
 *
 * CSP: the page enforces Trusted Types + `strict-dynamic`, so utag.js and the consent stack are
 * only ever injected via `document.createElement('script')` (see `loadUtag`, `loadScriptOnce`) —
 * never `innerHTML`/`document.write`.
 */

/**
 * Default configuration for the loader. The utag environment is NOT part of this config — it is
 * always derived from the hostname by `resolveEnvironment`.
 * @typedef {Object} TealiumConfig
 * @property {String} account The Tealium account name.
 * @property {String} profile The Tealium profile name.
 * @property {Object} data Extra data used to seed `window.utag_data` (defaults to {}).
 */
export const DEFAULT_CONFIG = {
  account: 'intuit',
  profile: 'ies-erp',
  data: {},
};

// Module-scoped, mirroring the singleton `config` pattern used by the Adobe martech plugin
// (plugins/martech/src/index.js) — there is only ever one Tealium loader active on a page.
// Initialized to the defaults so the standalone helpers below (e.g. `loadUtag`) are usable even
// before a `TealiumMartech` instance has been constructed.
let config = { ...DEFAULT_CONFIG };

/**
 * Resolves which Tealium (utag) environment, if any, applies to the current hostname. First
 * match wins.
 * SAFETY: only `erp.intuit.com` may ever resolve to `'prod'`; every other host resolves to
 * `'qa'`, `'dev'`, or `null` (inert) — there is no config/query-string override that can
 * escalate a non-prod host to `'prod'`.
 * @returns {String|null} 'prod' | 'qa' | 'dev', or `null` to stay completely inert
 */
export function resolveEnvironment() {
  const { hostname } = window.location;
  if (hostname === 'erp.intuit.com') return 'prod';
  if (hostname.endsWith('--intuit-erp--aemsites.aem.live')) return 'qa';
  if (hostname.endsWith('--intuit-erp--aemsites.aem.page')) return 'dev';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'dev';
  return null;
}

/**
 * Convenience check, trivially derived from `resolveEnvironment`.
 * @returns {Boolean} true iff the current hostname resolves to the prod environment
 */
export function isProdHost() {
  return resolveEnvironment() === 'prod';
}

/**
 * Parses the OneTrust `OptanonConsent` cookie (URL-encoded, carrying a `groups=1:1,2:0,...`
 * field) into a groupId -> granted map.
 * @returns {Object<String, Boolean>|null} the consent groups, or null if absent/unparseable
 */
export function readOptanonConsent() {
  const match = document.cookie.match(/(?:^|;\s*)OptanonConsent=([^;]+)/);
  if (!match) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch (err) {
    return null;
  }

  const groupsMatch = decoded.match(/(?:^|&)groups=([^&]*)/);
  if (!groupsMatch || !groupsMatch[1]) return null;

  const groups = {};
  groupsMatch[1].split(',').forEach((pair) => {
    const [id, granted] = pair.split(':');
    if (!id) return;
    groups[id] = granted === '1';
  });
  return Object.keys(groups).length ? groups : null;
}

/**
 * Reads Intuit's `ivid` (visitor id) cookie. Mirrors the same cookie the edge worker already
 * reads server-side (see edge/src/de/resolve.js `readIvid`).
 * @returns {String|null} the decoded cookie value, or null if absent
 */
export function readIvid() {
  const match = document.cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    return match[1];
  }
}

/**
 * Reads the Akamai edge geo cookie. Only present once the site is served behind Akamai.
 * @returns {String|null} the decoded cookie value, or null if absent
 */
export function readAkamaiGeo() {
  const match = document.cookie.match(/(?:^|;\s*)AKES_GEO=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    return match[1];
  }
}

// OneTrust group id -> Tealium consent category mapping. This is an open item pending the
// Tealium profile setup — the category names below are Tealium's common defaults, not yet
// confirmed against the "ies-erp" profile's actual consent categories.
// TODO(profile): confirm exact OneTrust-group → Tealium-category mapping against the ies-erp
// profile.
const GROUP_TO_TEALIUM_CATEGORIES = {
  2: ['personalization'], // OneTrust "Functional"
  3: ['analytics'], // OneTrust "Performance/Analytics"
  // OneTrust "Targeting/Advertising"
  4: ['display_ads', 'search', 'social', 'affiliates', 'big_data'],
};

/**
 * Maps a parsed `OptanonConsent` groups map to a Tealium `utag.gdpr.setPreferencesValues` prefs
 * object. Granted categories are represented as `'1'`, denied (including unknown/missing groups)
 * as `'0'`.
 * @param {Object<String, Boolean>|null} optanon the parsed OptanonConsent groups (see
 *                                                `readOptanonConsent`), or null/undefined
 * @returns {Object<String, String>} the Tealium prefs object
 */
export function mapConsentToTealium(optanon) {
  const prefs = {};
  Object.entries(GROUP_TO_TEALIUM_CATEGORIES).forEach(([groupId, categories]) => {
    const granted = !!(optanon && optanon[groupId]);
    categories.forEach((category) => {
      prefs[category] = granted ? '1' : '0';
    });
  });
  return prefs;
}

/**
 * Loads the Tealium utag.js library for the given environment via a plain script tag (CSP:
 * Trusted Types + strict-dynamic — never innerHTML/document.write).
 * @param {String} env the utag environment to load ('prod', 'qa', 'dev')
 * @returns {Promise<void>} resolves once the script has loaded, rejects on load failure
 */
export function loadUtag(env) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://tags.tiqcdn.com/utag/${config.account}/${config.profile}/${env}/utag.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load Tealium utag.js (env: ${env})`));
    document.head.appendChild(script);
  });
}

/**
 * Resolves the Intuit consent-stack CDN host for the given utag environment. Mirrors the same
 * prod/non-prod split as `resolveEnvironment`/utag itself: only the real `'prod'` env is pointed
 * at Intuit's production privacy CDN; both `'qa'` and `'dev'` are pointed at the e2e (pre-prod)
 * privacy CDN.
 * @param {String} env the utag environment ('prod', 'qa', 'dev')
 * @returns {String} the consent-stack CDN hostname
 */
export function consentCdnHost(env) {
  return env === 'prod' ? 'privacy-cdn.a.intuit.com' : 'privacy-cdn.e2e.a.intuit.com';
}

/**
 * Idempotent, fail-open script loader. If an element with the given `id` already exists, resolves
 * immediately without touching the DOM (so calling this repeatedly for the same script is safe).
 * Otherwise injects a new `<script>` via `document.createElement` (CSP: Trusted Types +
 * strict-dynamic — never innerHTML/document.write) and resolves on either `load` or `error`: a
 * failed/blocked script (ad blocker, network hiccup, CDN outage) must never hang or block whatever
 * is awaiting it — see `loadConsentStack`, which relies on this to keep the consent stack from
 * ever blocking utag.js.
 * @param {Object} opts
 * @param {String} opts.id the element id to dedupe on
 * @param {String} opts.src the script src URL
 * @param {Object<String, String>} [opts.attrs] extra attributes to set via `setAttribute`
 * @returns {Promise<void>} always resolves, never rejects
 */
export function loadScriptOnce({ id, src, attrs = {} }) {
  return new Promise((resolve) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    Object.entries(attrs).forEach(([key, value]) => {
      script.setAttribute(key, value);
    });
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

/**
 * Loads Intuit's prod consent stack — the OneTrust stub, Intuit's own consent-wrapper, and
 * gdpr-util, in that order — ahead of utag.js (see the file-header CONSENT note for why). Each
 * script is awaited before the next is requested, mirroring the sequential load order of the real
 * erp.intuit.com page; `loadScriptOnce` makes every step idempotent and fail-open, so a blocked or
 * slow consent script never wedges the sequence.
 * @param {String} env the utag environment ('prod', 'qa', 'dev'), used to pick the per-env CDN
 * @returns {Promise<void>} resolves once all three scripts have settled (loaded or failed)
 */
export async function loadConsentStack(env) {
  // Required global callback by the OneTrust SDK — pre-declared so the stub never calls into an
  // undefined global regardless of exactly when it finishes loading.
  window.OptanonWrapper = window.OptanonWrapper || (() => {});
  const cdnHost = consentCdnHost(env);

  await loadScriptOnce({
    id: 'onetrust-stub',
    src: `https://${cdnHost}/stable/scripttemplates/otSDKStub.js`,
    // The e2e domain-script id is assumed identical to prod's (`74130b76…`) — confirm with Intuit
    // if OneTrust does not initialize on e2e.
    attrs: { 'data-domain-script': '74130b76-29e2-4d72-ab52-09f9ed5818fb', charset: 'UTF-8' },
  });
  await loadScriptOnce({
    id: 'intuit-consent-wrapper',
    src: `https://${cdnHost}/stable/consent-wrapper/cookies-consent-wrapper.min.js`,
  });
  await loadScriptOnce({
    id: 'intuit-gdpr-util',
    // Env-independent — Intuit serves gdpr-util from a single CDN regardless of environment.
    src: 'https://uxfabric.intuitcdn.net/gdpr-util/2.11.0/gdprUtilBundle.js',
  });
}

/**
 * Waits for a consistent `OptanonConsent` cookie to exist (as parsed by `readOptanonConsent`),
 * polling roughly every 100ms, or until `timeoutMs` elapses — whichever comes first. Fail-open:
 * always resolves (never rejects), so a slow, blocked, or misconfigured consent stack never
 * permanently blocks utag.js from loading.
 * @param {Number} [timeoutMs=3000] the maximum time to wait, in milliseconds
 * @returns {Promise<void>}
 */
export function settleConsent(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (readOptanonConsent() !== null || Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

// TODO(geo): confirm the definitive user_geo source on EDS (Akamai edge cookie/header) before
// go-live.
/**
 * Seeds the two UDO fields the live Tealium profile expects on `window.utag_data`
 * (`{ user_geo, consent_req }`) — called from the constructor, right after the existing
 * `config.data` merge, so an explicit `config.data` value always wins over these defaults.
 * `consent_req` defaults to `false` (US opt-out posture); `user_geo` is only set when the
 * Akamai edge geo cookie is present — it is never fabricated.
 */
function seedUdo() {
  if (!('consent_req' in window.utag_data)) {
    window.utag_data.consent_req = false;
  }
  if (!('user_geo' in window.utag_data)) {
    const geo = readAkamaiGeo();
    if (geo !== null) {
      window.utag_data.user_geo = geo;
    }
  }
}

// utag environments that should run Tealium's own verbose console/debug mode (`utagdb`). Only
// 'dev' is verbose; 'qa' and 'prod' both stay silent, like a real production deploy.
const DEBUG_ENVIRONMENTS = ['dev'];

/**
 * Tealium iQ client-side loader. Inert on every hostname `resolveEnvironment` doesn't recognize
 * (e.g. *.preview.da.live) — see `resolveEnvironment`.
 */
export default class TealiumMartech {
  /**
   * @param {Partial<TealiumConfig>} [cfg] optional config overrides merged over DEFAULT_CONFIG
   */
  constructor(cfg = {}) {
    config = { ...DEFAULT_CONFIG, ...cfg };
    // Pre-declare the data layer / config override globals as early as possible (head.html
    // already does this before any script runs; this just layers in the instance's own data).
    window.utag_data = { ...(window.utag_data || {}), ...config.data };
    seedUdo();
    this.env = resolveEnvironment();
    this.enabled = this.env !== null;
    window.utag_cfg_ovrd = { ...(window.utag_cfg_ovrd || {}), noview: true };
    if (DEBUG_ENVIRONMENTS.includes(this.env)) {
      // Tealium's own verbose console logging — dev only, set before utag.js loads in lazy().
      window.utag_cfg_ovrd.utagdb = true;
    }
  }

  /**
   * Eager-phase logic: reads (but does not yet act on) consent/visitor-id state. No network.
   */
  eager() {
    if (!this.enabled) return;
    const ivid = readIvid();
    if (ivid) {
      window.utag_data.ivid = ivid;
    }
  }

  /**
   * Lazy-phase logic: replicates Intuit's prod consent stack, waits for consent to settle (or
   * fail-open time out), then loads utag.js and fires the initial page view.
   *
   * Consent gating is intentionally NOT driven by us calling `utag.gdpr.setPreferencesValues` —
   * it is delegated to the Tealium profile's own OneTrust integration (the model the live site
   * uses), which reads the `OptanonConsent` cookie natively. Driving `setPreferencesValues` from
   * the client at load caused an infinite `processQueue` ↔ `setPreferencesValues` recursion inside
   * utag.js: `await loadUtag` resolves on the script's `onload`, which is *before* utag finishes
   * its async `INIT`, so the call was enqueued and then replayed into itself. That recursion is a
   * bug in the `ies-erp` profile's consent extension, not something fixable from here — but the
   * extension assumes a consistent `OptanonConsent` cookie already exists by INIT, which the real
   * erp.intuit.com prod page guarantees via its own consent stack. This loader used to skip
   * straight to utag.js, so `OptanonConsent` was never set and that assumption broke, triggering
   * the recursion regardless of whether we ever called `setPreferencesValues` ourselves. The fix:
   * load Intuit's consent stack (`loadConsentStack`) and wait for it to settle (`settleConsent`)
   * BEFORE loading utag.js, so the same consistent `OptanonConsent` the profile expects is already
   * in place at INIT. We still never call any `utag.gdpr.*` API — `readOptanonConsent` /
   * `mapConsentToTealium` remain as ready-made, side-effect-free helpers for any future
   * profile-wiring, unused by this loader today.
   * @returns {Promise<void>} resolves once the consent stack has settled and utag.js has loaded
   *                           (or immediately, if disabled)
   */
  async lazy() {
    if (!this.enabled) return;
    await loadConsentStack(this.env);
    await settleConsent();
    await loadUtag(this.env);
    if (window.utag?.view) {
      window.utag.view(window.utag_data);
    }
  }

  /**
   * Delayed-phase logic: signals that the page has reached the delayed phase.
   */
  delayed() {
    if (!this.enabled || !window.utag?.link) return;
    window.utag.link({ tealium_event: 'delayed_ready' });
  }

  /**
   * Sends a view event to Tealium, merged over the current `utag_data`.
   * @param {Object} d the view data
   */
  trackView(d) {
    if (!this.enabled || !window.utag?.view) return;
    window.utag.view({ ...window.utag_data, ...d });
  }

  /**
   * Sends a link (event) tracking call to Tealium.
   * @param {Object} d the event data
   */
  trackEvent(d) {
    if (!this.enabled || !window.utag?.link) return;
    window.utag.link({ ...d });
  }
}
