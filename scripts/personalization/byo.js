// Bring-your-own decision engine hooks for the vendored aem-experimentation
// plugin (plugins/experimentation/src/index.js). Two lanes share this file:
// - PZN (personalization): a published manifest sheet (`decisions-manifest`
//   metadata) declares which selector maps to which PZN *placement* (a
//   `placement` column — a key into the Decision Engine's batch response,
//   NOT a fragment path). The plugin's own `serveDecisions` reads that
//   manifest and calls `resolveDecisions` below ONCE for every row on the
//   page; this hook issues ONE batched `/pzn` call for every distinct
//   placement declared and returns `{ [selector]: { url: pznblock } }`
//   directly — the plugin applies each selector's returned fragment itself
//   (see `renderDecision`'s fragment branch below), no cache/lookup needed on
//   this lane.
// - IXP (experiment-assignment): a natively-authored `Experiment` /
//   `Experiment Variants` block still owns *whether* an experiment runs, but
//   the authored variant "url" is now just a placeholder key (see
//   ixp-demo.html) — `getAssignment` calls the `/ixp` endpoint, reports the
//   arm (control/challenger) the engine picked, and stashes the engine's OWN
//   variation content (`assetLocation`, or a redirect payload's path);
//   `renderDecision` applies THAT stashed content.
//
// This is the frozen-API model: Intuit's decision APIs return CONTENT (a
// fragment ref, or a variation asset/redirect path) rather than a cell/arm
// name for authoring to map to content. The IXP lane still needs the
// inversion this implies (compared to a naive BYO integration where the
// engine only answers "which cell/arm" and authoring owns "what content"):
//   - getAssignment doesn't just answer an arm name — it makes the real call
//     and CACHES what the engine handed back so renderDecision can apply it.
//   - renderDecision never applies an IXP decision's `url` verbatim (it is
//     only ever a placeholder key on that lane) — it looks up what got
//     cached above and applies THAT instead.
// The PZN lane needs no such inversion: `resolveDecisions` hands back the
// real fragment ref directly (`{ [selector]: { url } }`), which is exactly
// the shape the plugin's `serveDecisions` (and this file's `renderDecision`
// fragment branch) already expect — see
// plugins/experimentation/documentation/byo-decision-engine.md.
//
// The plugin still owns discovery (the manifest / `Experiment` metadata),
// phase orchestration, exposure (rumTracking) and the QA overrides
// (`?audience=`, `?experiment=<id>/<arm>`) as before, with one addition: the
// overrides now still invoke the configured hook for its resolution
// side-effect even though the override itself wins the plugin's own
// selection (see plugins/experimentation/src/index.js `getResolvedAudiences`
// / `getExperimentConfig`) — so `getAssignment` always runs when configured,
// and this file no longer needs a lazy fallback to resolve IXP content under
// a forced arm (see renderDecision below). `resolveDecisions` has no
// override to bypass, so the PZN lane is unaffected by this.
//
// All hooks are fail-open and must never throw out of the plugin's call site
// (see plugins/experimentation/src/index.js `getResolvedAudiences` /
// `getExternalAssignment` / `applyDecision` / `fireRUM`, which already guard
// their calls to these hooks — this file adds its own guards too, matching
// the fail-open style used throughout scripts/personalization/*.js).
//
// Demo mocks: `aem up --html-folder drafts` can't serve `/api/*`, so when the
// real endpoint is absent (fetchDecision's fail-open `null`) AND the page
// opts in via a `pzn-mock` / `ixp-mock` metadata, a canned response shaped
// exactly like the real DE/PZN or IXP payload stands in — so the demo
// exercises the REAL parse+apply path (pzn-response.js / ixp-response.js),
// not a shortcut. Production pages never set that metadata, so none of this
// runs there; a real endpoint, when present, always wins over the mock.

