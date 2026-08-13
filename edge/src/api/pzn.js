/**
 * POST /api/pzn — client-driven Decision Engine batch personalization.
 *
 * Body: { slots: [{ placement, experience? }], path? }. The client supplies the
 * slots (placement comes from a lowercased `pzn-<placement>` class); the worker
 * attaches the secret key, derives the shared visitor attributes, calls the batch
 * endpoint, and returns the RAW batch response verbatim. The worker does NO
 * response interpretation — the front-end reads each slot's recommendation
 * (fragment + metadata) straight from the real response. An empty object `{}` is
 * returned on no slots / no ivid / upstream failure (the front-end then finds no
 * entry per slot and shows the baseline).
 */

import { fetchBatch } from '../pzn/batch-client.js';
import { buildAttributes } from '../pzn/resolve.js';
import { readIvid } from '../ivid.js';
import { json, refererPath } from './http.js';

export async function handlePzn(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const rawSlots = Array.isArray(payload?.slots) ? payload.slots : [];
  if (rawSlots.length === 0) return json({});

  const ivid = readIvid(request);
  if (!ivid) return json({});

  const permalink = payload?.path || refererPath(request) || '/';
  // The batch client wants { location, placement, experience }; the client model
  // uses the placement itself as the slot key, so location := placement.
  const slots = rawSlots
    .filter((s) => s && typeof s.placement === 'string' && s.placement)
    .map((s) => ({ location: s.placement, placement: s.placement, experience: s.experience || 'marketing' }));
  if (slots.length === 0) return json({});

  const attributes = buildAttributes(request, ivid, permalink);
  const response = await fetchBatch(env, { slots, attributes });
  if (!response) return json({});

  // Passthrough: return the real batch response as-is. The front-end matches each
  // slot to its entry and reads copyData.contentId + recommendation metadata.
  return json(response);
}
