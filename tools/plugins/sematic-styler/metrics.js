/*
 * In-memory instrumentation for the Semantic Styler plugin. Nothing is sent anywhere: in DevTools,
 * with the plugin iframe as the JavaScript context, run `semanticStyler.metrics()` for a summary
 * and `semanticStyler.metrics.raw()` for the recorded operations.
 */

const MAX_RECORDS = 200;
const ops = [];
const syncs = [];
const selections = [];

const push = (list, item) => {
  list.push(item);
  if (list.length > MAX_RECORDS) list.shift();
};

export const now = () => performance.now();

/** Starts recording one save operation (read, transform, save, verify, with retries). */
export function startOp() {
  const op = {
    at: new Date().toISOString(),
    t0: now(),
    attempts: 0,
    retries: [],
    fetchMs: 0,
    transformMs: 0,
    saveMs: 0,
    verifyMs: 0,
  };
  push(ops, op);
  return op;
}

/**
 * Ends a save operation. `outcome` is 'saved', 'already-saved' (an earlier attempt landed, or
 * the editor already showed it), 'nothing-to-save', 'failed', and for edits made in the editor
 * ('editor' `path`) also 'fallback' (handed to a source save) or 'unconfirmed' (applied, save
 * not confirmed); `reason` says why.
 */
export function endOp(op, outcome, reason) {
  op.totalMs = now() - op.t0;
  op.outcome = outcome;
  if (reason) op.reason = reason;
}

/** How long the editor took to show a saved change (`ok` false: it never did in time). */
export const recordSync = (ms, ok) => push(syncs, { ms, ok });

/** One selection read from the editor (`ok` false: it failed or timed out). */
export const recordSelection = (ms, ok) => push(selections, { ms, ok });

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0 };
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    n: sorted.length,
    median: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(sorted.at(-1)),
  };
}

const rate = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');

/** Success rates, retry counts, failure reasons and duration percentiles. */
export function summary() {
  // 'fallback': the editor couldn't take the change, so a source save (recorded on its own) did.
  const done = ops.filter((op) => op.outcome && !['nothing-to-save', 'fallback'].includes(op.outcome));
  // 'unconfirmed' (applied in the editor, save not confirmed) does not count as a success.
  const succeeded = done.filter((op) => ['saved', 'already-saved'].includes(op.outcome));
  const byPath = (path) => {
    const mine = done.filter((op) => (op.path || 'source') === path);
    return {
      operations: mine.length,
      success: rate(mine.filter((op) => succeeded.includes(op)).length, mine.length),
      totalMs: stats(mine.map((op) => op.totalMs)),
    };
  };
  const reasons = {};
  done.filter((op) => !succeeded.includes(op))
    .forEach((op) => { reasons[op.reason] = (reasons[op.reason] || 0) + 1; });
  const fallbacks = {};
  ops.filter((op) => op.outcome === 'fallback')
    .forEach((op) => { fallbacks[op.reason] = (fallbacks[op.reason] || 0) + 1; });
  const retryReasons = {};
  ops.flatMap((op) => op.retries)
    .forEach((why) => { retryReasons[why] = (retryReasons[why] || 0) + 1; });
  return {
    operations: done.length,
    firstAttemptSuccess: rate(succeeded.filter((op) => op.attempts === 1).length, done.length),
    finalSuccess: rate(succeeded.length, done.length),
    retries: ops.reduce((n, op) => n + op.retries.length, 0),
    retryReasons,
    failureReasons: reasons,
    // Edits made in the editor ('editor') vs. through a source save ('source').
    paths: { editor: byPath('editor'), source: byPath('source') },
    editorFallbacks: fallbacks,
    editorSyncSuccess: rate(syncs.filter((s) => s.ok).length, syncs.length),
    durationsMs: {
      fetch: stats(done.map((op) => op.fetchMs)),
      transform: stats(done.map((op) => op.transformMs)),
      save: stats(done.map((op) => op.saveMs)),
      verify: stats(done.map((op) => op.verifyMs)),
      saveTotal: stats(done.map((op) => op.totalMs)),
      editorSync: stats(syncs.filter((s) => s.ok).map((s) => s.ms)),
      selection: stats(selections.filter((s) => s.ok).map((s) => s.ms)),
    },
    selectionFailures: selections.filter((s) => !s.ok).length,
  };
}

function metrics() {
  const s = summary();
  /* eslint-disable no-console */
  console.log('[sematic-styler] metrics', s);
  console.table(s.durationsMs);
  /* eslint-enable no-console */
  return s;
}
metrics.raw = () => ({ ops: [...ops], syncs: [...syncs], selections: [...selections] });
metrics.reset = () => { ops.length = 0; syncs.length = 0; selections.length = 0; };

if (typeof window !== 'undefined') {
  window.semanticStyler = { ...window.semanticStyler, metrics };
}
