/**
 * POST /api/de — client-driven Decision Engine batch personalization.
 *
 * Body: { slots: [{ placement, experience? }], path? }. The client supplies the
 * slots (placement comes from a lowercased `pzn-<placement>` class); the worker
 * attaches the secret key, derives the shared visitor attributes, calls the batch
 * endpoint, and returns one normalized decision per personalized slot:
 *   { placement, action, fidelity, fragment }
 * Unpersonalized slots are omitted. Empty array on no slots / no ivid / failure.
 */

import { fetchBatch } from '../de/batch-client.js';
import { slotEntryToPznEntry, buildAttributes, entryForSlot } from '../de/resolve.js';
import { readIvid } from '../ivid.js';
import { json, refererPath } from './http.js';

export async function handleDe(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const rawSlots = Array.isArray(payload?.slots) ? payload.slots : [];
  if (rawSlots.length === 0) return json([]);

  const ivid = readIvid(request);
  if (!ivid) return json([]);

  const permalink = payload?.path || refererPath(request) || '/';
  // The batch client wants { location, placement, experience }; the client model
  // uses the placement itself as the slot key, so location := placement.
  const slots = rawSlots
    .filter((s) => s && typeof s.placement === 'string' && s.placement)
    .map((s) => ({ location: s.placement, placement: s.placement, experience: s.experience || 'marketing' }));
  if (slots.length === 0) return json([]);

  const attributes = buildAttributes(request, ivid, permalink);
  const response = await fetchBatch(env, { slots, attributes });
  if (!response) return json([]);

  const decisions = [];
  for (const slot of slots) {
    const entry = slotEntryToPznEntry(entryForSlot(response, slot), slot, permalink);
    if (entry) {
      decisions.push({
        placement: slot.placement,
        action: entry.action,
        fidelity: entry.fidelity,
        fragment: entry.fragment,
      });
    }
  }
  return json(decisions);
}
