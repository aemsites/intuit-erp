/**
 * In-worker IXP assignment mock — a sticky 50/50 split by `ivid`, so the IXP
 * flows are demoable end-to-end **without** the real key (which currently 403s and
 * fires real exposure tracking). Enabled with `IXP_MOCK=enabled`; the swap to the
 * real service is one env change (unset `IXP_MOCK`, set `IXP_ASSIGNMENT_URL` +
 * the `IXP_API_KEY` secret) with no code change.
 *
 * This is the src counterpart of the richer `test/mocks/*` catalog (src cannot
 * import from test), reduced to the experiments the POC demo needs and matching
 * their FNV-1a bucketing so behavior is identical. Returns the subset of the
 * `GET /v2/assignment` body the worker actually reads (see `ixp/client.js`).
 */

/**
 * Demo experiments the mock knows about, keyed by experimentId. `split` is the
 * percentage of visitors (stable per ivid) assigned the treatment arm.
 * @type {Record<number, { experimentType: string, split: number }>}
 */
export const MOCK_EXPERIMENTS = {
  // The client-flow IXP page-level redirect A/B (/drafts/pzn-demo/experiment).
  39100: { experimentType: 'REDIRECT', split: 50 },
};

/**
 * Deterministic 0–99 bucket for an ivid within an experiment (FNV-1a). Stable per
 * visitor — the same ivid always resolves to the same arm. Mirrors the test mock.
 * @param {string} ivid
 * @param {number} experimentId
 * @returns {number}
 */
function bucketPercent(ivid, experimentId) {
  const s = `${ivid}:${experimentId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * Returns a mock IXP assignment response for the params, or a graceful empty
 * response for an unknown experiment / missing ivid. Shape matches the real
 * `GET /v2/assignment` body (the subset the worker consumes).
 * @param {{ ivid: string, experimentId?: number, label?: string }} params
 * @returns {import('./client.js').IxpAssignmentResponse}
 */
export function mockAssignment(params) {
  const { ivid, experimentId } = params;
  const base = { ivid, transactionId: crypto.randomUUID(), assignments: [] };

  const exp = experimentId != null ? MOCK_EXPERIMENTS[experimentId] : undefined;
  if (!ivid || !exp) return base;

  const control = bucketPercent(ivid, experimentId) >= exp.split;
  return {
    ...base,
    assignments: [{
      experimentId,
      experimentType: exp.experimentType,
      experimentVersion: 1,
      assignmentId: 'IVID',
      label: '',
      payload: '',
      assetLocation: null,
      control,
    }],
  };
}
