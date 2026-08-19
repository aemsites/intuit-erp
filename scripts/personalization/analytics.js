// Publishes personalization/experiment records onto `window.appVars` for the clickstream /
// page-view tracker. Off the critical path: recording is a cheap synchronous enqueue; the dedup +
// array assembly + global write are deferred to a debounced idle callback, so it never delays the
// DOM swap or LCP. Records accumulate across the eager + lazy phases, deduped by id. (scripts.js
// seeds the object + externalContentIdentifier eagerly; this fills the record arrays.)

// Persistent, deduped buffers (survive across the eager + lazy phases).
const pznById = new Map(); // key: personalization_id (block/section pzn)
const pznPageById = new Map(); // key: personalization_id (whole-page pzn)
const ixpById = new Map(); // key: experiment_id

let flushScheduled = false;

// Ensures `window.appVars` exists (reusing any existing object) and returns it, or
// null when there's no `window` (non-browser context).
export function ensureAppVars() {
  if (typeof window === 'undefined') return null;
  if (!window.appVars) window.appVars = {};
  return window.appVars;
}

// Writes the accumulated buffers onto `window.appVars`. Idempotent.
export function flushAppVars() {
  flushScheduled = false;
  const appVars = ensureAppVars();
  if (!appVars) return;
  // Real arrays, not JSON strings — the tracker reads them directly (no JSON.parse).
  appVars.pznRecDetailsArr = [...pznById.values()];
  appVars.ixpDetailsArr = [...ixpById.values()];
  appVars.pznPageRecDetailsArr = [...pznPageById.values()]; // whole-page pzn
}

// Schedules a single debounced flush after paint (idle), off the critical path.
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(flushAppVars);
  } else {
    setTimeout(flushAppVars, 0);
  }
}

// Adds records to a buffer, deduped by `keyField` (first write wins), and schedules
// the idle flush. A record missing its key is still kept under a unique key.
function record(map, records, keyField) {
  if (!Array.isArray(records)) return;
  let added = false;
  records.forEach((r) => {
    if (!r) return;
    const key = r[keyField] ?? Symbol('anon');
    if (!map.has(key)) {
      map.set(key, r);
      added = true;
    }
  });
  if (added) scheduleFlush();
}

// Enqueue pzn records (deduped by personalization_id). Cheap + synchronous.
export function recordPzn(records) {
  record(pznById, records, 'personalization_id');
}

// Enqueue whole-page pzn records (deduped by personalization_id). Cheap + synchronous.
export function recordPznPage(records) {
  record(pznPageById, records, 'personalization_id');
}

// Enqueue ixp records (deduped by experiment_id). Cheap + synchronous.
export function recordIxp(records) {
  record(ixpById, records, 'experiment_id');
}

// Test-only: reset the accumulators between cases.
export function resetAnalytics() {
  pznById.clear();
  pznPageById.clear();
  ixpById.clear();
  flushScheduled = false;
}
