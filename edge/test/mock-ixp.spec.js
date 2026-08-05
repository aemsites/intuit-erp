import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { handleAssignment } from '../src/mock/ixp-assignment.js';
import { bucketPercent } from '../src/mock/ixp-fixtures.js';

const IncomingRequest = Request;

const ENV = {
  MOCK_API_KEY: 'test-key',
  EDGE_SVC_APP_NAME: 'SBGM',
  BU_NAME: 'SBSEG',
  COUNTRY_CODE: 'US',
};

const AUTH = 'Intuit_APIKey intuit_apikey=test-key, intuit_apikey_version=1.0';
// The consolidated worker uses the wrangler.jsonc MOCK_API_KEY (dev-ixp-key).
const DEV_AUTH = 'Intuit_APIKey intuit_apikey=dev-ixp-key, intuit_apikey_version=1.0';
const REAL_IVID = 'd3878e74-ba78-4e1d-afea-3be26957721a';

/** Calls the handler directly with a constructed request. */
function call(query, opts = {}) {
  const auth = opts.auth === undefined ? AUTH : opts.auth;
  const headers = auth ? { Authorization: auth } : {};
  const req = new Request(`https://mock.example.com/us/v2/assignment${query}`, { method: 'GET', headers });
  return handleAssignment(req, ENV);
}

async function bodyOf(res) {
  return res.json();
}

describe('IXP assignment mock - contract', () => {
  it('500 Invalid Key when the auth header is missing', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=15972`, { auth: null });
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error).toBe('Invalid Key');
  });

  it('500 Invalid Key when the key does not match', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=15972`, {
      auth: 'Intuit_APIKey intuit_apikey=wrong, intuit_apikey_version=1.0',
    });
    expect(res.status).toBe(500);
  });

  it('400 when ivid is missing', async () => {
    const res = call('?experimentId=15972');
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('Missing required query param: ivid');
  });

  it('400 when experimentId is non-numeric', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=abc`);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('experimentId must be numeric');
  });

  it('400 when neither experimentId nor label is provided', async () => {
    const res = call(`?ivid=${REAL_IVID}`);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('Provide one of: experimentId, label');
  });

  it('looks up by experimentId -> single assignment, echoes ivid + transactionId', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=15972`);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.ivid).toBe(REAL_IVID);
    expect(body.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].experimentId).toBe(15972);
    expect(body.assignments[0].control).toBe(true);
  });

  it('looks up by label (regex) -> matches the same fixture', async () => {
    const res = call(`?ivid=${REAL_IVID}&label=081008a2-f507-429a-a408-1d10a7fb4810`);
    const body = await bodyOf(res);
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].experimentId).toBe(15972);
  });

  it('label regex may match multiple experiments', async () => {
    const res = call(`?ivid=${REAL_IVID}&label=ERP-HERO-`);
    const ids = (await bodyOf(res)).assignments.map((a) => a.experimentId).sort();
    expect(ids).toEqual([39001, 39002, 39003, 39005]);
  });

  it('page-level treatment carries a payload with sourceUrl/variationUrl', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=39001`);
    const a = (await bodyOf(res)).assignments[0];
    expect(a.experimentType).toBe('REDIRECT');
    expect(a.assetLocation).toBeNull();
    expect(JSON.parse(a.payload)).toEqual({
      sourceUrl: '/drafts/suresh/pzn',
      variationUrl: '/drafts/suresh/pzn-variant',
    });
  });

  it('block-level treatment carries an assetLocation content key', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=39002`);
    const a = (await bodyOf(res)).assignments[0];
    expect(a.experimentType).toBe('REPLACE_WEB_CONTENT');
    expect(a.assetLocation).toBe('/fragments/pzn/automation');
  });

  it('control arm is flagged control:true', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=39003`);
    expect((await bodyOf(res)).assignments[0].control).toBe(true);
  });

  it('unbucketed ivid -> empty assignments', async () => {
    const res = call('?ivid=11111-1111-111-111-11111&experimentId=15972');
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).assignments).toEqual([]);
  });

  it('unknown experimentId -> empty assignments', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=99999`);
    expect((await bodyOf(res)).assignments).toEqual([]);
  });

  it('out-of-scope businessUnit -> empty assignments', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=15972&businessUnit=NOPE`);
    expect((await bodyOf(res)).assignments).toEqual([]);
  });

  it('non-IVID-typed experiment -> 200, empty assignments + graceful error', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=39004`);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.assignments).toEqual([]);
    expect(body.error).toMatch(/IVID/);
  });

  it('stamps the requested country onto returned assignments', async () => {
    const res = call(`?ivid=${REAL_IVID}&experimentId=15972&country=CA`);
    expect((await bodyOf(res)).assignments[0].country).toBe('CA');
  });
});

describe('IXP assignment mock - A/B arm split (treatmentSplit)', () => {
  it('bucketPercent is deterministic and within 0-99', () => {
    const a = bucketPercent('visitor-x', 39002);
    expect(a).toBe(bucketPercent('visitor-x', 39002));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('assigns a stable arm to the same visitor across calls', async () => {
    const one = (await bodyOf(call('?ivid=stable-visitor&experimentId=39002'))).assignments[0].control;
    const two = (await bodyOf(call('?ivid=stable-visitor&experimentId=39002'))).assignments[0].control;
    expect(one).toBe(two);
  });

  it('splits bucketed visitors into both control and treatment for 39002', async () => {
    const arms = new Set();
    for (let i = 0; i < 40; i += 1) {
      const res = call(`?ivid=visitor-${i}&experimentId=39002`);
      // eslint-disable-next-line no-await-in-loop
      arms.add((await bodyOf(res)).assignments[0].control);
    }
    expect(arms.has(true)).toBe(true); // some land in control (baseline)
    expect(arms.has(false)).toBe(true); // some land in treatment (offer)
  });

  it('keeps the treatment fields on the assignment regardless of arm', async () => {
    // The consumer keys off `control`; treatment fields remain for either arm.
    const a = (await bodyOf(call('?ivid=visitor-1a&experimentId=39002'))).assignments[0];
    expect(a.assetLocation).toBe('/fragments/pzn/automation');
  });
});

describe('IXP assignment mock - served from the consolidated worker route', () => {
  async function route(path, { auth = DEV_AUTH } = {}) {
    const headers = auth ? { Authorization: auth } : {};
    const req = new IncomingRequest(`https://worker.example.com${path}`, { method: 'GET', headers });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it('serves the /us/v2/assignment route', async () => {
    const res = await route(`/us/v2/assignment?ivid=${REAL_IVID}&experimentId=15972`);
    expect(res.status).toBe(200);
    expect((await res.json()).assignments).toHaveLength(1);
  });

  it('also serves the bare /v2/assignment route', async () => {
    const res = await route(`/v2/assignment?ivid=${REAL_IVID}&experimentId=15972`);
    expect(res.status).toBe(200);
  });

  it('enforces the mock auth on the route (500 Invalid Key)', async () => {
    const res = await route(`/us/v2/assignment?ivid=${REAL_IVID}&experimentId=15972`, { auth: null });
    expect(res.status).toBe(500);
  });
});
