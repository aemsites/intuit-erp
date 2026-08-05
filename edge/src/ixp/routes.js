/**
 * Path → experiment routing table for the IXP-backed flow.
 *
 * The IXP Assignment API is queried *by experiment* (experimentId or label) and
 * its response says nothing about *where* on the page a treatment lands — that is
 * a site-side concern. This table holds exactly that site knowledge:
 *
 *   - which experiment(s) a given page participates in, and
 *   - which slot (+ default granularity) a block-level treatment targets.
 *
 * Page-level treatments (REDIRECT) ignore `location`/`fidelity` — they replace
 * the whole `<main>`. It is small and static by design (a POC-scale lookup); a
 * real deployment would source this from config or the pzn service.
 */

/**
 * @typedef {import('../personalize.js').PznFidelity} PznFidelity
 */

/**
 * @typedef {Object} IxpRoute
 * @property {number} [experimentId] Query IXP by this exact experiment id. Provide this or `label`.
 * @property {string} [label] Query IXP by this label regex (may resolve several experiments).
 * @property {string} location Slot id a block/section treatment targets (unused for page-level).
 * @property {PznFidelity} fidelity Default granularity for a block-level treatment.
 */

/**
 * Keyed by normalized page path.
 * @type {Record<string, IxpRoute>}
 */
export const IXP_ROUTES = {
  // Mirrors the map.json demo: the ERP hero page's personalizable slot is
  // `slot-1`, driven by experiment 39002 (a REPLACE_WEB_CONTENT block treatment).
  '/drafts/suresh/pzn': { experimentId: 39002, location: 'slot-1', fidelity: 'block' },
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
 * Resolves the route for a path, or null if the path is not enrolled.
 * @param {string} path
 * @returns {IxpRoute | null}
 */
export function resolveRoute(path) {
  return IXP_ROUTES[normalizePath(path)] ?? null;
}
