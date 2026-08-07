/**
 * Client for Intuit's IXP Assignment API — `GET .../v2/assignment`.
 *
 * This is the edge worker's view of the *real* service. It is deliberately
 * decoupled from the test mock (`test/mocks/*`): both independently model the
 * same wire contract. `IXP_ASSIGNMENT_URL` points at
 * `experimentation[-preview].us.api.intuit.com`; the `IXP_API_KEY` it
 * authenticates with is a `wrangler secret` (never in vars/committed).
 *
 * Only the fields the consumer actually reads are documented here (the full field
 * reference lives in the spec / the mock). The API answers graceful cases with
 * HTTP 200 + empty `assignments`, so a null return means a transport/parse
 * failure only — the caller treats either as "no personalization" (passthrough).
 */

/**
 * IXP experiment types. `payload` drives page-level, `assetLocation` block-level.
 * @typedef {'REDIRECT' | 'REPLACE_WEB_CONTENT' | 'MAB_REDIRECT' | 'MAB_WEB_CONTENT' | 'DEFAULT'} IxpExperimentType
 */

/**
 * The subset of an assignment the edge worker consumes.
 * @typedef {Object} IxpAssignment
 * @property {number} experimentId
 * @property {IxpExperimentType} experimentType
 * @property {string} label
 * @property {string} payload JSON string. Page-level decision: `{ "intuit.com.integration.variation.html": <path> }`.
 * @property {string | null} assetLocation Block-level decision: a content ref the renderer fetches + injects.
 * @property {boolean} control True on the control arm ⇒ the worker shows the baseline (passthrough).
 */

/**
 * The `GET .../v2/assignment` response body (fields the worker reads).
 * @typedef {Object} IxpAssignmentResponse
 * @property {string} ivid
 * @property {string} transactionId
 * @property {IxpAssignment[]} assignments
 * @property {string} [error] Present only on a graceful SDK error (still HTTP 200).
 */

/**
 * Env bindings the client needs (see `wrangler.jsonc`).
 * @typedef {Object} IxpClientEnv
 * @property {string} IXP_ASSIGNMENT_URL Full URL of the assignment endpoint (mock or real host).
 * @property {string} IXP_API_KEY API key sent as `intuit_apikey=` in the Authorization header.
 */

/**
 * @typedef {Object} FetchAssignmentParams
 * @property {string} ivid
 * @property {number} [experimentId] Exact experiment id (numeric). Provide this or `label`.
 * @property {string} [label] Label regex. Provide this or `experimentId`.
 * @property {string} [application]
 * @property {string} [businessUnit]
 * @property {string} [country]
 */

/**
 * Builds the required `Authorization` header value.
 * @param {string} apiKey
 * @returns {string}
 */
function authHeader(apiKey) {
  return `Intuit_APIKey intuit_apikey=${apiKey}, intuit_apikey_version=1.0`;
}

/**
 * Calls the IXP Assignment API. Returns the parsed body, or null on any
 * transport/parse failure (the caller falls back to an untouched passthrough).
 * @param {IxpClientEnv} env
 * @param {FetchAssignmentParams} params
 * @returns {Promise<IxpAssignmentResponse | null>}
 */
export async function fetchAssignment(env, params) {
  const url = new URL(env.IXP_ASSIGNMENT_URL);
  url.searchParams.set('ivid', params.ivid);
  if (params.experimentId !== undefined) url.searchParams.set('experimentId', String(params.experimentId));
  if (params.label !== undefined) url.searchParams.set('label', params.label);
  if (params.application) url.searchParams.set('application', params.application);
  if (params.businessUnit) url.searchParams.set('businessUnit', params.businessUnit);
  if (params.country) url.searchParams.set('country', params.country);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: authHeader(env.IXP_API_KEY) },
      // Assignments are per-visitor; do not share across the edge cache.
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return null; // 4xx/5xx (auth/validation) ⇒ no personalization
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}
