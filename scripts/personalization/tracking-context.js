// Region-scoped tracking context for the click channel — a JS registry, not DOM attributes
// (no new data-* at rest; see AGENTS.md). byo.js's renderDecision registers the winning
// PZN/IXP identity against the element it applied content to; the Option B click runtime
// (clicktrack-optionb branch) resolves the nearest registered ancestor at click time and
// folds it into the beacon's custom_properties (see CLICK-TRACKING.md).
//
// Lives on `window.__pznTrackingContext` (not a module Map) so a separate module graph
// (Option B's own bundle) can read it without importing this file. A WeakMap so an entry
// never outlives its element.
//
// Contract: ctx = { source: 'pzn'|'ixp', ...trackingParams } — see byo.js.

/**
 * The shared registry, created + published on `window` on first use (a private WeakMap
 * outside a browser, e.g. tests) so every reader shares one instance.
 * @returns {WeakMap<Element, Object>}
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
 * Registers `el` as a personalized/experiment region root. Fail-open (no-op on missing
 * args) so a caller can call it unconditionally after a swap.
 * @param {Element} el the element renderDecision applied content to
 * @param {{source: ('pzn'|'ixp')}} ctx the region's tracking params
 * @returns {void}
 */
export function registerRegionContext(el, ctx) {
  if (el && ctx) REGION_CONTEXT.set(el, ctx);
}

/**
 * Walks up from `fromEl` (inclusive) to the nearest registered region and returns its
 * context — the JS-registry equivalent of the SBSEG tracker's data-* ancestor walk. Stops
 * at document.body.
 * @param {Element} fromEl the interaction target
 * @returns {Object|null} the nearest region's context, or null when none is registered
 */
export function resolveRegionContext(fromEl) {
  for (let node = fromEl; node && node !== document.body; node = node.parentElement) {
    if (REGION_CONTEXT.has(node)) return REGION_CONTEXT.get(node);
  }
  return null;
}
