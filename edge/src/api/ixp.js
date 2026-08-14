/**
 * GET /api/ixp — client-driven IXP experiment assignment.
 *
 * Query: experimentId | label (+ optional application, businessUnit, country).
 * The client supplies the experiment identity from page metadata; the worker
 * attaches the secret key, calls the IXP Assignment API, and returns the RAW
 * assignment response verbatim. The worker does NO decisioning — the front-end
 * reads the assignment (experimentType, payload, assetLocation, control) itself,
 * owning fidelity/path locally. An empty `{ assignments: [] }` is returned on no
 * id/label, no ivid, or upstream failure (the front-end shows the baseline).
 */

import { fetchAssignment } from '../ixp/client.js';
import { readIvid } from '../ivid.js';
import { json } from './http.js';

export async function handleIxp(request, env) {
  const url = new URL(request.url);
  const experimentId = url.searchParams.get('experimentId');
  const label = url.searchParams.get('label');
  if (!experimentId && !label) return json({ assignments: [] });

  const ivid = readIvid(request);
  if (!ivid) return json({ assignments: [] });

  const params = { ivid };
  if (experimentId) params.experimentId = Number(experimentId);
  if (label) params.label = label;
  ['application', 'businessUnit', 'country'].forEach((k) => {
    const v = url.searchParams.get(k);
    if (v) params[k] = v;
  });

  const res = await fetchAssignment(env, params);
  if (!res || !Array.isArray(res.assignments)) return json({ assignments: [] });

  // Passthrough: return the real assignment response as-is. The front-end reads
  // the assignment(s) and resolves the content path + records itself.
  return json(res);
}
