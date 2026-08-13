/**
 * Tealium iQ client-side loader.
 *
 * SAFETY: real Tealium (utag.js) — and the live ad pixels/analytics tags it can fire — must
 * NEVER load the prod environment off the real prod hostname. `resolveEnvironment` is the single
 * gate that maps the current `window.location.hostname` to a utag environment or `null` (inert);
 * first match wins:
 *
 *   erp.intuit.com                              -> 'prod'
 *   stage.erp.intuit.com                        -> 'dev'   (Intuit staging; consent CDN reachable)
 *   *--intuit-erp--aemsites.aem.live            -> 'dev'
 *   *--intuit-erp--aemsites.aem.page            -> 'dev'
 *   localhost, 127.0.0.1                        -> 'dev'
 *   anything else (e.g. *.preview.da.live)      -> null (inert)
 *
 * Only `erp.intuit.com` can ever resolve to `'prod'` — there is no override/config path that can
 * escalate a non-prod host to `'prod'`. CONSENT CAVEAT: the AEM preview hosts
 * (`*--intuit-erp--aemsites.aem.page` / `.aem.live`) and `localhost` are NOT `intuit.com`
 * origins, so Intuit's OneTrust consent CDN (`privacy-cdn*.a.intuit.com`) CloudFront-blocks them
 * and the default (CDN) consent stack can't settle there — the profile's consent extension would
 * recurse. On those hosts use `?martech=local` (local consent copies from `/scripts/martech/`, see
 * scripts.js) or `?martech=off`. Only `stage.erp.intuit.com` and prod can run the CDN consent
 * stack directly.
 *
 * Consumed from `scripts/scripts.js` (eager/lazy/delayed phases) — Tealium is that file's default
 * provider; the legacy Adobe/aem-martech path is opt-in only via `?martech=adobe`. Whichever
 * provider scripts.js selects, this loader still self-gates via `resolveEnvironment`: on an inert
 * host `enabled` is `false` and every method below is a no-op.
 *
 * CONSENT / PROD PARITY: `erp.intuit.com` sets no `utag_cfg_ovrd`, never calls `utag.view()`, and
 * loads a full OneTrust consent stack BEFORE utag.js — then lets utag fire (and consent-gate) its
 * own initial view. We mirror that exactly: no `noview` override (see constructor), no manual view
 * (see `lazy()`), and `loadConsentStack` ahead of utag.js. An earlier version set `noview:true` and
 * fired `utag.view()` itself right after `loadUtag`; when that view was dispatched while utag's
 * consent was still unresolved (`utag.gdpr.getConsentState() === 0`), it was enqueued and the
 * `ies-erp` profile's consent extension recursed infinitely at INIT
 * (`processQueue <-> setPreferencesValues`; see `lazy()`'s doc comment). The recursion is a
 * profile-side fragility this loader cannot change; we avoid triggering it by not injecting a view
 * into an unresolved-consent state — i.e. by not overriding utag's own view. This loader calls no
 * `utag.gdpr.*` API. (`loadConsentStack`/`settleConsent` keep prod's consent-before-utag ordering;
 * note the local `?martech=local` OneTrust copies do not by themselves settle Tealium consent —
 * utag's own opt-out default resolves it at INIT for the US audience.)
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
 * match wins. `erp.intuit.com`, `stage.erp.intuit.com`, `localhost` and `127.0.0.1` match
 * exactly; the AEM preview hosts match by the `--intuit-erp--aemsites.aem.{live,page}` suffix
 * (any branch prefix). Lookalikes — `erp.intuit.com.evil.com`,
 * `x--intuit-erp--aemsites.aem.live.evil.com` — resolve to `null`, since the exact checks and the
 * suffix-must-be-at-the-end (`endsWith`) check both reject a trailing `.evil.com`.
 * SAFETY: only `erp.intuit.com` may ever resolve to `'prod'`; every other host resolves to
 * `'dev'` or `null` (inert) — there is no config/query-string override that can escalate a
 * non-prod host to `'prod'`.
 * @returns {String|null} 'prod' | 'dev', or `null` to stay completely inert
 */
