import { getMetadata } from '../aem.js';
// decision.js dynamically imports blocks/fragment/fragment.js, which imports
// scripts.js for decorateMain — the same unavoidable cycle pzn.js/exp.js/byo.js
// already carry this exact disable comment for; this import didn't create a new
// cycle, it just moved an existing edge (pzn.js -> decision.js) to sit behind
// this module instead (pzn.js -> marketing-profile.js -> decision.js).
// eslint-disable-next-line import/no-cycle
import { fetchDecision } from './decision.js';
import { resolveIvid } from './attributes.js';

// --- Marketing-profile (ZoomInfo) enrichment -------------------------------
// Intuit's marketing-mesh GraphQL service returns firmographics for the visitor;
// we merge the `zoominfo` fields into the pzn attributes so the decision can target
// on them. Akamai fronts the call same-origin (injecting the key + client IP) via a
// hostname-selected path; a `zoominfo-endpoint` metadata override hits a URL directly
// (testing). Fetched at most once per visitor and cached in localStorage until the
// ivid changes; 500ms budget, fully fail-open (null → pzn runs unenriched).
//
// Shared by both the Intuit page-level path (scripts/pzn.js `runPersonalizationPage`)
// and the plugin-driven decisions-manifest path (scripts/personalization/byo.js
// `resolveDecisions`), so both target the engine on the same enrichment.

const PROFILE_STORAGE_KEY = 'intuit.marketingProfile';
const PROFILE_TIMEOUT_MS = 500;

const MARKETING_PROFILE_QUERY = `query MarketingProfile($input: MarketingProfileInput!) {
  marketingProfile(input: $input) {
    resonate { segments }
    aep { segments }
    neustar { segments est_hh_income dob gender marital_status occupation occupation_group }
    zoominfo { zi_c_industry_primary zi_c_employees zi_c_revenue zi_c_estimated_age zi_c_keywords zi_c_country zi_c_city zi_c_state }
  }
}`;

// Contract cookies forwarded in the GraphQL input. The kndctr Adobe identity cookies
// carry an org-specific id in their name, so they're matched by suffix, not exact name.
const PROFILE_COOKIE_NAMES = ['ivid', 'akid', 'ajs_user_id', 'coreId', 'ccpa'];
const PROFILE_COOKIE_SUFFIXES = ['_AdobeOrg_cluster', '_AdobeOrg_identity'];

let profilePromise;

// Same-origin source (resolved under /api by fetchDecision) chosen by hostname, or the
// absolute `zoominfo-endpoint` metadata override for direct testing.
export function zoominfoSource(host = (typeof window !== 'undefined' && window.location.hostname) || '') {
  const override = getMetadata('zoominfo-endpoint');
  if (override) return override;
  if (host === 'erp.intuit.com') return 'zoominfo';
  if (host === 'stage.erp.intuit.com') return 'e2e/zoominfo';
  return 'qa/zoominfo';
}

// The readable contract cookies as `[{ key, value }]`. HttpOnly cookies the browser
// can't see are omitted — Akamai/the service supplements them server-side.
function readProfileCookies() {
  const out = [];
  try {
    document.cookie.split(';').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!key) return;
      const wanted = PROFILE_COOKIE_NAMES.includes(key)
        || (key.startsWith('kndctr_') && PROFILE_COOKIE_SUFFIXES.some((s) => key.endsWith(s)));
      if (wanted) out.push({ key, value: decodeURIComponent(value) });
    });
  } catch {
    return out;
  }
  return out;
}

// The GraphQL `variables.input`. ipAddress is omitted — Akamai injects it from the real
// client IP (mirrors the geo handling in attributes.js).
function buildInput() {
  const input = {
    cookies: readProfileCookies(),
    org: 'sbseg',
    scope: 'qbo',
    purpose: 'mktg',
    newVisitor: true,
    visitorRegion: 'US',
    pageURL: window.location.href,
  };
  const ivid = resolveIvid();
  if (ivid) input.ivid = ivid;
  return input;
}

function readProfileCache() {
  try {
    return JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeProfileCache(entry) {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // storage full / disabled — the in-memory promise still serves this page load
  }
}

// Resolves the visitor's zoominfo firmographics (or null). Memoized per page load;
// cached in localStorage until the ivid changes. Only successes are cached, so a
// transient failure is retried on the next page rather than poisoning the cache.
export function getMarketingProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    const ivid = resolveIvid() || '';
    const cached = readProfileCache();
    if (cached && cached.ivid === ivid) return cached.profile?.zoominfo || null;
    const response = await fetchDecision(zoominfoSource(), {
      method: 'POST',
      body: { query: MARKETING_PROFILE_QUERY, variables: { input: buildInput() } },
      timeoutMs: PROFILE_TIMEOUT_MS,
    });
    const profile = response?.data?.marketingProfile;
    if (!profile) return null;
    writeProfileCache({ ivid, profile });
    return profile.zoominfo || null;
  })();
  return profilePromise;
}

// Test-only: drop the per-page-load memoization so each case starts clean.
export function resetMarketingProfile() {
  profilePromise = undefined;
}
