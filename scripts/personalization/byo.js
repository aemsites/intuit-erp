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
// opts in via a `pzn-mock` / `ixp-mock` metadata, this file dynamically
// `import()`s ./byo-mock.js for a canned response shaped exactly like the
// real DE/PZN or IXP payload — so the demo exercises the REAL parse+apply
// path (pzn-response.js / ixp-response.js), not a shortcut. Production pages
// never set that metadata, so that `import()` is never reached there — the
// mock module (and its cookie helpers) never even loads in production; a
// real endpoint, when present, always wins over the mock regardless.

import { getMetadata } from '../aem.js';
// eslint-disable-next-line import/no-cycle
import { applyFragment, fetchDecision, fragmentPath } from './decision.js';
import { buildBatchBody, ixpParams } from './attributes.js';
import {
  entryForSlot, recommendationOf, pznFragment, pznRecord,
} from './pzn-response.js';
import { ixpContentPath } from './ixp-response.js';
// Reuse the project's own marketing-profile enrichment (ZoomInfo firmographics
// etc.) so the plugin-driven batch targets on the same attributes scripts/pzn.js's
// runPersonalizationPage does — memoized + fail-open there, so this adds no second
// network call and a miss just sends the batch unenriched.
// eslint-disable-next-line import/no-cycle
import { getMarketingProfile } from './marketing-profile.js';
import { registerRegionContext } from './tracking-context.js';

// --- PZN (decisions-manifest → placement/fragment) lane ---------------------

// Populated by resolveDecisions, read by renderDecision: selector -> this
// selector's click-attribution params (see pznTrackingParams below), captured
// off the SAME recommendation that produced the fragment so the click channel
// (region-context registry — see tracking-context.js) agrees with whatever
// content actually got swapped in.
const pznContextCache = new Map();

/**
 * Builds a selector's click-attribution params from its recommendation (the
 * same object `resolveDecisions` already read the fragment off of), for the
 * region-context registry (tracking-context.js) — never DOM attributes.
 * Prefers the normalized pzn-response.js record (`pznRecord`) when the
 * recommendation is a real personalized offer (its `accessPoint && id`
 * guard); falls back to the raw fields otherwise, since the demo mock's
 * recommendation (see byo-mock.js `mockPznRecommendation`) has neither and so
 * never satisfies that guard.
 * @param {Object} rec the recommendation object (see pzn-response.js), never
 *   null — callers only invoke this once a fragment was resolved from it
 * @param {String} placement this entry's own placement id (fallback for a
 *   recommendation that doesn't echo its own `placement` field)
 * @returns {Object} the tracking params for this selector
 */
function pznTrackingParams(rec, placement) {
  const record = pznRecord(rec);
  if (record) return { ...record };
  return {
    offerId: rec.offerId,
    experimentId: rec.experimentId,
    treatmentId: rec.treatmentId,
    placement: rec.placement || placement,
  };
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
      const { mockPznBatchResponse } = await import('./byo-mock.js');
      response = mockPznBatchResponse(placements);
    }
    if (!response) return {};
    return entries.reduce((decisions, entry) => {
      const rec = recommendationOf(entryForSlot(response, entry.placement));
      const fragment = pznFragment(rec);
      if (fragment) {
        decisions[entry.selector] = { url: fragment };
        pznContextCache.set(entry.selector, pznTrackingParams(rec, entry.placement));
      }
      return decisions;
    }, {});
  } catch {
    return {};
  }
}

// --- IXP (experiment-assignment) lane ---------------------------------------

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

// Populated by getAssignment, read by renderDecision: experimentId -> this
// experiment's click-attribution identity, captured off the SAME assignment
// that produced the stashed content above so the click channel (region-
// context registry — see tracking-context.js) agrees with it. Unlike
// ixpContentCache, this is set for BOTH arms (control included — exposure
// still matters for a control region), even though renderDecision only ever
// consumes it on the challenger path (see the "plugin never routes [control]
// to renderDecision" note above).
const ixpContextCache = new Map();

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
          const { mockIxpResponse } = await import('./byo-mock.js');
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
 * Also captures the assignment's click-attribution identity into
 * ixpContextCache (see its own comment above) for renderDecision to publish
 * via registerRegionContext — same "always runs" reasoning applies, so this
 * is populated by the time renderDecision runs too.
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
    ixpContextCache.set(experimentId, {
      experimentId,
      treatmentId: assignment.treatmentId,
      treatmentKey: assignment.treatmentKey,
      control: assignment.control,
    });
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
 *
 * Unlike the (kept) page-level pzn.js/exp.js paths, this hook does NOT stamp
 * `data-pzn`/`data-experiment` attributes or record window.appVars entries
 * for the applied content — section/block click attribution is published to
 * the region-context registry instead (registerRegionContext, see
 * tracking-context.js), keyed off the element that content just landed on.
 * The click-tracking runtime (Option B, clicktrack-optionb branch) resolves
 * the nearest registered ancestor at interaction time and folds it into
 * `custom_properties`; no DOM stamping happens on this path.
 * @param {HTMLElement} el the element to update (the matched selector's
 *   element, or the section/page root for an experiment)
 * @param {{url: String, scope: String, config: Object, selector: String}}
 *   decision the resolved decision
 * @returns {Promise<void>}
 */
export async function renderDecision(el, decision) {
  try {
    if (decision?.scope === 'section' || decision?.scope === 'page') {
      const experimentId = decision?.config?.id;
      const contentPath = experimentId ? ixpContentCache.get(experimentId) : undefined;
      if (contentPath && await applyRawFragment(el, contentPath)) {
        const ctx = ixpContextCache.get(experimentId);
        if (ctx) registerRegionContext(el, { source: 'ixp', ...ctx });
      }
      return;
    }
    if (decision?.url && await applyFragment(el, decision.url)) {
      const ctx = decision.selector ? pznContextCache.get(decision.selector) : null;
      if (ctx) registerRegionContext(el, { source: 'pzn', ...ctx });
    }
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
