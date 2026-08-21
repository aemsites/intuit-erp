// Region-scoped tracking context for the click channel — a JS construct, NOT
// DOM data-attributes (no new `data-*` at rest; see AGENTS.md). byo.js's
// `renderDecision` registers the winning PZN/IXP decision's identity against
// the element it just applied content to; the click-tracking runtime (Option
// B, `clicktrack-optionb` branch) resolves the nearest registered ancestor at
// interaction time and folds the result into `custom_properties` on the
// beacon it's about to send — see CLICK-TRACKING.md for the beacon contract
// this feeds, and byo.js's `renderDecision` for the (removed) `data-pzn-*` /
// `data-experiment-*` DOM-stamping this replaces on the section/block lane.
//
// The registry lives on `window.__pznTrackingContext` rather than a
// module-local Map/WeakMap so that a SEPARATE module graph (Option B's own
// bundle, on its own branch today) can resolve it without importing this
// exact specifier — `window` is the only thing both sides are guaranteed to
// share. A WeakMap (not a plain Map) so an element's entry never outlives the
// element itself — a removed/replaced region leaves nothing to clean up.
//
// Contract: `ctx = { source: 'pzn'|'ixp', ...trackingParams }` — see byo.js's
// `resolveDecisions` (PZN) and `getAssignment` (IXP) for what each source
// captures.

/**
 * Returns the shared region-context registry, creating + publishing it onto
 * `window` on first use so every module (this one, and any other bundle that
 * reads `window.__pznTrackingContext` directly) shares the exact same
 * instance. Falls back to a private, module-local `WeakMap` outside a
 * `window` context (e.g. a non-browser test runner) so the exports below
 * always have a store to read/write.
 * @returns {WeakMap<Element, Object>} the region-context registry
 */
function registry() {
  if (typeof window === 'undefined') return new WeakMap();
  // eslint-disable-next-line no-underscore-dangle -- fixed global name, see header comment
  if (!(window.__pznTrackingContext instanceof WeakMap)) {
    // eslint-disable-next-line no-underscore-dangle
    window.__pznTrackingContext = new WeakMap();
  }
  // eslint-disable-next-line no-underscore-dangle
  return window.__pznTrackingContext;
}

const REGION_CONTEXT = registry();

/**
 * Registers `el` as the root of a personalized/experiment region: any click
 * inside it can later be attributed via `resolveRegionContext` without a DOM
 * data-attribute. Fail-open — a no-op when either argument is missing, so a
 * caller can call this unconditionally after a content swap.
 * @param {Element} el the region's root element (the element `renderDecision`
 *   just applied content to)
 * @param {{source: ('pzn'|'ixp')}} ctx this region's tracking params — always
 *   carries `source`, plus whatever identity fields that lane captured
 * @returns {void}
 */
export function registerRegionContext(el, ctx) {
  if (el && ctx) REGION_CONTEXT.set(el, ctx);
}

/**
 * Walks up from `fromEl` (inclusive) to the nearest registered region and
 * returns its context — the JS-registry equivalent of the SBSEG tracker's
 * `data-pzn-placement` ancestor walk (see CLICK-TRACKING.md), but over
 * `registerRegionContext` entries instead of DOM attributes. Stops at
 * `document.body` (never itself registered, and there is nothing meaningful
 * above it for this purpose).
 * @param {Element} fromEl the interaction target to resolve context for
 * @returns {Object|null} the nearest ancestor's (or `fromEl`'s own) context,
 *   or null when none of them are registered
 */
export function resolveRegionContext(fromEl) {
  for (let node = fromEl; node && node !== document.body; node = node.parentElement) {
    if (REGION_CONTEXT.has(node)) return REGION_CONTEXT.get(node);
  }
  return null;
}