export function resolveEnvironment() {
  const { hostname } = window.location;
  if (hostname === 'erp.intuit.com') return 'prod';
  if (hostname === 'stage.erp.intuit.com') return 'dev';
  if (hostname.endsWith('--intuit-erp--aemsites.aem.live')) return 'dev';
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
 * Base path for the local vendor copies used by `?martech=local` (see `scripts/martech/*.js`) — a
 * self-contained martech stack (utag.js + the OneTrust consent scripts) for testing without
 * Intuit's VPN-gated consent CDN. Respects the EDS code base path so it also resolves on previews.
 * @returns {String} the base path, no trailing slash
 */
function localMartechBase() {
  return `${(window.hlx && window.hlx.codeBasePath) || ''}/scripts/martech`;
}

/**
 * Loads the Tealium utag.js library for the given environment via a plain script tag (CSP:
 * Trusted Types + strict-dynamic — never innerHTML/document.write).
 * @param {String} env the utag environment to load ('prod', 'qa', 'dev')
 * @returns {Promise<void>} resolves once the script has loaded, rejects on load failure
 */
export function loadUtag(env, local = false) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = local
      ? `${localMartechBase()}/utag.js`
      : `https://tags.tiqcdn.com/utag/${config.account}/${config.profile}/${env}/utag.js`;
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
export async function loadConsentStack(env, local = false) {
  // Required global callback by the OneTrust SDK — pre-declared so the stub never calls into an
  // undefined global regardless of exactly when it finishes loading.
  window.OptanonWrapper = window.OptanonWrapper || (() => {});
  // `?martech=local` serves the scripts same-origin from /scripts/martech/ (Intuit's real consent
  // CDN is VPN-gated, so it 403s off-VPN). The OneTrust files MIRROR the CDN layout
  // (stable/scripttemplates/otSDKStub.js, stable/consent-wrapper/…, stable/consent/<id>/<id>.json)
  // on purpose: otSDKStub derives its config URL by splitting its own src on `scripttemplates/`, so
  // so the stub must live under stable/scripttemplates/ for the config to resolve correctly.
  const base = local ? localMartechBase() : null;
  const cdnHost = local ? null : consentCdnHost(env);

  await loadScriptOnce({
    id: 'onetrust-stub',
    src: local
      ? `${base}/stable/scripttemplates/otSDKStub.js`
      : `https://${cdnHost}/stable/scripttemplates/otSDKStub.js`,
    // The e2e domain-script id is assumed identical to prod's (`74130b76…`) — confirm with Intuit
    // if OneTrust does not initialize on e2e.
    attrs: { 'data-domain-script': '74130b76-29e2-4d72-ab52-09f9ed5818fb', charset: 'UTF-8' },
  });
  await loadScriptOnce({
    id: 'intuit-consent-wrapper',
    src: local
      ? `${base}/stable/consent-wrapper/cookies-consent-wrapper.min.js`
      : `https://${cdnHost}/stable/consent-wrapper/cookies-consent-wrapper.min.js`,
  });
  await loadScriptOnce({
    id: 'intuit-gdpr-util',
    // Env-independent — Intuit serves gdpr-util from a single CDN regardless of environment.
    src: local
      ? `${base}/gdprUtilBundle.js`
      : 'https://uxfabric.intuitcdn.net/gdpr-util/2.11.0/gdprUtilBundle.js',
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
 * Runs `fn` (a utag tracked call — view/link) ONLY once Tealium consent has resolved
 * (`utag.gdpr.getConsentState() !== 0`), polling until it does or `timeoutMs` elapses.
 *
 * THE one invariant this loader must hold: never hand utag a tracked call while consent is `0`.
 * `utag.view`/`utag.link` called with `getConsentState() === 0` enqueue the event onto
 * `utag.gdpr.queue`, and the `ies-erp` profile's consent extension then recurses over that queue
 * (`processQueue` ↔ `setPreferencesValues`, stack overflow — see `lazy()`). This applies to EVERY
 * tracked call, not just the initial view: the delayed-phase `delayed_ready` link hit exactly this.
 * Consent can legitimately stay `0` for a while (or forever) on a non-`intuit.com` host where the
 * consent CDN is CloudFront-blocked and no `?martech=local` copies settle it — in which case the
 * call is dropped after the timeout: no tracking, but no loop.
 * @param {Function} fn the tracked call to run once consent is resolved
 * @param {Number} [timeoutMs=8000] max time to wait for consent before dropping the call
 */
function whenConsentResolved(fn, timeoutMs = 8000) {
  const gdpr = window.utag && window.utag.gdpr;
  if (!gdpr || typeof gdpr.getConsentState !== 'function') return;
  if (gdpr.getConsentState() !== 0) { fn(); return; }
  const start = Date.now();
  const id = window.setInterval(() => {
    if (gdpr.getConsentState() !== 0) {
      window.clearInterval(id);
      fn();
    } else if (Date.now() - start >= timeoutMs) {
      window.clearInterval(id); // fail-open: consent never resolved — drop the call, never loop
    }
  }, 200);
}

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
    // When true (set from `?martech=local` in scripts.js), lazy() loads utag.js + the consent
    // stack from the local copies in /scripts/martech/ instead of the vendor CDNs.
    this.local = !!cfg.local;
    // Pre-declare the data layer / config override globals as early as possible (head.html
    // already does this before any script runs; this just layers in the instance's own data).
    window.utag_data = { ...(window.utag_data || {}), ...config.data };
    seedUdo();
    this.env = resolveEnvironment();
    this.enabled = this.env !== null;
    // Prod parity: erp.intuit.com sets NO `utag_cfg_ovrd` — in particular it does NOT set
    // `noview`, so utag fires (and consent-gates/queues/replays) its OWN initial view. We used to
    // set `noview:true` and fire `utag.view()` ourselves in lazy(); that manual view, dispatched
    // while `utag.gdpr.getConsentState()===0`, is what seeded the `ies-erp` consent extension's
    // processQueue<->setPreferencesValues recursion. We now leave utag's view alone and only layer
    // in Tealium's verbose logging on dev.
    if (DEBUG_ENVIRONMENTS.includes(this.env)) {
      // Tealium's own verbose console logging — dev only, set before utag.js loads in lazy().
      window.utag_cfg_ovrd = { ...(window.utag_cfg_ovrd || {}), utagdb: true };
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
   * fail-open time out), then loads utag.js. It does NOT fire the page view — utag fires its own.
   *
   * PROD PARITY / RECURSION FIX. `erp.intuit.com` sets no `utag_cfg_ovrd` and never calls
   * `utag.view()` itself: it just loads the OneTrust consent stack ahead of utag.js and lets utag
   * fire (and consent-gate) its own initial view. We mirror that. An earlier version of this loader
   * instead set `noview:true` (suppressing utag's own view) and called `utag.view(utag_data)` here,
   * right after `loadUtag` — which resolves on the script's `onload`, i.e. while utag's consent may
   * still be unresolved (`utag.gdpr.getConsentState() === 0`, e.g. first visit / EEA geo before the
   * banner is actioned, or any load where the local `?martech=local` consent copies never establish
   * a `CONSENTMGR`/`ccpa`/`cpra` cookie). A tracked call made while consent is `0` is pushed onto
   * `utag.gdpr.queue`; the `ies-erp` profile's consent extension then runs
   * `setConsentPrefs -> setPreferencesValues -> processQueue`, which re-runs the extension over the
   * queued event (`utag.handler.RE(..., "blr")`) BEFORE clearing the queue — an unbounded
   * `processQueue <-> setPreferencesValues` recursion (stack overflow / frozen tab). Prod dodges it
   * because consent is resolved before the view, so nothing is ever queued. The recursion itself is
   * a profile-side fragility we can't fix from here; we avoid triggering it by not injecting a view
   * into an unresolved-consent state — i.e. by not overriding utag's own view at all.
   *
   * `readOptanonConsent` / `mapConsentToTealium` remain as ready-made, side-effect-free helpers for
   * any future profile-wiring; this loader calls no `utag.gdpr.*` API.
   * @returns {Promise<void>} resolves once the consent stack has settled and utag.js has loaded
   *                           (or immediately, if disabled)
   */
  async lazy() {
    if (!this.enabled) return;
    await loadConsentStack(this.env, this.local);
    await settleConsent();
    await loadUtag(this.env, this.local);
    // Fire the initial page view — but ONLY once consent has resolved. `head.html` sets
    // `utag_cfg_ovrd.noview=true` (suppressing utag's OWN auto-view, which carries the identical
    // loop risk), so firing the view is ours to do; `whenConsentResolved` guarantees it never
    // enqueues into a `getConsentState()===0` state (the profile consent-extension recursion).
    if (window.utag?.view) {
      whenConsentResolved(() => window.utag.view(window.utag_data));
    }
  }

  /**
   * Delayed-phase logic: signals that the page has reached the delayed phase.
   */
  delayed() {
    if (!this.enabled || !window.utag?.link) return;
    // Consent-gated: firing this link while getConsentState()===0 enqueues it and triggers the
    // profile consent-extension recursion (this was the delayed-phase regression).
    whenConsentResolved(() => window.utag.link({ tealium_event: 'delayed_ready' }));
  }

  /**
   * Sends a view event to Tealium, merged over the current `utag_data`.
   * @param {Object} d the view data
   */
  trackView(d) {
    if (!this.enabled || !window.utag?.view) return;
    whenConsentResolved(() => window.utag.view({ ...window.utag_data, ...d }));
  }

  /**
   * Sends a link (event) tracking call to Tealium.
   * @param {Object} d the event data
   */
  trackEvent(d) {
    if (!this.enabled || !window.utag?.link) return;
    whenConsentResolved(() => window.utag.link({ ...d }));
  }
}
