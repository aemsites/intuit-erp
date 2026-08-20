import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, applyFragment, swapMain } from './personalization/decision.js';
import {
  entryForSlot, recommendationOf, pznRecord, pznFragment,
} from './personalization/pzn-response.js';
import { recordPzn, recordPznPage } from './personalization/analytics.js';
import { stampPzn } from './personalization/stamp.js';
import { buildBatchBody, resolveIvid } from './personalization/attributes.js';

// --- Marketing-profile (ZoomInfo) enrichment -------------------------------
// Intuit's marketing-mesh GraphQL service returns firmographics for the visitor;
// we merge the `zoominfo` fields into the pzn attributes so the decision can target
// on them. Akamai fronts the call same-origin (injecting the key + client IP) via a
// hostname-selected path; a `zoominfo-endpoint` metadata override hits a URL directly
// (testing). Fetched at most once per visitor and cached in localStorage until the
// ivid changes; 500ms budget, fully fail-open (null → pzn runs unenriched).

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

// True when a section's data-pzn and data-exp aim at the SAME target — both whole-
// section, or both the same named block. That's the case where IXP takes precedence
// (Req 4); pzn and exp scoped to different blocks are independent and both run.
function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Sections tagged `data-pzn` within `root` (root itself may match), minus `skip`.
// The placement id is the verbatim `data-pzn` value; a `data-pzn-block` scopes the
// target to the block in that section whose `data-block-name` matches (first),
// otherwise the whole section is the target. When the same target also carries an
// experiment (data-exp), IXP wins and the pzn slot is dropped (Req 4).
export function collectSlots(root, skip) {
  const sections = [];
  if (root.matches?.('[data-pzn]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-pzn]').forEach((s) => { if (s !== skip) sections.push(s); });

  const slots = [];
  sections.forEach((section) => {
    const placement = section.dataset.pzn;
    if (!placement) return;
    if (section.dataset.exp && sameTargetAsExp(section)) return;
    const block = section.dataset.pznBlock;
    const el = block ? section.querySelector(`[data-block-name="${block}"]`) : section;
    if (el) slots.push({ el, placement });
  });
  return slots;
}

export async function runPersonalization(root = document.querySelector('main'), { skip } = {}) {
  if (!root) return;
  const slots = collectSlots(root, skip);
  if (slots.length === 0) return;

  const placements = [...new Set(slots.map((s) => s.placement))];
  // Akamai passes the raw batch response through verbatim: an object keyed
  // `<experience>_<placement>_<locale>`. We build the full upstream request here
  // (buildBatchBody: batchItems + client attributes) and read each slot's
  // recommendation directly — the fragment ref (copyData.contentId) for the swap,
  // and the full recommendation for the analytics record.
  const zoominfo = await getMarketingProfile();
  const response = await fetchDecision('pzn', {
    method: 'POST',
    body: buildBatchBody(placements, undefined, zoominfo || {}),
  });
  if (!response || typeof response !== 'object') return;

  // Primary work (LCP path): apply the DOM swaps first.
  const applications = [];
  const records = [];
  placements.forEach((placement) => {
    const rec = recommendationOf(entryForSlot(response, placement));
    if (!rec) return;
    const record = pznRecord(rec);
    if (record) records.push(record);
    const fragment = pznFragment(rec);
    if (!fragment) return;
    const key = placement.toLowerCase();
    // Apply to every slot sharing this placement; stamp the offer identity once the
    // swap lands (stamp.js) for click attribution.
    slots
      .filter((s) => s.placement.toLowerCase() === key)
      .forEach((slot) => {
        // OF1 opt-in: a section tagged `of1-personalization: enabled` asks the
        // edge proxy to personalize the injected fragment. Signal it with an
        // `__of1p` path suffix the proxy strips before fetching the real fragment.
        const ref = slot.el.closest('[data-of1-personalization="enabled"]')
          ? `${fragment}__of1p`
          : fragment;
        applications.push(
          applyFragment(slot.el, ref).then((applied) => {
            if (applied && record) stampPzn(slot.el, record);
          }),
        );
      });
  });
  await Promise.all(applications);

  // Analytics trails the swap (idle-deferred inside recordPzn) — never blocks LCP.
  recordPzn(records);
}

// Whole-page personalization: swaps <main> before decoration for a page tagged with
// `personalization-id` metadata (the page-level placement). Mirrors exp.js
// `runExperiment` — a single placement resolved to a whole-page variant fragment,
// bounded by one shared deadline so a slow decision can't land after decoration.
export async function runPersonalizationPage(doc = document) {
  const placement = getMetadata('personalization-id');
  if (!placement) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const zoominfo = await getMarketingProfile();
    const response = await fetchDecision('pzn', {
      method: 'POST',
      body: buildBatchBody([placement], undefined, zoominfo || {}),
      signal: controller.signal,
    });
    if (!response || typeof response !== 'object') return;
    const rec = recommendationOf(entryForSlot(response, placement));
    if (!rec) return;
    const record = pznRecord(rec);
    const fragment = pznFragment(rec);
    // Primary work (LCP path): swap the whole page first, then stamp <main> for the
    // click channel (parity with runExperiment's stampExperiment).
    if (fragment && await swapMain(doc, fragment, controller.signal) && record) {
      stampPzn(doc.querySelector('main'), record);
    }
    // Analytics trails the swap — idle-deferred inside recordPznPage.
    if (record) recordPznPage([record]);
  } finally {
    clearTimeout(timer);
  }
}
