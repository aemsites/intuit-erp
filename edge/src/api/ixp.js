/**
 * GET /api/ixp — client-driven IXP experiment decision.
 *
 * Query: experimentId | label (+ optional fidelity [default 'page'], path,
 * application, businessUnit, country). The client supplies the experiment
 * identity from page metadata; the worker attaches the secret key, calls the IXP
 * Assignment API, and returns a normalized decision for the first assignment that
 * maps to a change: { action, fidelity, fragment }, else { control: true }.
 */

import { fetchAssignment } from '../ixp/client.js';
import { assignmentToPznEntry } from '../ixp/resolve.js';
import { readIvid } from '../ivid.js';
import { json, refererPath } from './http.js';

export async function handleIxp(request, env) {
  const url = new URL(request.url);
  const experimentId = url.searchParams.get('experimentId');
  const label = url.searchParams.get('label');
  if (!experimentId && !label) return json({ control: true });

  const ivid = readIvid(request);
  if (!ivid) return json({ control: true });

  const params = { ivid };
  if (experimentId) params.experimentId = Number(experimentId);
  if (label) params.label = label;
  ['application', 'businessUnit', 'country'].forEach((k) => {
    const v = url.searchParams.get(k);
    if (v) params[k] = v;
  });

  const res = await fetchAssignment(env, params);
  if (!res || !Array.isArray(res.assignments) || res.assignments.length === 0) {
    return json({ control: true });
  }

  const path = url.searchParams.get('path') || refererPath(request) || '/';
  // Client-supplied granularity; a synthetic route stands in for the SSR table.
  const route = { location: 'main', fidelity: url.searchParams.get('fidelity') || 'page' };
  for (const assignment of res.assignments) {
    const entry = assignmentToPznEntry(assignment, route, path);
    if (entry) {
      return json({
        action: entry.action, fidelity: entry.fidelity, fragment: entry.fragment,
      });
    }
  }
  return json({ control: true });
}
