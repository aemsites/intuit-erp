// Demo-only stand-ins for the real Decision Engine (`/pzn`) and IXP (`/ixp`)
// endpoints. `aem up --html-folder drafts` can't serve `/api/*`, so when the
// real endpoint is absent (fetchDecision's fail-open `null`) AND the page
// opts in via a `pzn-mock` / `ixp-mock` metadata, byo.js dynamically imports
// this module and asks it for a canned response shaped exactly like the real
// DE/PZN or IXP payload — so the demo exercises the REAL parse+apply path
// (pzn-response.js / ixp-response.js), not a shortcut. Production pages never
// set that metadata, so byo.js never reaches the `import()` that would load
// this file there — see byo.js's `resolveDecisions` / `resolveIxpAssignment`.

import { resolveIvid } from './attributes.js';

/**
 * Reads a cookie value.
 * @param {String} name the cookie name
 * @returns {String|null} the cookie value, or null when absent/unreadable
 */
function readCookie(name) {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Writes a cookie value (30 day expiry, site-wide path).
 * @param {String} name the cookie name
 * @param {String} value the cookie value
 * @returns {void}
 */
function writeCookie(name, value) {
  try {
    const maxAge = 30 * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    // demo mock only — a failed write just means the next resolution re-picks
  }
}

// --- PZN (decisions-manifest → placement/fragment) lane ---------------------

// Demo-only stand-ins for the DE/PZN batch endpoint: candidate fragment refs
// per placement id (the manifest's `placement` column — see
// drafts/pzn-manifest.json). The mock hands one back as `copyData.pznblock`,
// sticky per placement/visitor
// (see mockPznRecommendation), so a reload shows a consistent but swappable
// "engine decision" per slot — the same UX the old sticky-cell mock had,
// moved from the manifest layer to the mock-engine layer.
const PZN_MOCK_CANDIDATES = {
  'pzn-hero-slot': [
    '/drafts/fragments/pzn/hero-retail',
    '/drafts/fragments/pzn/hero-hospitality',
  ],
  'pzn-offer-slot': [
    '/drafts/fragments/pzn/offer-retail',
    '/drafts/fragments/pzn/offer-hospitality',
  ],
};

const PZN_MOCK_COOKIE_PREFIX = 'pzn-mock-';

/**
 * Picks (and sticks) one of a placement's mock candidate fragment refs and
 * wraps it as a recommendation object shaped like a real DE/PZN entry.
 * @param {String} placement the placement id
 * @returns {Object|null} a `recommendation[]` element (see the real payload
 *   shape in byo.js's header comment), or null when this placement has no
 *   mock candidates configured (mirrors a real 204/no-offer miss)
 */
function mockPznRecommendation(placement) {
  const candidates = PZN_MOCK_CANDIDATES[placement];
  if (!candidates || !candidates.length) return null;
  const cookieName = `${PZN_MOCK_COOKIE_PREFIX}${placement}`;
  const sticky = readCookie(cookieName);
  const pznblock = (sticky && candidates.includes(sticky))
    ? sticky
    : candidates[Math.floor(Math.random() * candidates.length)];
  writeCookie(cookieName, pznblock);
  return {
    copyData: { pznblock, contentId: pznblock },
    placement,
    offerId: `mock-offer-${placement}`,
    experimentId: 'mock-experiment',
    treatmentId: 'mock-treatment',
  };
}

/**
 * Builds a canned DE/PZN batch response for the given placements, keyed
 * `<experience>_<placement>_<locale>` exactly like the real endpoint (see
 * pzn-response.js's header comment), so the parse path
 * (entryForSlot/recommendationOf/pznFragment) is exercised identically
 * whether the answer came from the real engine or this demo stand-in. A
 * placement with no mock candidates is simply omitted (same as a real miss).
 * @param {String[]} placements the placement ids to answer for
 * @returns {Object} a batch response object
 */
export function mockPznBatchResponse(placements) {
  return placements.reduce((response, placement) => {
    const rec = mockPznRecommendation(placement);
    if (rec) {
      response[`marketing_${placement}_en-US`] = {
        data: { recommendations: { recommendation: [rec] }, experimentAssignments: [] },
        placement,
        status: 200,
      };
    }
    return response;
  }, {});
}

// --- IXP (experiment-assignment) lane ---------------------------------------

// Demo-only stand-in variation content for the mock's challenger arm — reuses
// the very fragment the native `Experiment Variants` authoring used to point
// to directly; only its ROLE changed (the ENGINE's answer points to it now,
// not the authored metadata — see ixp-demo.html).
const IXP_MOCK_VARIANT_PATH = '/drafts/fragments/experiments/hero-challenger-1';
const IXP_MOCK_COOKIE_PREFIX = 'ixp-mock-';

/**
 * Reads the plugin's own `?experiment=<id>/<arm>` QA override (see
 * getExperimentConfig in plugins/experimentation/src/index.js) when it names
 * THIS experiment. That override still wins the PLUGIN's own arm selection,
 * but the plugin now also invokes getAssignment for its resolution
 * side-effect even under the override (so an engine that stashes content per
 * call still runs — see byo.js's header comment). Letting the mock ALSO read
 * this override keeps the demo meaningful and internally consistent: without
 * it, the mock could independently stick to a DIFFERENT arm than the one the
 * plugin selected, so `?experiment=<id>/challenger-1` would show the engine's
 * variation content only sometimes instead of deterministically. A real
 * engine has no notion of this browser-only override, of course — it would
 * answer whatever it always answers, which is an accepted, documented
 * characteristic of a real BYO integration (see
 * plugins/experimentation/documentation/byo-decision-engine.md).
 * @param {String} experimentId the experiment id
 * @returns {'control'|'challenger'|null} the forced arm, or null when no
 *   override names this experiment
 */
function forcedIxpArm(experimentId) {
  const raw = new URLSearchParams(window.location.search).get('experiment');
  if (!raw) return null;
  const [id, arm] = raw.split('/');
  if (id !== experimentId) return null;
  if (arm === 'control') return 'control';
  if (arm === 'challenger-1') return 'challenger';
  return null;
}

/**
 * Builds one canned assignment for an experiment, shaped exactly like a real
 * IXP `assignments[]` entry — REPLACE_WEB_CONTENT (section/block fidelity,
 * see ixp-response.js `isReplace`; a page-fidelity mock would instead use a
 * `REDIRECT` type with a `payload`, both already handled by `ixpContentPath`).
 * Sticky per experiment/visitor (cookie) when not overridden, mirroring the
 * old sticky-arm demo mock's UX.
 * @param {String} experimentId the experiment id
 * @returns {Object} an assignment record
 */
function mockIxpAssignment(experimentId) {
  const cookieName = `${IXP_MOCK_COOKIE_PREFIX}${experimentId}`;
  const forced = forcedIxpArm(experimentId);
  const sticky = readCookie(cookieName);
  let control;
  if (forced) {
    control = forced === 'control';
  } else if (sticky) {
    control = sticky === 'control';
  } else {
    control = Math.random() < 0.5;
  }
  writeCookie(cookieName, control ? 'control' : 'challenger');
  return {
    experimentId,
    experimentType: 'REPLACE_WEB_CONTENT',
    control,
    treatmentId: control ? 0 : 837766,
    treatmentKey: control ? 'CONTROL' : 'IXP1_T_837766',
    payload: null,
    assetLocation: control ? null : IXP_MOCK_VARIANT_PATH,
  };
}

/**
 * Builds a canned IXP response envelope for one experiment, shaped exactly
 * like the real `/ixp` endpoint (see byo.js's header comment) so
 * ixp-response.js's `isReplace`/`ixpContentPath` exercise the same parse path
 * a real Intuit answer would.
 * @param {String} experimentId the experiment id
 * @returns {{ivid: String, transactionId: String, assignments: Object[]}}
 */
export function mockIxpResponse(experimentId) {
  return {
    ivid: resolveIvid() || null,
    transactionId: `mock-${Date.now()}`,
    assignments: [mockIxpAssignment(experimentId)],
  };
}
