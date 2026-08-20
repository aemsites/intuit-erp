// Bring-your-own decision engine hooks for the vendored aem-experimentation plugin
// (plugins/experimentation/src/index.js). This is the "cell-resolution" wiring for
// Intuit's personalization: the plugin resolves which audience CELL a visitor is
// in (resolveAudiences), a published manifest sheet owns the cell->fragment mapping
// per selector (audience-manifest metadata), and the plugin applies the winning
// cell's fragment (renderDecision). The engine owns cell resolution; the sheet owns
// cell->content.
//
// All three hooks are fail-open and must never throw out of the plugin's call
// site (see plugins/experimentation/src/index.js `getResolvedAudiences` /
// `applyDecision` / `fireRUM`, which already guard their calls to these hooks —
// this file adds its own guards too, matching the fail-open style used throughout
// scripts/personalization/*.js).

import { getMetadata } from '../aem.js';
// eslint-disable-next-line import/no-relative-packages
import { createRemoteAudienceResolver } from '../../plugins/experimentation/src/index.js';
// eslint-disable-next-line import/no-cycle
import { applyFragment } from './decision.js';

// Sticky demo mock: the cookie a visitor's chosen cell is persisted in when no
// remote decision engine is configured (see resolveStickyDemoCell below).
const CELL_COOKIE = 'pzn-cell';

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
 * BYO `renderDecision` hook: applies the winning cell's fragment to the target
 * element. Reuses `applyFragment` (scripts/personalization/decision.js), the same
 * fail-open fragment-swap helper the Intuit pzn.js/exp.js paths already use, so
 * fragment loading/decoration stays consistent across both mechanisms. Never
 * throws — a failed swap just leaves the target's existing (default) content in
 * place.
 * @param {HTMLElement} el the element to update (the matched selector's element)
 * @param {{url: String}} decision the resolved decision; `url` is the cell's
 *   fragment path from the manifest sheet
 * @returns {Promise<void>}
 */
export async function renderDecision(el, decision) {
  try {
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
