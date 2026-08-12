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
 * @property {string} experience Decision Engine experience (e.g. `marketing`).
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
  // Use case 2: the treatment page has one personalizable slot mapped to the
  // pzn service's `SBSEGQBMContentAemPznIxpTest` placement (experience
  // `marketing`). The batch response picks the fragment for the slot per visitor.
  '/drafts/pzn/treatment': {
    slots: [
      { location: 'slot-1', placement: 'SBSEGQBMContentAemPznIxpTest', experience: 'marketing' },
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

/**
 * Client-flow DE routes: pages whose slots are personalized **client-side** via
 * the `/api/pzn-manifest.json` Audience Manifest (the aem-experimentation plugin
 * applies the offer). Kept separate from the server-side `DE_ROUTES` so the SSR
 * proxy passes these pages through untouched — the client, not the worker, injects
 * the offer, so there is no double injection.
 * @type {Record<string, DeRoute>}
 */
export const DE_CLIENT_ROUTES = {
  // The client-side POC demo page. Its `slot-1` block is personalized by the
  // Decision Engine and applied by aem-experimentation via the manifest endpoint.
  '/drafts/pzn-demo': {
    slots: [
      { location: 'slot-1', placement: 'SBSEGQBMContentAemPznIxpTest', experience: 'marketing' },
    ],
  },
};

/**
 * Resolves the client-flow DE route for a path, or null if it has no client-side
 * personalized slots.
 * @param {string} path
 * @returns {DeRoute | null}
 */
export function resolveDeClientRoute(path) {
  return DE_CLIENT_ROUTES[normalizePath(path)] ?? null;
}
