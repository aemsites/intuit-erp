/**
 * In-process mock source — the "no key required" demo path.
 *
 * Resolves a `PznEntry` by calling the IXP mock's `handleAssignment` directly
 * (no network hop, no API key), reusing the exact routing + mapping logic the
 * real IXP path uses (`resolveEntryWith`). Selected by `PZN_SOURCE=mock` or
 * `?pzn=mock`; the real `ixp` path is left untouched.
 *
 * Demo knobs, all optional (the mock fabricates everything else):
 *   - `?ivid=`         — the visitor id; selects the A/B arm (stable per ivid).
 *   - `?experimentId=` — override which experiment to resolve (e.g. 39001 = a
 *                        page-level redirect, 39002 = the block A/B, 39003 =
 *                        control). Defaults to the enrolled route's experiment.
 *   - `?label=`        — same, by label regex.
 * The route still supplies *where* a block treatment lands (location/fidelity),
 * so the path must be enrolled in `IXP_ROUTES`.
 */

import { handleAssignment } from '../mock/ixp-assignment.js';
import { resolveEntryWith } from './resolve.js';

/**
 * @typedef {import('../personalize.js').PznEntry} PznEntry
 * @typedef {import('../mock/ixp-assignment.js').IxpMockEnv} IxpMockEnv
 */

/** Fixed mock env for the in-process demo (mirrors `wrangler.jsonc`). */
const MOCK_ENV = {
  MOCK_API_KEY: 'dev-ixp-key',
  EDGE_SVC_APP_NAME: 'SBGM',
  BU_NAME: 'SBSEG',
  COUNTRY_CODE: 'US',
};

/** Auth header matching `MOCK_ENV.MOCK_API_KEY` (we call the mock in-process). */
const MOCK_AUTH = `Intuit_APIKey intuit_apikey=${MOCK_ENV.MOCK_API_KEY}, intuit_apikey_version=1.0`;

/**
 * Resolves a `PznEntry` via the in-process IXP mock, or null (passthrough). A
 * `?experimentId=` / `?label=` query param overrides which experiment the mock
 * resolves; the enrolled route still supplies the target slot.
 * @param {Request} request
 * @returns {Promise<PznEntry | null>}
 */
export function resolveMockEntry(request) {
  const params = new URL(request.url).searchParams;
  const expOverride = params.get('experimentId');
  const labelOverride = params.get('label');

  return resolveEntryWith(request, async ({ ivid, experimentId, label }) => {
    const expId = expOverride && /^\d+$/.test(expOverride) ? Number(expOverride) : experimentId;
    const lbl = labelOverride ?? label;

    const url = new URL('https://mock.internal/us/v2/assignment');
    url.searchParams.set('ivid', ivid);
    if (expId !== undefined) url.searchParams.set('experimentId', String(expId));
    if (lbl !== undefined) url.searchParams.set('label', lbl);

    const mockRequest = new Request(url.toString(), { headers: { Authorization: MOCK_AUTH } });
    const res = handleAssignment(mockRequest, MOCK_ENV);
    if (!res.ok) return null;
    return res.json();
  });
}
