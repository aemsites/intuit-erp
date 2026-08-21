// Reads the RAW IXP assignment response (returned verbatim by the worker's
// `/api/ixp` passthrough): `{ ivid, transactionId, assignments: [...] }`. The DOM
// swap and the analytics record both read the assignment directly — no intermediate
// normalized decision object. Fidelity (page vs section/block) is owned by the caller
// (exp.js `runExperiment` = page; the vendored aem-experimentation plugin's BYO
// `getAssignment`/`renderDecision` in scripts/personalization/byo.js = section/block),
// not read from here.

const REDIRECT_TYPES = new Set(['REDIRECT', 'MAB_REDIRECT']);
const REPLACE_TYPES = new Set(['REPLACE_WEB_CONTENT', 'MAB_WEB_CONTENT']);

// Page-level (redirect) treatment ⇒ swap the whole <main> for the variation page.
export function isRedirect(assignment) {
  return !!assignment && !assignment.control && REDIRECT_TYPES.has(assignment.experimentType);
}

// Block/section-level treatment ⇒ inject the referenced content at the slot.
export function isReplace(assignment) {
  return !!assignment && !assignment.control && REPLACE_TYPES.has(assignment.experimentType);
}

// Parses the assignment payload JSON, or null if absent/malformed.
function parsePayload(payload) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// The resolved content path IXP hands back: the variation URL (redirect) or the
// content ref (replace), or null (control / unmapped). Single source shared by the
// DOM swap and the record's `replacement_content_id`.
export function ixpContentPath(assignment) {
  if (isRedirect(assignment)) {
    const url = parsePayload(assignment.payload)?.['intuit.com.integration.variation.html'];
    return typeof url === 'string' && url ? url : null;
  }
  if (isReplace(assignment)) {
    return assignment.assetLocation || null;
  }
  return null;
}

// Builds the normalized ixp analytics record from an assignment, or null when it
// lacks experiment identity (`experimentId && experimentVersion && id` guard).
// Control arms still emit a record (exposure tracking) — they just have no
// `replacement_content_id`. `original_content_id` is the current page path.
export function ixpRecord(assignment, path) {
  if (!assignment) return null;
  const { experimentId, experimentVersion, id } = assignment;
  if (!experimentId || !experimentVersion || !id) return null;
  const record = {
    experiment_id: experimentId,
    experiment_version: experimentVersion,
    experiment_treatment: id,
    original_content_id: path,
  };
  const replacement = ixpContentPath(assignment);
  if (replacement) record.replacement_content_id = replacement;
  return record;
}