import { getMetadata } from '../aem.js';
// eslint-disable-next-line import/no-cycle
import { applyFragment, fetchDecision, fragmentPath } from './decision.js';
import { buildBatchBody, resolveIvid, ixpParams } from './attributes.js';
import { entryForSlot, recommendationOf, pznFragment } from './pzn-response.js';
import { ixpContentPath } from './ixp-response.js';
// Reuse the project's own marketing-profile enrichment (ZoomInfo firmographics
// etc.) so the plugin-driven batch targets on the same attributes scripts/pzn.js
// does — memoized + fail-open there, so this adds no second network call and a
// miss just sends the batch unenriched.
// eslint-disable-next-line import/no-cycle
import { getMarketingProfile } from '../pzn.js';

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
 *   shape in the header comment), or null when this placement has no mock
 *   candidates configured (mirrors a real 204/no-offer miss)
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
function mockPznBatchResponse(placements) {
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

/**
 * BYO `resolveDecisions` hook: the plugin's decisions-manifest lane (see
 * `serveDecisions` in plugins/experimentation/src/index.js) hands us every
 * row declared for the current page in ONE call — each row carries this
 * integration's own `placement` column (see drafts/pzn-manifest.json), a key
 * into the Decision Engine's batch response, NOT a fragment path. This makes
 * ONE batched Decision Engine call for every distinct placement across those
 * rows (falling back to a canned mock when the real endpoint is absent and
 * the page opts in via `pzn-mock`), then maps each row's OWN placement back
 * to its fragment ref. Unlike the audience-manifest lane this replaces, the
 * plugin applies the returned fragment itself — there is no cache for
 * `renderDecision` to look up on this lane anymore (see its fragment branch
 * below). The plugin also calls this with a second `context` argument; it is
 * unused here for the same reason as the other hooks in this file — the
 * batched call's attributes are already sourced from the page itself (see
 * attributes.js buildPznAttributes). Never throws — resolves `{}` (no
 * selector proceeds; every slot keeps its default authored content) on any
 * failure.
 * @param {Object[]} entries the decisions-manifest rows for this page, each
 *   with at least `selector` and this integration's own `placement` column
 * @returns {Promise<{[selector: string]: {url: String}}>} the resolved
 *   fragment per selector, or `{}` on a miss/failure
 */
export async function resolveDecisions(entries) {
  try {
    if (!Array.isArray(entries) || !entries.length) return {};
    const placements = [...new Set(entries.map((entry) => entry.placement).filter(Boolean))];
    if (!placements.length) return {};
    // Enrich the batch attributes with the visitor's marketing profile (ZoomInfo
    // firmographics etc.), exactly as scripts/pzn.js does, so the engine decides on
    // the same inputs on both paths. Fail-open (null) → the batch goes unenriched.
    const zoominfo = await getMarketingProfile();
    let response = await fetchDecision('pzn', {
      method: 'POST',
      body: buildBatchBody(placements, undefined, zoominfo || {}),
    });
    if (!response && getMetadata('pzn-mock') === 'true') {
      response = mockPznBatchResponse(placements);
    }
    if (!response) return {};
    return entries.reduce((decisions, entry) => {
      const fragment = pznFragment(recommendationOf(entryForSlot(response, entry.placement)));
      if (fragment) decisions[entry.selector] = { url: fragment };
      return decisions;
    }, {});
  } catch {
    return {};
  }
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
 * call still runs — see the header comment). Letting the mock ALSO read this
 * override keeps the demo meaningful and internally consistent: without it,
 * the mock could independently stick to a DIFFERENT arm than the one the
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
 * like the real `/ixp` endpoint (see the header comment) so ixp-response.js's
 * `isReplace`/`ixpContentPath` exercise the same parse path a real Intuit
 * answer would.
 * @param {String} experimentId the experiment id
 * @returns {{ivid: String, transactionId: String, assignments: Object[]}}
 */
function mockIxpResponse(experimentId) {
  return {
    ivid: resolveIvid() || null,
    transactionId: `mock-${Date.now()}`,
    assignments: [mockIxpAssignment(experimentId)],
  };
}

// Populated by getAssignment, read by renderDecision: experimentId -> the
// engine's own variation content ref (`assetLocation`, or a redirect
// payload's path — see ixpContentPath). getAssignment always runs now — the
// plugin invokes it even under a forced `?experiment=<id>/<arm>` override
// (see plugins/experimentation/src/index.js and the header comment) — so
// this cache is always populated by the time renderDecision runs. No entry
// means the engine gave no content for this experiment (a failure, or a
// genuine control arm — which the plugin never routes to renderDecision in
// the first place, see createModificationsHandler), so renderDecision leaves
// the control content in place.
const ixpContentCache = new Map();

// Memoized once per experiment id: resolves to the raw IXP assignment record
// (or null). getAssignment is invoked once per metadata block that names an
// experiment id — page-level, each section-level block, and (since the
// plugin's `?experiment=<id>/<arm>` override now still invokes the hook for
// its resolution side-effect rather than bypassing it) even under a forced
// arm — so this memoization keeps multiple blocks/invocations referencing the
// SAME experiment id down to exactly ONE real/mock call.
const ixpAssignmentCache = new Map();

/**
 * Does the actual IXP resolution work for one experiment: calls the `/ixp`
 * endpoint, falling back to a canned mock when the real endpoint is absent
 * and the page opts in via `ixp-mock`.
 * @param {String} experimentId the experiment id
 * @returns {Promise<Object|null>} the raw assignment record, or null on any
 *   miss/failure
 */
function resolveIxpAssignment(experimentId) {
  if (!ixpAssignmentCache.has(experimentId)) {
    ixpAssignmentCache.set(experimentId, (async () => {
      try {
        let response = await fetchDecision(`ixp?${ixpParams(experimentId)}`);
        if (!response && getMetadata('ixp-mock') === 'true') {
          response = mockIxpResponse(experimentId);
        }
        return response?.assignments?.[0] || null;
      } catch {
        return null;
      }
    })());
  }
  return ixpAssignmentCache.get(experimentId);
}

/**
 * BYO `getAssignment` hook: resolves this experiment's assignment (memoized —
 * see resolveIxpAssignment), stashes the engine's OWN variation content so
 * renderDecision has something to apply (see the header comment on the
 * frozen-API inversion), and reports the arm. Now called on EVERY invocation
 * of getExperimentConfig for an experiment this hook is configured for —
 * including when the plugin's own `?experiment=<id>/<arm>` override forces
 * the arm — so content is stashed before renderDecision ever needs it,
 * whether or not the override wins the plugin's own selection. The plugin
 * also calls this with a second `context` argument; it is unused here since
 * the frozen `/ixp` contract is a GET keyed only by experimentId/label + ivid
 * (see attributes.js ixpParams), with no room for the page url/consent flag.
 * Never throws — resolves `null` (self-bucket) on any failure, in which case
 * nothing is stashed either (see renderDecision's "no stashed content ->
 * leave control" behavior).
 * @param {String} experimentId the experiment id (the page/section
 *   `Experiment` metadata value)
 * @returns {Promise<String|null>} `control`/`challenger-1`, or `null` to let
 *   the plugin self-bucket
 */
export async function getAssignment(experimentId) {
  try {
    if (!experimentId) return null;
    const assignment = await resolveIxpAssignment(experimentId);
    if (!assignment) return null;
    const contentPath = ixpContentPath(assignment);
    if (contentPath) {
      ixpContentCache.set(experimentId, contentPath);
    } else {
      ixpContentCache.delete(experimentId);
    }
    return assignment.control ? 'control' : 'challenger-1';
  } catch {
    return null;
  }
}

/**
 * Swaps `el`'s content for the RAW (undecorated) markup at `ref`, without
 * running the fragment-loading decoration pass (`decorateMain` + `loadSections`
 * — see `loadFragment` in blocks/fragment/fragment.js). Used for page/section
 * scope decisions (see renderDecision below): those swaps land BEFORE the
 * page's own `decorateMain` (scripts/scripts.js `loadEager` calls
 * `runExperimentation` ahead of `decorateMain`), so the normal top-level
 * decoration pass decorates this content exactly once on its own. Pre-decorating
 * it here too (as `applyFragment` does) would leave a decorated `.section` div
 * nested inside `el`, which the page's own `decorateSections` would then wrap
 * a second time — and `decorateBlocks` would misread that inner `.section` div
 * as a block literally named "section" (`data-block-name="section"`), triggering
 * a failed dynamic import of a nonexistent `blocks/section/section.js` (harmless
 * to rendered content, but console noise). Mirrors `swapMain`
 * (scripts/personalization/decision.js) — which the existing Intuit
 * pzn.js/exp.js page-level swap already relies on for the very same
 * pre-decoration timing — generalized to an arbitrary element rather than only
 * `<main>`, since a section-scope decision targets a section, not the page.
 * @param {HTMLElement} el the element whose content to replace
 * @param {String} ref the fragment path to fetch (`.plain.html` is appended)
 * @returns {Promise<Boolean>} true when the swap landed
 */
async function applyRawFragment(el, ref) {
  const path = fragmentPath(ref);
  if (!el || !path) return false;
  const resp = await fetch(`${path}.plain.html`);
  if (!resp.ok) return false;
  el.innerHTML = await resp.text();
  return true;
}

/**
 * BYO `renderDecision` hook: applies the winning decision's ENGINE-provided
 * content. Shared by both lanes; `scope` (always one of `fragment` /
 * `section` / `page`, see plugins/experimentation/src/index.js
 * `applyDecision`) picks the swap strategy:
 * - `fragment` (PZN, decisions-manifest-driven, applied post-decoration via a
 *   MutationObserver): `decision.url` is now the real fragment ref that
 *   `resolveDecisions` above already resolved for this selector — no
 *   cache/lookup needed on this lane anymore (see the header comment) — so
 *   apply it directly with `applyFragment`, the same fail-open fragment-swap
 *   helper the Intuit pzn.js/exp.js paths already use. No `url` (a real
 *   miss — `resolveDecisions` didn't answer for this selector) -> leave the
 *   default authored content in place.
 * - `section` / `page` (IXP, native-authoring, applied pre-decoration): look
 *   up the content getAssignment stashed for `decision.config.id` (the
 *   experiment id) — getAssignment always runs now, even under the plugin's
 *   own `?experiment=<id>/<arm>` override (see the header comment), so this
 *   cache is always populated by the time renderDecision runs — and apply it
 *   with `applyRawFragment` above (to avoid double-decorating — see its doc
 *   comment). No content (a real failure, or a genuine control answer) ->
 *   leave control.
 * Never throws — a failed/missing lookup just leaves the target's existing
 * (default/control) content in place.
 * @param {HTMLElement} el the element to update (the matched selector's
 *   element, or the section/page root for an experiment)
 * @param {{url: String, scope: String, config: Object}} decision the resolved
 *   decision
 * @returns {Promise<void>}
 */
export async function renderDecision(el, decision) {
  try {
    if (decision?.scope === 'section' || decision?.scope === 'page') {
      const experimentId = decision?.config?.id;
      const contentPath = experimentId ? ixpContentCache.get(experimentId) : undefined;
      if (contentPath) await applyRawFragment(el, contentPath);
      return;
    }
    if (decision?.url) await applyFragment(el, decision.url);
  } catch {
    // fail-open — leave the default/control content in place
  }
}

/**
 * BYO `rumTracking` hook: records plugin exposure events onto `window.appVars`
 * for analytics pickup, mirroring the appVars arrays the Intuit path already
 * seeds (see scripts/scripts.js `pznRecDetailsArr` / `ixpDetailsArr`). Minimal by
 * design — this is the demo's exposure sink, not a full analytics pipeline.
 * Never throws.
 * @param {{type: String, source: String, target: String}} event the RUM event
 *   fired by the plugin (audience/experiment/campaign exposure)
 * @returns {void}
 */
export function rumTracking(event) {
  try {
    const appVars = window.appVars || (window.appVars = {});
    appVars.pznPluginExposureArr = appVars.pznPluginExposureArr || [];
    appVars.pznPluginExposureArr.push({ type: event?.type, target: event?.target });
  } catch {
    // never throw out of a RUM hook
  }
}
