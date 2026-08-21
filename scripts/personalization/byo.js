// Bring-your-own decision-engine hooks for the vendored aem-experimentation plugin
// (plugins/experimentation/src/index.js). Frozen-API model: Intuit's APIs return CONTENT
// (a fragment ref, or a variation asset/redirect path), NOT a cell/arm name for authoring
// to map — see plugins/experimentation/documentation/byo-decision-engine.md.
//
// Two lanes:
// - PZN: the plugin's `serveDecisions` reads a `decisions-manifest` sheet (selector ->
//   placement) and calls resolveDecisions once; this issues ONE batched /pzn call and
//   returns `{ [selector]: { url: pznblock } }` for the plugin to apply directly.
// - IXP: a native `Experiment` block gates the experiment; getAssignment calls /ixp,
//   reports the arm, and STASHES the engine's variation content; renderDecision applies
//   the stash (the authored variant "url" is only a placeholder key on this lane).
//
// The plugin owns discovery, phase orchestration, exposure (rumTracking), and QA overrides
// — which now also invoke the hook for its side-effect, so getAssignment always runs and
// no lazy fallback is needed. All hooks are fail-open (never throw out of the plugin).
//
// Demo mocks: when /api/* is absent (local `aem up`) and the page sets pzn-mock/ixp-mock,
// byo-mock.js supplies a canned payload shaped like the real one (so the real parse/apply
// path still runs). Production never sets that metadata, so the mock never loads there.

import { getMetadata } from '../aem.js';
// eslint-disable-next-line import/no-cycle
import { applyFragment, fetchDecision, fragmentPath } from './decision.js';
import { buildBatchBody, ixpParams } from './attributes.js';
import {
  entryForSlot, recommendationOf, pznFragment, pznRecord,
} from './pzn-response.js';
import { ixpContentPath } from './ixp-response.js';
// Reuse pzn.js's marketing-profile enrichment (memoized + fail-open there) so the batch
// targets on the same attributes as the page-level path, with no extra network call.
// eslint-disable-next-line import/no-cycle
import { getMarketingProfile } from './marketing-profile.js';
import { registerRegionContext } from './tracking-context.js';

// --- PZN (decisions-manifest → placement/fragment) lane ---------------------

// selector -> click-attribution params, captured off the SAME recommendation that produced
// the fragment so the click channel (tracking-context.js registry) agrees with it.
const pznContextCache = new Map();

/**
 * A selector's click-attribution params from its recommendation, for the region-context
 * registry (never DOM attributes). Prefers the normalized pznRecord for a real offer;
 * falls back to raw fields (the demo mock has neither and so misses that guard).
 * @param {Object} rec the recommendation (never null — a fragment was resolved from it)
 * @param {String} placement fallback when the rec doesn't echo its own placement
 * @returns {Object}
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
 * BYO `resolveDecisions` hook: `serveDecisions` hands us every decisions-manifest row for
 * the page in one call, each carrying a `placement` (a key into the /pzn batch response,
 * not a fragment path). Makes ONE batched call for all distinct placements, then maps each
 * row's placement back to its fragment. The plugin applies the returned url itself.
 * Fail-open — `{}` (every slot keeps its default) on any miss/failure.
 * @param {Object[]} entries manifest rows, each with `selector` + `placement`
 * @returns {Promise<{[selector: string]: {url: String}}>}
 */
export async function resolveDecisions(entries) {
  try {
    if (!Array.isArray(entries) || !entries.length) return {};
    const placements = [...new Set(entries.map((entry) => entry.placement).filter(Boolean))];
    if (!placements.length) return {};
    // Enrich with the visitor's marketing profile (fail-open null → batch goes unenriched).
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

// experimentId -> the engine's variation content ref (assetLocation / redirect path). No
// entry ⇒ no content for this experiment (failure, or a control arm the plugin never
// routes to renderDecision), so renderDecision leaves control in place.
const ixpContentCache = new Map();
// experimentId -> click-attribution identity, captured off the same assignment. Set for
// BOTH arms (exposure matters for control too), though renderDecision only reads it on the
// challenger path.
const ixpContextCache = new Map();
// experimentId -> raw assignment, memoized so multiple blocks / a forced-arm override that
// name the same id collapse to ONE real/mock call.
const ixpAssignmentCache = new Map();

/**
 * Calls /ixp for one experiment (canned mock when the endpoint is absent and the page opts
 * in via ixp-mock). Memoized per id.
 * @param {String} experimentId
 * @returns {Promise<Object|null>} the raw assignment, or null on miss/failure
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
 * BYO `getAssignment` hook: resolves the assignment (memoized), stashes the engine's
 * variation content for renderDecision (frozen-API inversion — see header) and its
 * click-attribution identity, and reports the arm. Runs on every invocation (including
 * under a forced ?experiment override), so the caches are populated before renderDecision.
 * Fail-open — null (self-bucket) on failure, nothing stashed.
 * @param {String} experimentId
 * @returns {Promise<String|null>} `control`/`challenger-1`, or null to self-bucket
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
 * Swaps `el`'s content for the RAW (undecorated) markup at `ref`, WITHOUT the
 * fragment-loading decoration pass. Section/page-scope IXP swaps land BEFORE the page's own
 * decorateMain (loadEager runs them ahead of it), so that pass decorates this content once.
 * Pre-decorating here (as applyFragment does) would leave a decorated `.section` that
 * decorateSections re-wraps and decorateBlocks misreads as a block named "section". Mirrors
 * swapMain (decision.js), generalized to any element.
 * @param {HTMLElement} el
 * @param {String} ref fragment path (`.plain.html` is appended)
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
 * BYO `renderDecision` hook: applies the winning decision's engine-provided content.
 * `scope` picks the strategy:
 * - `fragment` (PZN, post-decoration): `decision.url` is the real fragment resolveDecisions
 *   returned — apply directly with applyFragment. No url ⇒ leave default.
 * - `section`/`page` (IXP, pre-decoration): apply the content getAssignment stashed for
 *   `config.id` via applyRawFragment (avoids double-decoration — see above). No content
 *   (failure or control) ⇒ leave control.
 * Section/block click attribution is published to the region-context registry
 * (registerRegionContext) — NOT stamped as DOM attributes, unlike the page-level paths.
 * Fail-open.
 * @param {HTMLElement} el the matched selector's element, or the section/page root
 * @param {{url: String, scope: String, config: Object, selector: String}} decision
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
 * BYO `rumTracking` hook: records plugin exposure onto `window.appVars` for analytics
 * pickup. Minimal by design (the demo's exposure sink, not a full pipeline). Never throws.
 * @param {{type: String, source: String, target: String}} event
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
