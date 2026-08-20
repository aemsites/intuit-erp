// Bring-your-own decision engine hooks for the vendored aem-experimentation plugin
// (plugins/experimentation/src/index.js). Two lanes share this file:
// - cell-resolution (personalization): the plugin resolves which audience CELL a
//   visitor is in (resolveAudiences), a published manifest sheet owns the
//   cell->fragment mapping per selector (audience-manifest metadata), and the
//   plugin applies the winning cell's fragment (renderDecision).
// - experiment-assignment (IXP): the plugin resolves which ARM a visitor gets for
//   a natively-authored `Experiment` / `Experiment Variants` experiment
//   (getAssignment) — NOT a manifest sheet; the authored variant URLs (page or
//   section metadata) own arm->content, and the plugin applies the winning arm's
//   variant (renderDecision, shared with the cell-resolution lane).
// In both lanes the engine owns *who* (cell/arm); authoring owns *what* (content).
//
// All hooks are fail-open and must never throw out of the plugin's call site (see
// plugins/experimentation/src/index.js `getResolvedAudiences` / `getExternalAssignment`
// / `applyDecision` / `fireRUM`, which already guard their calls to these hooks —
// this file adds its own guards too, matching the fail-open style used throughout
// scripts/personalization/*.js).

import { getMetadata } from '../aem.js';
// eslint-disable-next-line import/no-relative-packages
import { createRemoteAudienceResolver } from '../../plugins/experimentation/src/index.js';
// eslint-disable-next-line import/no-cycle
import { applyFragment, fetchDecision, fragmentPath } from './decision.js';
import { resolveIvid } from './attributes.js';

// Sticky demo mock: the cookie a visitor's chosen cell is persisted in when no
// remote decision engine is configured (see resolveStickyDemoCell below).
const CELL_COOKIE = 'pzn-cell';

// Sticky demo mock for the experiment-assignment lane: cookie name prefix (one
// cookie per experiment id, see resolveStickyDemoArm below) and the two arms the
// mock ever hands out. Real variant ids are owned entirely by the plugin
// (`control`, `challenger-1`, `challenger-2`, …, see getExperimentConfig in
// plugins/experimentation/src/index.js) — the demo mock only ever needs one
// challenger to prove the wiring, so it picks between these two.
const IXP_ARM_COOKIE_PREFIX = 'ixp-arm-';
const IXP_DEMO_VARIANTS = ['control', 'challenger-1'];

// One memoized remote resolver per endpoint, so the two (or more) selectors on a
// manifest-driven page share a single batched/cached lookup instead of each
// selector's resolveAudiences call re-creating its own resolver (and losing
// createRemoteAudienceResolver's internal per-page memoization).
const remoteResolvers = new Map();

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

/**
 * Picks one cell out of the candidate names, preferring a non-"default" one so
 * the demo actually shows a personalized cell rather than always falling back.
 * @param {String[]} names the candidate cell names
 * @returns {String} the picked cell name
 */
