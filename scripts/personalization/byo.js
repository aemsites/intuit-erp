// Bring-your-own decision engine hooks for the vendored aem-experimentation
// plugin (plugins/experimentation/src/index.js). Two lanes share this file:
// - PZN (personalization): a published manifest sheet (`audience-manifest`
//   metadata) declares which selector maps to which PZN *placement* — the
//   manifest's `url` column is a placement id, a key into the Decision
//   Engine's batch response, NOT a fragment path. `resolveAudiences` issues
//   ONE batched `/pzn` call for every placement declared on the page and
//   caches each placement's returned fragment ref (`copyData.pznblock`);
//   `renderDecision` applies whatever got cached for THAT placement.
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
// name for authoring to map to content. So, compared to a naive BYO
// integration where the engine only answers "which cell/arm" and authoring
// owns "what content", this file inverts that:
//   - resolveAudiences / getAssignment don't just answer a yes/no or an arm
//     name — they make the real call and CACHE what the engine handed back.
//   - renderDecision never applies `decision.url` verbatim (under this model
//     it is only ever a placement id or a placeholder key, never markup) —
//     it looks up what got cached above and applies THAT instead.
// The plugin still owns discovery (the manifest / `Experiment` metadata),
// phase orchestration, exposure (rumTracking) and the QA overrides
// (`?audience=`, `?experiment=<id>/<arm>`) exactly as before — none of that
// changes here.
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

// --- PZN (placement/fragment) lane -----------------------------------------

// Demo-only stand-ins for the DE/PZN batch endpoint: candidate fragment refs
// per placement id (the manifest's `url` column — see drafts/pzn-manifest.json).
// The mock hands one back as `copyData.pznblock`, sticky per placement/visitor
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
 * True when a manifest row applies to the current page: no `page`/`pages`
 * column at all (applies everywhere), or an exact match. Mirrors the
 * plugin's own page filter in `getManifestEntriesForCurrentPage`
 * (plugins/experimentation/src/index.js) since this hook re-reads the same
 * manifest independently (see loadManifestPlacements below) rather than
 * receiving the plugin's already-filtered/parsed entries.
 * @param {Object} row a raw manifest row
 * @returns {Boolean} true when the row applies to the current page
 */
function manifestRowAppliesToPage(row) {
  const here = window.location.pathname;
  return (!row.page && !row.pages) || row.page === here || row.pages === here;
}

/**
 * Reads the page's `audience-manifest` sheet and collects every placement id
 * declared for the current page — the manifest's `url` column (a placement
 * id, not a fragment ref; see the header comment). Every selector on the page
 * shares this one manifest, so the full placement set is gathered once here
 * and batched in a single Decision Engine call (see resolvePznPlacementCache).
 * @returns {Promise<String[]>} the de-duplicated placement ids for this page,
 *   or `[]` when no manifest is configured or it can't be read
 */
async function loadManifestPlacements() {
  const manifestUrl = getMetadata('audience-manifest');
  if (!manifestUrl) return [];
  try {
    const url = new URL(manifestUrl, window.location.origin);
    const res = await fetch(url.pathname);
    if (!res.ok) return [];
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return [...new Set(
      rows.filter(manifestRowAppliesToPage).map((row) => row.url).filter(Boolean),
    )];
  } catch {
    return [];
  }
}

// Memoized once per page: resolves to a `Map<placement, pznblock>` built from
// a SINGLE batched `/pzn` call covering every placement the manifest declares
// for this page. Every selector's resolveAudiences call below awaits this
// same promise instead of each re-fetching the manifest and re-issuing the
// batch call (mirrors the one-call-per-page intent the prior per-endpoint
// memoized resolver had).
let pznPlacementCache = null;

/**
 * Does the actual PZN resolution work: reads the manifest for this page's
 * placements, issues ONE batched Decision Engine call for all of them
 * (falling back to a canned mock when the real endpoint is absent and the
 * page opts in via `pzn-mock`), and caches each placement's fragment ref.
 * A single batch call is preferred (and sufficient here — `buildBatchBody`
 * already accepts arbitrarily many placements in one request); there is no
 * per-placement fallback because there is no structural reason to need one.
 * @returns {Promise<Map<String, String>>} placement id -> fragment ref
 */
async function resolvePznPlacementCache() {
  const placements = await loadManifestPlacements();
  if (!placements.length) return new Map();
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
  const cache = new Map();
  if (response) {
    placements.forEach((placement) => {
      const fragment = pznFragment(recommendationOf(entryForSlot(response, placement)));
      if (fragment) cache.set(placement, fragment);
    });
  }
  return cache;
}

/**
 * BYO `resolveAudiences` hook. Despite the name (fixed by the plugin's call
 * site), this no longer resolves audience membership: under the frozen-API
 * model the Decision Engine returns CONTENT, not a cell name for a manifest
 * to map, so there is nothing to "resolve" per audience. Instead this makes
 * the one real decision (the batched `/pzn` call, memoized per page — see
 * resolvePznPlacementCache) and answers every requested `remote` name
 * truthily so the manifest's declared selectors proceed to renderDecision,
 * which applies whatever THAT SPECIFIC placement got back (or leaves the
 * default when it got nothing — see renderDecision below). Note that the
 * plugin's own `?audience=<name>` QA override (getResolvedAudiences in
 * plugins/experimentation/src/index.js) answers directly from the override
 * WITHOUT calling this hook when the override names a configured audience
 * (e.g. `?audience=remote`) — renderDecision lazily starts the very same
 * batched resolution in that case, so a placement still resolves real content
 * either way (see renderDecision below). The plugin also calls this with a
 * second `context` argument (the shared decision context); it is unused here
 * since the batched call's attributes are already sourced from the page
 * itself (see attributes.js buildPznAttributes). Never throws — resolves `{}`
 * (no selector proceeds) on any failure, same as a real audience miss.
 * @param {String[]} names the candidate names configured for the current
 *   selector — always `['remote']` for this manifest (see
 *   drafts/pzn-manifest.json): a fixed marker meaning "this selector's
 *   content comes from the live engine", not a real audience to test
 *   membership in
 * @returns {Promise<{[name]: Boolean}>} truthy for every requested `remote`
 *   name once the batched call has run and found at least one recommendation
 *   on the page, or `{}` on a miss/failure
 */
