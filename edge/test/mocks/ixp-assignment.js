/**
 * Mock of Intuit's IXP Assignment API — `GET /us/v2/assignment` (test-only).
 *
 * Reproduces the contract from the shared spec ("AEM - Service Integration
 * Payloads") so the edge worker's IXP consumer can be exercised against the real
 * response shape *without* an API key — real calls need one and fire
 * assignment/exposure tracking (see the spec's Constraints), and the preview host
 * currently 403s for us. This is pure test scaffolding: it is not wired into the
 * worker. `ixp-consumer.spec.js` stands it up as a stub origin and points
 * `IXP_ASSIGNMENT_URL` at it; the worker itself only ever talks to the real host.
 *
 * This module is the pure contract: `(request, env) -> Response`. The fixture
 * catalog (which experiments exist and what they hand out) lives alongside it in
 * `ixp-fixtures.js`.
 */

import {
  bucketPercent, findFixtures, inScope, isBucketed,
} from './ixp-fixtures.js';

/**
 * IXP experiment types. `payload` drives page-level, `assetLocation` block-level.
 * @typedef {'REDIRECT' | 'REPLACE_WEB_CONTENT' | 'MAB_REDIRECT' | 'MAB_WEB_CONTENT' | 'DEFAULT'} ExperimentType
 */

/**
 * A single assignment object (see the spec's "Field reference").
 * @typedef {Object} Assignment
 * @property {number} experimentId
 * @property {ExperimentType} experimentType
 * @property {number} experimentVersion
 * @property {string} assignmentId Assignment id *type* — must be "IVID" for an ivid-based experiment.
 * @property {number} experimentFlags
 * @property {string} application
 * @property {string} businessUnit
 * @property {string} experimentKey
 * @property {string} country
 * @property {string} label
 * @property {number} id Treatment id.
 * @property {string} treatmentKey
 * @property {string} [treatmentName]
 * @property {string} payload JSON string. Page-level: `{ "intuit.com.integration.variation.html": <path> }`.
 * @property {string | null} assetLocation Block-level decision: an S3/content key the renderer fetches + injects.
 * @property {boolean} control True when this is the control arm (→ the worker should show the baseline).
 * @property {boolean} isAPIIL
 * @property {boolean} isAPIEL
 * @property {boolean} isExisting
 * @property {boolean} isPersistent
 */

/**
 * The `GET /us/v2/assignment` response body.
 * @typedef {Object} AssignmentResponse
 * @property {string} ivid
 * @property {string} transactionId
 * @property {Assignment[]} assignments
 * @property {string} [error] Present only on a graceful SDK error (still HTTP 200).
 */

/**
 * Env bindings for the mock (supplied by the tests, not `wrangler.jsonc`).
 * @typedef {Object} IxpMockEnv
 * @property {string} MOCK_API_KEY Expected value of `intuit_apikey=` in the Authorization header.
 * @property {string} EDGE_SVC_APP_NAME Default `application` when the query omits it.
 * @property {string} BU_NAME Default `businessUnit` when the query omits it.
 * @property {string} COUNTRY_CODE Default `country` when the query omits it.
 */

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {Response}
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Produces the assignment for a bucketed visitor. When a fixture defines a
 * `treatmentSplit`, the ivid is hashed to a stable arm: visitors outside the
 * split get the control arm (`control: true` ⇒ the worker shows the baseline).
 * The treatment fields are left intact — the consumer keys off `control` alone.
 * @param {import('./ixp-fixtures.js').Fixture} fixture
 * @param {number} experimentId
 * @param {string} ivid
 * @param {string} country
 * @returns {Assignment}
 */
function resolveArm(fixture, experimentId, ivid, country) {
  const arm = { ...fixture.assignment, country };
  if (fixture.treatmentSplit === undefined || fixture.assignment.control) return arm;
  const inTreatment = bucketPercent(ivid, experimentId) < fixture.treatmentSplit;
  if (inTreatment) return arm;
  return { ...arm, control: true, treatmentKey: `${arm.experimentKey}_C` };
}

/**
 * Validates the required auth header:
 *   `Authorization: Intuit_APIKey intuit_apikey=<key>, intuit_apikey_version=1.0`
 * @param {Request} request
 * @param {IxpMockEnv} env
 * @returns {boolean}
 */
function hasValidKey(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Intuit_APIKey\b/.test(auth)) return false;
  const match = auth.match(/intuit_apikey=([^,\s]+)/);
  return !!match && match[1] === env.MOCK_API_KEY;
}

/**
 * Handles a `GET .../v2/assignment` request against the fixture catalog.
 * Reproduces the spec's validation, scope, bucketing and error behavior.
 * @param {Request} request
 * @param {IxpMockEnv} env
 * @returns {Response}
 */
export function handleAssignment(request, env) {
  // --- auth (required) → 500 Invalid Key ---------------------------------
  if (!hasValidKey(request, env)) return json(500, { error: 'Invalid Key' });

  const url = new URL(request.url);
  const params = url.searchParams;

  // --- query validation → 400 -------------------------------------------
  const ivid = params.get('ivid');
  if (!ivid) return json(400, { error: 'Missing required query param: ivid' });

  const experimentIdRaw = params.get('experimentId');
  const label = params.get('label');
  if (experimentIdRaw === null && label === null) {
    return json(400, { error: 'Provide one of: experimentId, label' });
  }

  let experimentId;
  if (experimentIdRaw !== null) {
    if (!/^\d+$/.test(experimentIdRaw)) {
      return json(400, { error: 'experimentId must be numeric' });
    }
    experimentId = Number(experimentIdRaw);
  }

  const application = params.get('application') ?? env.EDGE_SVC_APP_NAME;
  const businessUnit = params.get('businessUnit') ?? env.BU_NAME;
  const country = params.get('country') ?? env.COUNTRY_CODE;

  const transactionId = crypto.randomUUID();
  const base = { ivid, transactionId };

  // --- graceful branches (all HTTP 200) ----------------------------------
  // Cache scope: experiment must sit under an allowed BU/app, else nothing
  // resolves from the shared local cache.
  if (!inScope(application, businessUnit)) {
    return json(200, { ...base, assignments: [] });
  }
  // Bucketing: a user not bucketed into anything gets empty assignments.
  if (!isBucketed(ivid)) {
    return json(200, { ...base, assignments: [] });
  }

  const matched = findFixtures({ experimentId, label: label ?? undefined });
  const assignments = [];
  let sdkError = null;

  for (const { id, fixture } of matched) {
    // ivid-typed only: a non-IVID-typed experiment yields no assignment and a
    // graceful SDK error rather than a treatment.
    if (fixture.ividTyped === false) {
      sdkError = 'assignment id type is not IVID';
    } else {
      assignments.push(resolveArm(fixture, id, ivid, country));
    }
  }

  if (assignments.length === 0 && sdkError) {
    return json(200, { ...base, assignments: [], error: sdkError });
  }
  return json(200, { ...base, assignments });
}
