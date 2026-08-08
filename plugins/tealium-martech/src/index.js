/**
 * Tealium iQ client-side loader.
 *
 * SAFETY: real Tealium (utag.js) — and the live ad pixels/analytics tags it can fire — must
 * NEVER load on a non-prod host. `resolveEnvironment` is the single gate that decides whether
 * (and which) utag environment loads; it returns `null` (inert) on every host except the
 * configured `prodHosts`, and the optional `?martech-debug` override can only ever select
 * `debugEnvironment` (never `'prod'`) on a non-prod host. See `resolveEnvironment` below.
 *
 * Consumed from `scripts/scripts.js` (eager/lazy/delayed phases) behind the `MARTECH_PROVIDER`
 * gate — the existing Adobe path remains the default on every current host (localhost,
 * *.aem.page, *.aem.live, *.preview.da.live); this loader only activates on the real prod
 * hostnames, which are not live yet, so today it stays dormant everywhere.
 *
 * CSP: the page enforces Trusted Types + `strict-dynamic`, so utag.js is only ever injected via
 * `document.createElement('script')` (see `loadUtag`) — never `innerHTML`/`document.write`.
 */

// The real production hostnames — single source of truth, also imported directly by
// scripts/scripts.js for the MARTECH_PROVIDER gate so the list is never duplicated.
export const TEALIUM_PROD_HOSTS = ['erp.intuit.com', 'aem.erp.intuit.com'];

/**
 * Default configuration for the loader.
 * @typedef {Object} TealiumConfig
 * @property {String} account The Tealium account name.
 * @property {String} profile The Tealium profile name.
 * @property {String} environment The utag environment to load on a configured prod host
 *                                 (defaults to 'prod').
 * @property {String[]} prodHosts The real production hostnames. Tealium only ever loads on one
 *                                 of these; every other host stays inert.
 * @property {String} [debugEnvironment] The utag environment to load on a NON-prod host when
 *                                        `?martech-debug` is present in the URL (defaults to
 *                                        'qa'). NEVER set this to 'prod' — `resolveEnvironment`
 *                                        refuses to honor it even if it were.
 * @property {Boolean} consent Whether to push OneTrust consent into Tealium via
 *                              `utag.gdpr.setPreferencesValues` once utag.js has loaded
 *                              (defaults to true).
 * @property {Object} data Extra data used to seed `window.utag_data` (defaults to {}).
 */
export const DEFAULT_CONFIG = {
  account: 'intuit',
  profile: 'ies-erp',
  environment: 'prod',
  prodHosts: TEALIUM_PROD_HOSTS,
  // Used ONLY with ?martech-debug on a non-prod host (see `resolveEnvironment`).
  // NEVER 'prod'.
  debugEnvironment: 'qa',
  consent: true,
  data: {},
};

// Module-scoped, mirroring the singleton `config` pattern used by the Adobe martech plugin
// (plugins/martech/src/index.js) — there is only ever one Tealium loader active on a page.
// Initialized to the defaults so the standalone helpers below (e.g. `loadUtag`) are usable even
// before a `TealiumMartech` instance has been constructed.
let config = { ...DEFAULT_CONFIG };

/**
 * Checks whether the current page is served from one of the configured production hostnames.
 * @param {TealiumConfig} cfg the config to use
 * @returns {Boolean} true iff `window.location.hostname` is one of `cfg.prodHosts`
 */
export function isProdHost(cfg) {
  return (cfg.prodHosts || []).includes(window.location.hostname);
}

/**
 * Resolves which Tealium (utag) environment, if any, should load on the current host.
 * SAFETY: this must NEVER resolve to `cfg.environment` (prod) unless `isProdHost(cfg)` is true,
 * and the `?martech-debug` escape hatch must NEVER be able to select the prod environment off a
 * prod host either — even if `debugEnvironment` were misconfigured to `'prod'`.
 * @param {TealiumConfig} cfg the config to use
 * @returns {String|null} the utag environment to load, or `null` to stay completely inert
 */
export function resolveEnvironment(cfg) {
  if (isProdHost(cfg)) {
    return cfg.environment;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.has('martech-debug') && cfg.debugEnvironment) {
    // Defense in depth: never let the debug override load real prod tealium off a prod host.
    return cfg.debugEnvironment === 'prod' ? null : cfg.debugEnvironment;
  }
  return null;
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
 * @param {String} env the utag environment to load ('prod', 'qa', ...)
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

/**
 * Tealium iQ client-side loader. Inert everywhere except the configured `prodHosts` (or a
 * non-prod host with the `?martech-debug` override) — see `resolveEnvironment`.
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
    window.utag_cfg_ovrd = { ...(window.utag_cfg_ovrd || {}), noview: true };
    this.env = resolveEnvironment(config);
    this.enabled = this.env !== null;
  }

  /**
   * Eager-phase logic: reads (but does not yet act on) consent/visitor-id state. No network.
   */
  eager() {
    if (!this.enabled) return;
    this.consent = readOptanonConsent();
    const ivid = readIvid();
    if (ivid) {
      window.utag_data.ivid = ivid;
    }
  }

  /**
   * Lazy-phase logic: loads utag.js, applies consent, fires the initial view, and keeps consent
   * in sync with later OneTrust preference changes.
   * @returns {Promise<void>} resolves once utag.js has loaded (or immediately, if disabled)
   */
  async lazy() {
    if (!this.enabled) return;
    await loadUtag(this.env);
    if (config.consent) {
      this.updateUserConsent(this.consent);
    }
    if (window.utag?.view) {
      window.utag.view(window.utag_data);
    }
    window.addEventListener('OneTrustGroupsUpdated', () => {
      this.consent = readOptanonConsent();
      this.updateUserConsent(this.consent);
    });
  }

  /**
   * Delayed-phase logic: signals that the page has reached the delayed phase.
   */
  delayed() {
    if (!this.enabled || !window.utag?.link) return;
    window.utag.link({ tealium_event: 'delayed_ready' });
  }

  /**
   * Pushes the given OptanonConsent groups map to Tealium's consent manager.
   * @param {Object<String, Boolean>|null} optanon the parsed OptanonConsent groups
   */
  updateUserConsent(optanon) {
    if (!this.enabled || !window.utag?.gdpr?.setPreferencesValues) return;
    window.utag.gdpr.setPreferencesValues(mapConsentToTealium(optanon));
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