export async function resolveAudiences(names) {
  try {
    if (!Array.isArray(names) || !names.length) return {};
    if (!pznPlacementCache) pznPlacementCache = resolvePznPlacementCache();
    const cache = await pznPlacementCache;
    if (!cache.size) return {};
    return names.reduce((resolved, name) => {
      if (name === 'remote') resolved[name] = true;
      return resolved;
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
 * THIS experiment. That override forces which arm the PLUGIN selects, but it
 * bypasses getAssignment entirely (same "answer without calling the hook"
 * shape as the `?audience=` override above) — so under the frozen-API model,
 * where content only shows up when the ENGINE actually returns it for an
 * arm, a forced `challenger-1` would otherwise have no engine content to
 * render. Letting the mock also see this override keeps the demo meaningful:
 * `?experiment=<id>/challenger-1` deterministically shows the engine's
 * variation content instead of only flipping plugin-side dataset/RUM
 * attribution. A real engine has no notion of this browser-only override, of
 * course — it would answer whatever it always answers.
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

// Populated by getAssignment (or renderDecision's fallback below), read by
// renderDecision: experimentId -> the engine's own variation content ref
// (`assetLocation`, or a redirect payload's path — see ixpContentPath). No
// entry means the engine gave no content for this experiment (a failure, or
// a genuine control arm — which the plugin never routes to renderDecision in
// the first place, see createModificationsHandler), so renderDecision leaves
// the control content in place.
const ixpContentCache = new Map();

// Memoized once per experiment id: resolves to the raw IXP assignment record
// (or null). Shared by getAssignment and renderDecision's fallback (see
// below) so an experiment whose arm was forced via the plugin's own
// `?experiment=<id>/<arm>` override — which bypasses getAssignment entirely —
// still gets exactly ONE real/mock call, made lazily from renderDecision
// instead, rather than either double-calling or never calling at all.
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
 * frozen-API inversion), and reports the arm. The plugin also calls this
 * with a second `context` argument; it is unused here since the frozen
 * `/ixp` contract is a GET keyed only by experimentId/label + ivid (see
 * attributes.js ixpParams), with no room for the page url/consent flag.
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
 * content — never `decision.url` verbatim, which under the frozen-API model
 * is only ever a KEY (a PZN placement id) or a placeholder (an IXP variant
 * href), not markup — see the header comment. Shared by both lanes; `scope`
 * (always one of `fragment` / `section` / `page`, see
 * plugins/experimentation/src/index.js `applyDecision`) still picks the swap
 * strategy, exactly as before — only the URL/content *source* changed:
 * - `fragment` (PZN, manifest-driven, applied post-decoration via a
 *   MutationObserver): `decision.url` is the placement id; look up its
 *   cached `pznblock` (populated by resolveAudiences's batched call above —
 *   lazily started here too, in case the plugin's own `?audience=<name>`
 *   override answered resolveAudiences without ever calling it) and apply it
 *   with `applyFragment` — the same fail-open fragment-swap helper the Intuit
 *   pzn.js/exp.js paths already use. No recommendation for this placement (a
 *   real miss) -> leave the default authored content in place.
 * - `section` / `page` (IXP, native-authoring, applied pre-decoration): look
 *   up the content getAssignment stashed for `decision.config.id` (the
 *   experiment id), falling back to resolving it right here (memoized — see
 *   resolveIxpAssignment) when getAssignment was bypassed entirely (the
 *   plugin's own `?experiment=<id>/<arm>` override, or a metadata-forced
 *   variant), and apply it with `applyRawFragment` above (to avoid
 *   double-decorating — see its doc comment). No content either way (a real
 *   failure, or a genuine control answer) -> leave control.
 * Never throws — a failed/missing lookup just leaves the target's existing
 * (default/control) content in place.
 * @param {HTMLElement} el the element to update (the matched selector's
 *   element, or the section/page root for an experiment)
 * @param {{url: String, scope: String, config: Object}} decision the resolved
 *   decision; `url` is now a KEY (a placement id or a placeholder), never
 *   markup — see the header comment
 * @returns {Promise<void>}
 */
export async function renderDecision(el, decision) {
  try {
    if (decision?.scope === 'section' || decision?.scope === 'page') {
      const experimentId = decision?.config?.id;
      let contentPath = experimentId ? ixpContentCache.get(experimentId) : undefined;
      if (!contentPath && experimentId) {
        const assignment = await resolveIxpAssignment(experimentId);
        contentPath = assignment ? ixpContentPath(assignment) : null;
      }
      if (contentPath) await applyRawFragment(el, contentPath);
      return;
    }
    if (!pznPlacementCache) pznPlacementCache = resolvePznPlacementCache();
    const cache = await pznPlacementCache;
    const pznblock = cache.get(decision?.url);
    if (pznblock) await applyFragment(el, pznblock);
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
