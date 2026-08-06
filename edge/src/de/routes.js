/**
 * Path → Decision Engine slot routing table (use case 2: personalization).
 *
 * The Decision Engine "Batch" endpoint is queried *by placement* and its
 * response says nothing about *where* on the page each slot lands — that is a
 * site-side concern, exactly as with the IXP flow (`ixp/routes.js`). This table
 * holds that site knowledge: for a given page, the slots to personalize and the
 * `{ placement, experience }` each slot maps to in the batch request.
 *
 * A block-level treatment fills the slot (`fidelity: 'block'`, `action:
 * 'replace'`). It is small and static by design (a POC-scale lookup); a real
 * deployment would source this from config or the pzn service.
 */

/**
 * @typedef {Object} DeSlot
 * @property {string} location Slot id to target in the page (e.g. `slot-1`).
 * @property {string} placement Decision Engine placement/accessPoint for the slot.
 * @property {string} experience Decision Engine experience (e.g. `ttcom`).
 */

/**
 * @typedef {Object} DeRoute
 * @property {DeSlot[]} slots The personalizable slots on the page.
 */

/**
 * Keyed by normalized page path.
 * @type {Record<string, DeRoute>}
 */
export const DE_ROUTES = {
  // Use case 2: the treatment page (option B) has two personalizable slots. Each
  // maps to a Decision Engine placement; the batch response picks the content
  // (a fragment) for each, varied by the visitor's industry (from ZoomInfo).
  '/drafts/pzn/treatment': {
    slots: [
      { location: 'slot-1', placement: 'CGTTCOMMContentTTLCTY255044', experience: 'ttcom' },
      { location: 'slot-2', placement: 'CGTTCOMMContentTTLCTY255044Modal', experience: 'ttcom' },
    ],
  },
};

/**
 * Drops a trailing slash except at root, so `/x/` and `/x` match the same route.
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Resolves the DE route for a path, or null if the path has no personalized slots.
 * @param {string} path
 * @returns {DeRoute | null}
 */
export function resolveDeRoute(path) {
  return DE_ROUTES[normalizePath(path)] ?? null;
}
