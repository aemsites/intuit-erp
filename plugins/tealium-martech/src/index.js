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
 * Load order in `lazy()`: OneTrust (`loadOneTrust`) loads and is given a chance to settle real
 * consent (`settleConsent`) BEFORE utag.js (`loadUtag`) loads. This mitigates a Tealium
 * consent-init recursion in the ies-erp profile: its consent extension recurses when
 * `utag.gdpr.queue` is non-empty at the moment consent flips to granted. Settling consent first
 * means utag.js's own consent extension initializes against an already-known state instead of a
 * later "flip". See `lazy()` for more.
 *
 * CSP: the page enforces Trusted Types + `strict-dynamic`, so utag.js is only ever injected via
 * `document.createElement('script')` (see `loadUtag`) — never `innerHTML`/`document.write`.
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
 * Injects Intuit's OneTrust cookie-consent SDK. Idempotent — if the stub script is already
 * present (from an earlier call), this resolves immediately without appending a second one.
 * Fail-open: resolves whether the script loads successfully or not, so a blocked/slow OneTrust
 * load never blocks utag.js from loading behind it (see `lazy()`).
 * @returns {Promise<void>} resolves once the script has loaded, errored, or was already present
 */
export function loadOneTrust() {
  return new Promise((resolve) => {
    if (document.getElementById('onetrust-stub')) {
      resolve();
      return;
    }
    // Required global callback by the OneTrust SDK.
    window.OptanonWrapper = window.OptanonWrapper || (() => {});
    const s = document.createElement('script');
    s.id = 'onetrust-stub';
    s.src = 'https://privacy-cdn.a.intuit.com/stable/scripttemplates/otSDKStub.js';
    s.setAttribute('data-domain-script', '74130b76-29e2-4d72-ab52-09f9ed5818fb');
    s.setAttribute('charset', 'UTF-8');
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

/**
 * Waits for OneTrust to settle real consent — i.e. for the `OptanonConsent` cookie to become
 * readable — polling every ~100ms. Fail-open: always resolves, even if OneTrust never settles
 * (blocked by an ad/privacy blocker, slow network, ...), after `timeoutMs`.
 * @param {Number} [timeoutMs=2000] the max time to wait for the cookie before giving up
 * @returns {Promise<void>} resolves once consent has settled, or after `timeoutMs`, whichever
 *                          comes first
 */
export function settleConsent(timeoutMs = 2000) {
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
   * Lazy-phase logic: loads OneTrust, gives its consent cookie a chance to settle, THEN loads
   * utag.js, and fires the initial page view.
   *
   * OneTrust loads (and consent is given a chance to settle) before utag.js so Tealium's own
   * consent extension initializes against an already-known consent state instead of an empty
   * `utag.gdpr.queue` that later flips to granted — the ies-erp profile's consent extension
   * recurses when that queue is non-empty at the moment consent flips to granted. `settleConsent`
   * is fail-open (2s cap by default), so a slow/blocked OneTrust load never blocks utag.js
   * indefinitely.
   *
   * Consent gating is intentionally NOT driven from here — it is delegated to the Tealium
   * profile's own OneTrust integration (the model the live site uses), which reads the
   * `OptanonConsent` cookie natively. Driving `utag.gdpr.setPreferencesValues` from the client at
   * load caused an infinite `processQueue` ↔ `setPreferencesValues` recursion inside utag.js:
   * `await loadUtag` resolves on the script's `onload`, which is *before* utag finishes its async
   * `INIT`, so the call was enqueued and then replayed into itself. If a client-side consent push
   * is ever required (see the deferred consent slice), it MUST run only after utag is fully
   * initialized — not right after `onload` — and must not re-enter on OneTrust events.
   * `readOptanonConsent` / `mapConsentToTealium` remain as ready-made, side-effect-free helpers
   * for that future profile-wiring.
   * @returns {Promise<void>} resolves once utag.js has loaded (or immediately, if disabled)
   */
  async lazy() {
    if (!this.enabled) return;
    await loadOneTrust();
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
