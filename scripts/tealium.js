/**
 * Tealium tag manager loader — Intuit ERP's marketing pixel stack.
 *
 * The real erp.intuit.com fires nine marketing tags via Tealium:
 *   - Facebook Pixel        (850485508311844)
 *   - Google Ads            (AW-1030811807)
 *   - Google Analytics 4    (G-GCCMSJL6CT)
 *   - Bing Ads (UET)        (5153170)
 *   - LinkedIn Insight      (71656)
 *   - Reddit Pixel          (t2_306zdqst)
 *   - Amazon Ad Tag         (2 configured GUIDs)
 *   - Tealium EventStream   (server-side forwarding to Intuit's CDP)
 *
 * Rather than reimplement each pixel + Google Consent Mode v2 + Tealium
 * EventStream wiring in code (~500 lines, per-pixel PR maintenance),
 * load Intuit's Tealium container once. It orchestrates all nine
 * dynamically and gives Intuit's marketing team full control via
 * Tealium's admin UI — no code change needed to add/remove tags.
 *
 * Loading strategy
 * ────────────────
 * Fired from `scripts/delayed.js` after the OneTrust cookie-consent SDK
 * loads (so Tealium's Consent Mode v2 handlers can read consent state
 * before firing any gated tag). Delayed phase → post-LCP → post-5 s
 * Lighthouse audit window → zero LHS Performance score impact.
 *
 * Real-user coverage trade-off vs eager/lazy loading:
 *   Eager   → -20 to -35 LHS points, 100 % coverage
 *   Lazy    → -3 to -8 LHS points, ~99 % coverage
 *   Delayed → 0 LHS impact, ~90 % coverage  ← this file
 *   Server  → 0 LHS impact, ~100 % coverage (Tealium EventStream already
 *             wired for critical events per Intuit's setup)
 *
 * CSP notes
 * ─────────
 * The page CSP includes `require-trusted-types-for 'script'` +
 * `strict-dynamic` + `'nonce-aem'`. The script we inject carries the
 * `nonce="aem"` attribute so it becomes trusted; `strict-dynamic` then
 * propagates trust to every pixel script utag.js loads. The default
 * Trusted Types policy in scripts.js allows the resulting `.src=`
 * assignment through unchanged.
 */

const TEALIUM_ACCOUNT = 'intuit';
const TEALIUM_PROFILE = 'ies-erp';

/**
 * Environment routing. Only the live `erp.intuit.com` hostname maps to
 * prod; every other host (EDS previews, AEM Code Sync feature branches,
 * localhost) uses `dev` to avoid polluting Intuit's production Tealium
 * reports with EDS-pilot traffic. Override for a single QA session with
 * `?tealium_env=<env>` if marketing needs to smoke-test a specific
 * env-scoped tag lineup.
 */
function getEnv() {
  const override = new URLSearchParams(window.location.search).get('tealium_env');
  if (override === 'prod' || override === 'qa' || override === 'dev') return override;
  if (window.location.hostname === 'erp.intuit.com') return 'prod';
  return 'dev';
}

/**
 * Populates `window.utag_data` with page identity BEFORE utag.js loads,
 * so Tealium's pageview mapping has values when its extensions fire on
 * initial view. Extensible — marketing can push more variables here via
 * a future block or via `window.utag_data.X = Y` before delayed.js runs.
 */
function seedUtagData() {
  window.utag_data = window.utag_data || {
    page_url:      window.location.href,
    page_path:     window.location.pathname,
    page_title:    document.title || '',
    page_referrer: document.referrer || '',
    page_lang:     document.documentElement.lang || 'en',
    // AEP ECID stitch — if Adobe Alloy has landed, expose the ECID so
    // any Tealium tag that keys on Adobe identity resolves the same
    // visitor across the two stacks.
    ecid: (document.cookie.match(/MCMID(?:%7C|\|)(\d+)/) || [])[1] || '',
  };
}

export function loadTealium() {
  if (window.utag) return; // already loaded — idempotent
  seedUtagData();
  const script = document.createElement('script');
  script.async = true;
  script.setAttribute('nonce', 'aem'); // required by our CSP nonce policy
  script.src = `https://tags.tiqcdn.com/utag/${TEALIUM_ACCOUNT}/${TEALIUM_PROFILE}/${getEnv()}/utag.js`;
  document.head.appendChild(script);
}
