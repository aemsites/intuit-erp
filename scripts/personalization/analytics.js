// Publishes personalization/experiment records onto `window.appVars` for the ECS
// analytics beacon to emit as `personalization_details`. Kept OFF the critical
// path: recording is a cheap synchronous enqueue; the dedup + JSON serialization +
// global write are deferred to a debounced idle callback, so analytics never delays
// the DOM swap or LCP. Records arrive across the eager (LCP section) and lazy
// (rest-of-page) phases, so they accumulate — deduped by their stable id.

// Persistent, deduped buffers (survive across the eager + lazy phases).
const pznById = new Map(); // key: personalization_id
const ixpById = new Map(); // key: experiment_id

let flushScheduled = false;

// Ensures `window.appVars` exists (reusing any existing object) and returns it, or
// null when there's no `window` (non-browser context).
export function ensureAppVars() {
  if (typeof window === 'undefined') return null;
  if (!window.appVars) window.appVars = {};
  return window.appVars;
}

// Writes the serialized buffers onto `window.appVars`. Idempotent — safe to call
// repeatedly as more records accumulate.
export function flushAppVars() {
  flushScheduled = false;
  const appVars = ensureAppVars();
  if (!appVars) return;
  const pznData = [...pznById.values()];
  appVars.pznData = pznData;
  appVars.pznRecDetailsArr = JSON.stringify(pznData);
  appVars.ixpDetailsArr = JSON.stringify([...ixpById.values()]);
  // Page-level pzn (a whole page served as a variant, historically encoded in a
  // `~pzn~` URL marker) is not present on EDS today — constant "[]" for now.
  // Extension point: parse the marker here to populate this when such URLs exist.
  appVars.pznPageRecDetailsArr = '[]';
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

// Enqueue ixp records (deduped by experiment_id). Cheap + synchronous.
export function recordIxp(records) {
  record(ixpById, records, 'experiment_id');
}

// Test-only: reset the accumulators between cases.
export function resetAnalytics() {
  pznById.clear();
  ixpById.clear();
  flushScheduled = false;
}