function pickCell(names) {
  const nonDefault = names.filter((name) => name !== 'default');
  const pool = nonDefault.length ? nonDefault : names;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Demo-only stand-in for a real decision engine: sticks a visitor to one cell
 * (persisted in the `pzn-cell` cookie) so repeated resolutions on the same page
 * (one per manifest selector) and repeat visits see a consistent cell, instead of
 * a fresh random pick every time. The built-in `?audience=` QA override (handled
 * upstream by the plugin, see getResolvedAudiences) always wins over this.
 * @param {String[]} names the cell names configured for the current selector
 * @returns {{[cell]: boolean}} the resolved cell map
 */
function resolveStickyDemoCell(names) {
  if (!names.length) return {};
  const sticky = readCookie(CELL_COOKIE);
  const picked = (sticky && names.includes(sticky)) ? sticky : pickCell(names);
  writeCookie(CELL_COOKIE, picked);
  return { [picked]: true };
}

/**
 * Gets (or creates) the memoized remote resolver for an endpoint.
 * @param {String} endpoint the resolver endpoint URL
 * @returns {Function} a `resolveAudiences(names, context)` implementation
 */
function getRemoteResolver(endpoint) {
  if (!remoteResolvers.has(endpoint)) {
    remoteResolvers.set(endpoint, createRemoteAudienceResolver({ endpoint, timeout: 1000 }));
  }
  return remoteResolvers.get(endpoint);
}

/**
 * BYO `resolveAudiences` hook: resolves which audience cell(s) the current
 * visitor is in. When the page carries a `pzn-cell-endpoint` metadata, resolution
 * is delegated to that remote decision engine (via the plugin's own
 * `createRemoteAudienceResolver`, which is itself timeout-bounded and
 * fail-open). Otherwise falls back to a sticky demo mock so this is testable
 * without standing up a real engine. Never throws — resolves `{}` (control) on
 * any failure.
 * @param {String[]} names the candidate cell names configured on the page/selector
 * @param {{url: String, consent: Boolean}} context the shared decision context
 * @returns {Promise<{[cell]: Boolean}>} a map of cell name to resolved boolean
 */
export async function resolveAudiences(names, context) {
  try {
    if (!Array.isArray(names) || !names.length) return {};
    const endpoint = getMetadata('pzn-cell-endpoint');
    if (endpoint) {
      return await getRemoteResolver(endpoint)(names, context);
    }
    return resolveStickyDemoCell(names);
  } catch {
    return {};
  }
}

/**
 * Demo-only stand-in for a real decision engine: sticks a visitor to one arm per
 * experiment (persisted in an `ixp-arm-<experimentId>` cookie) so repeat
 * evaluations of the same experiment and repeat visits see a consistent arm,
 * instead of a fresh random pick every time. The built-in
 * `?experiment=<id>/<variant>` QA override (handled upstream by the plugin, see
 * getExperimentConfig) always wins over this.
 * @param {String} experimentId the experiment id to stick a visitor to
 * @returns {String} the picked variant id (`control` or `challenger-1`)
 */
function resolveStickyDemoArm(experimentId) {
  const cookieName = `${IXP_ARM_COOKIE_PREFIX}${experimentId}`;
  const sticky = readCookie(cookieName);
  const picked = IXP_DEMO_VARIANTS.includes(sticky)
    ? sticky
    : IXP_DEMO_VARIANTS[Math.floor(Math.random() * IXP_DEMO_VARIANTS.length)];
  writeCookie(cookieName, picked);
  return picked;
}

/**
 * Maps an arm identifier returned by an external engine onto the plugin's fixed
 * variant vocabulary (`control`, `challenger-1`, `challenger-2`, …). Real engines
 * rarely speak that vocabulary natively — e.g. Intuit's existing IXP assignment
 * shape (see personalization/ixp-response.js) signals the arm via a `control`
 * boolean plus an opaque treatment `id`, not a plugin-shaped name — so this
 * translation is this wiring's job. Anything left unrecognized is returned
 * as-is: the plugin's own `getExternalAssignment` already serves `control` for
 * any value outside its known variant names, so an unmapped answer is still safe.
 * @param {String|Number|Boolean|Object} arm the raw arm value from the engine;
 *   an object may expose `control` (Boolean) and/or `variant`/`id`/`arm`
 * @returns {String|null} a `control`/`challenger-N` id, or `null` when the
 *   engine gave nothing to map
 */
function mapEngineArm(arm) {
  if (arm === null || arm === undefined || arm === '') return null;
  if (typeof arm === 'object') {
    if (typeof arm.control === 'boolean' && arm.control) return 'control';
    return mapEngineArm(arm.variant ?? arm.id ?? arm.arm);
  }
  const str = String(arm).trim();
  if (!str) return null;
  if (/^challenger-\d+$/i.test(str)) return str.toLowerCase();
  if (/^(control|baseline|holdout)$/i.test(str)) return 'control';
  const index = Number(str);
  if (Number.isInteger(index)) return index <= 0 ? 'control' : `challenger-${index}`;
  return str;
}

/**
 * Calls the configured remote engine for a single experiment's assignment
 * (`POST { experimentId, context, ivid }`) and maps its answer onto the
 * plugin's variant vocabulary. Accepts the documented BYO contract envelope
 * (`{ assignments: { [experimentId]: arm } }`, see
 * plugins/experimentation/documentation/byo-decision-engine.md) or a bare
 * `{ [experimentId]: arm }` map, mirroring resolveAudiences' bare-map tolerance.
 * Timeout-bound and fail-open via `fetchDecision` — a slow, erroring, or missing
 * answer resolves `null` (self-bucket).
 * @param {String} endpoint the `ixp-endpoint` metadata value
 * @param {String} experimentId the experiment id
 * @param {{url: String, consent: Boolean}} context the shared decision context
 * @returns {Promise<String|null>} a variant id, or `null` on any miss/failure
 */
async function getRemoteAssignment(endpoint, experimentId, context) {
  const ivid = resolveIvid();
  const body = { experimentId, context, ...(ivid ? { ivid } : {}) };
  const data = await fetchDecision(endpoint, { method: 'POST', body, timeoutMs: 1000 });
  if (!data) return null;
  const assignments = data.assignments || data;
  return mapEngineArm(assignments?.[experimentId]);
}

/**
 * BYO `getAssignment` hook: lets Intuit's decision engine own an experiment's
 * arm (bucketing/stickiness/exposure) while the plugin only renders and reports
 * it (see `getExternalAssignment` in plugins/experimentation/src/index.js,
 * ~line 852 — a falsy return here self-buckets, an unknown variant is served as
 * `control`, a valid one is served as-is). This is the native-authoring
 * counterpart to `resolveAudiences` above: no manifest sheet is involved — the
 * variant *content* comes from the page/section's own `Experiment Variants`
 * metadata (see documentation/experiments.md), and this hook only decides
 * *which* of those authored variants is shown. When the page carries an
 * `ixp-endpoint` metadata, resolution is delegated to that remote decision
 * engine; otherwise falls back to a sticky demo mock so this is testable
 * without standing up a real engine. Never throws — resolves `null` (self-bucket)
 * on any failure.
 * @param {String} experimentId the experiment id (the page/section `Experiment`
 *   metadata value)
 * @param {{url: String, consent: Boolean}} context the shared decision context
 * @returns {Promise<String|null>} a `control`/`challenger-N` variant id, or
 *   `null` to let the plugin self-bucket
 */
export async function getAssignment(experimentId, context) {
  try {
    if (!experimentId) return null;
    const endpoint = getMetadata('ixp-endpoint');
    if (endpoint) {
      return await getRemoteAssignment(endpoint, experimentId, context);
    }
    return resolveStickyDemoArm(experimentId);
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
 * BYO `renderDecision` hook: applies the winning decision to the target element.
 * Shared by both lanes — a resolved audience cell's manifest fragment
 * (resolveAudiences above) and a resolved experiment's authored variant URL
 * (getAssignment above) — since both just need "swap this element's content for
 * the fragment at this URL". `decision.scope` (always one of `fragment` /
 * `section` / `page`, see plugins/experimentation/src/index.js `applyDecision`)
 * picks the swap strategy:
 * - `fragment` (the manifest-driven cell-resolution lane, applied post-decoration
 *   via a MutationObserver): `applyFragment`, the same fail-open fragment-swap
 *   helper the Intuit pzn.js/exp.js paths already use, so fragment
 *   loading/decoration stays consistent across every mechanism.
 * - `section` / `page` (the native-authoring experiment lane, applied
 *   pre-decoration): `applyRawFragment` above, to avoid double-decorating (see
 *   its doc comment).
 * Never throws — a failed swap just leaves the target's existing
 * (default/control) content in place.
 * @param {HTMLElement} el the element to update (the matched selector's element,
 *   or the section/page root for an experiment)
 * @param {{url: String, scope: String}} decision the resolved decision; `url` is
 *   the cell's fragment path from the manifest sheet, or the experiment's
 *   authored variant URL (from `Experiment Variants` metadata)
 * @returns {Promise<void>}
 */
export async function renderDecision(el, decision) {
  try {
    if (decision?.scope === 'section' || decision?.scope === 'page') {
      await applyRawFragment(el, decision?.url);
      return;
    }
    await applyFragment(el, decision?.url);
  } catch {
    // fail-open — leave the default content in place
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
