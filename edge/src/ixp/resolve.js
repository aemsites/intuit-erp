/**
 * IXP-backed entry resolution — the swap-in alternative to the map.json flow.
 *
 * Produces the worker's existing `PznEntry` from an IXP assignment, so the rest
 * of the render path (`resolveOfferMarkup` + `applyPersonalization`) is unchanged.
 * The mapping is 1:1 with the actions the worker already performs:
 *
 *   control / empty / unmapped   → null            → passthrough (baseline)
 *   REDIRECT + payload.variationUrl → page-level replace   (fragment = variation path)
 *   REPLACE_WEB_CONTENT + assetLocation → block/section replace (fragment = content ref)
 *
 * The worker still does NO decisioning: IXP decides the arm; this only renders it.
 */

import { fetchAssignment } from './client.js';
import { resolveRoute } from './routes.js';

/**
 * @typedef {import('../personalize.js').PznEntry} PznEntry
 * @typedef {import('./client.js').IxpAssignment} IxpAssignment
 * @typedef {import('./client.js').IxpAssignmentResponse} IxpAssignmentResponse
 * @typedef {import('./client.js').IxpClientEnv} IxpClientEnv
 * @typedef {import('./routes.js').IxpRoute} IxpRoute
 */

/**
 * The visitor id. Read from the `ivid` cookie; a `?ivid=` query param overrides
 * it for demo / QA. Null when absent ⇒ nothing to personalize (passthrough).
 * @param {Request} request
 * @returns {string | null}
 */
function readIvid(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('ivid');
  if (fromQuery) return fromQuery;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Parses the assignment payload JSON, or null if absent/malformed.
 * @param {string} payload
 * @returns {Record<string, unknown> | null}
 */
function parsePayload(payload) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Maps a single IXP assignment onto a `PznEntry`, or null when it should not
 * change the page (control arm, missing target, or an unhandled type).
 * @param {IxpAssignment} assignment
 * @param {IxpRoute} route
 * @param {string} path
 * @returns {PznEntry | null}
 */
export function assignmentToPznEntry(assignment, route, path) {
  // Control arm ⇒ show the baseline.
  if (assignment.control) return null;

  switch (assignment.experimentType) {
    case 'REDIRECT':
    case 'MAB_REDIRECT': {
      // Page-level: swap the whole <main> for the variation page's content.
      const variationUrl = parsePayload(assignment.payload)?.variationUrl;
      if (typeof variationUrl !== 'string' || !variationUrl) return null;
      return {
        path, fragment: variationUrl, location: route.location, action: 'replace', fidelity: 'page',
      };
    }
    case 'REPLACE_WEB_CONTENT':
    case 'MAB_WEB_CONTENT': {
      // Block-level: inject the referenced content at the route's slot.
      if (!assignment.assetLocation) return null;
      return {
        path,
        fragment: assignment.assetLocation,
        location: route.location,
        action: 'replace',
        fidelity: route.fidelity,
      };
    }
    default:
      // DEFAULT / unknown ⇒ no treatment.
      return null;
  }
}

/**
 * Fetches the assignments for a route's experiment. The transport is injected so
 * the routing + mapping logic below is shared between the real HTTP client
 * (`resolveIxpEntry`) and the in-process mock (`ixp/mock-source.js`).
 * @typedef {(params: { ivid: string, experimentId?: number, label?: string }) => Promise<IxpAssignmentResponse | null>} AssignmentFetcher
 */

/**
 * Resolves a `PznEntry` for a request from IXP assignments, or null (passthrough)
 * when the path is not enrolled, there is no ivid, or no assignment maps to a
 * change. Transport-agnostic — see `AssignmentFetcher`.
 * @param {Request} request
 * @param {AssignmentFetcher} fetchAssignments
 * @returns {Promise<PznEntry | null>}
 */
export async function resolveEntryWith(request, fetchAssignments) {
  const path = new URL(request.url).pathname;
  const route = resolveRoute(path);
  if (!route) return null;

  const ivid = readIvid(request);
  if (!ivid) return null;

  const res = await fetchAssignments({
    ivid, experimentId: route.experimentId, label: route.label,
  });
  if (!res || res.assignments.length === 0) return null;

  // A label route may resolve several experiments; apply the first that maps to
  // an actual change (a single slot can only show one treatment).
  for (const assignment of res.assignments) {
    const entry = assignmentToPznEntry(assignment, route, path);
    if (entry) return entry;
  }
  return null;
}

/**
 * Resolves a `PznEntry` via the real IXP Assignment API over HTTP, or null
 * (passthrough). Thin wrapper over `resolveEntryWith` with the network transport.
 * @param {IxpClientEnv} env
 * @param {Request} request
 * @returns {Promise<PznEntry | null>}
 */
export function resolveIxpEntry(env, request) {
  return resolveEntryWith(request, (params) => fetchAssignment(env, params));
}
