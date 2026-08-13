/**
 * IXP assignment → decision mapping.
 *
 * The `/api/ixp` handler fetches the assignments and supplies the granularity;
 * this pure helper maps a single IXP assignment onto a normalized decision:
 *
 *   control / empty / unmapped   → null            → baseline (control)
 *   REDIRECT + variation.html key → page-level replace   (fragment = variation path)
 *   REPLACE_WEB_CONTENT + assetLocation → block/section replace (fragment = content ref)
 *
 * The worker does NO decisioning: IXP decides the arm; this only reads it.
 */

/**
 * @typedef {import('./client.js').IxpAssignment} IxpAssignment
 */

/**
 * A normalized personalization/experiment decision.
 * @typedef {Object} PznEntry
 * @property {string} path Page path the decision applies to.
 * @property {string} fragment Fragment reference (variation path or content ref).
 * @property {string} location Slot id a block/section treatment targets.
 * @property {'replace'} action Operation at the target.
 * @property {'block' | 'section' | 'page'} fidelity Granularity of the target.
 */

/**
 * The granularity context the handler supplies for a decision.
 * @typedef {Object} IxpRoute
 * @property {string} location Slot id a block/section treatment targets (unused for page-level).
 * @property {'block' | 'section' | 'page'} fidelity Default granularity for a block-level treatment.
 */

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
      // Page-level: swap the whole <main> for the variation page's content. The
      // real IXP payload carries the variation path under this key.
      const payload = parsePayload(assignment.payload);
      const variationUrl = payload?.['intuit.com.integration.variation.html'];
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
