// Reads the RAW Decision Engine batch response (returned verbatim by the worker's
// `/api/pzn` passthrough). Two jobs, both driven straight off the real response:
//   1. the DOM swap reads `rec.copyData.contentId` inline (see scripts/pzn.js);
//   2. the analytics record is built by `pznRecord` below.
// The batch response is an object keyed `<experience>_<placement>_<locale>`; each
// value echoes its own `placement` and carries `data.recommendations` (an array on
// status 200, a `{ fallback }` object on 204).

// Finds the response entry for a placement (case-insensitive on the echoed
// `placement`), or null. We match the entry's own field rather than rebuilding the
// `<experience>_<placement>_<locale>` key.
export function entryForSlot(response, placement) {
  if (!response || typeof response !== 'object') return null;
  const want = String(placement).toLowerCase();
  const hit = Object.values(response).find(
    (v) => v && typeof v.placement === 'string' && v.placement.toLowerCase() === want,
  );
  return hit || null;
}

// The first recommendation object for a 200 entry, else null. Shared by the DOM
// swap and the analytics record so the response is read once.
export function recommendationOf(entry) {
  if (!entry || entry.status !== 200) return null;
  return entry.data?.recommendations?.[0] ?? null;
}

// Builds the normalized pzn analytics record from a recommendation object, or null
// when it isn't a real personalized offer (`accessPoint && id` guard). Field names
// are the snake_case keys emitted verbatim as ECS `personalization_details`.
// `casId` is not available client-side, so `externalContentIdentifier` falls back
// to `contentId`.
export function pznRecord(rec) {
  if (!rec || !rec.accessPoint || !rec.id) return null;
  const contentId = rec.copyData?.contentId;
  return {
    personalization_placement: rec.accessPoint,
    personalization_id: rec.id,
    personalization_action: 'im',
    personalization_workflow: 'marketing',
    content_id: contentId,
    externalContentIdentifier: contentId,
    model_name: rec.model_name,
    model_version: rec.model_version,
    experiment_id: rec.experimentId,
    experiment_version: rec.experimentVersion,
    experiment_treatment: rec.treatmentId,
    inference_handler: rec.inference_handle,
  };
}
