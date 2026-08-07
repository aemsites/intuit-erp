import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';
import { resolveDeEntries } from '../src/de/resolve.js';
import { resolveDeRoute } from '../src/de/routes.js';
import { buildBatchRequest } from '../src/de/batch-client.js';

const IncomingRequest = Request;

const jsonHeaders = { 'content-type': 'application/json' };
const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };

// The real pzn placement + experience the treatment page is enrolled in.
const PLACEMENT = 'SBSEGQBMContentAemPznIxpTest';
const EXPERIENCE = 'marketing';
const BATCH_URL = env.DECISION_ENGINE_BATCH_URL;

/**
 * One batch response, keyed the way the pzn service keys it
 * (`<experience>_<placement>_<locale>`). A 200 carries a recommendation whose
 * `copyData.pznblock` is the fragment to inject; a non-200 status means "no
 * personalized recommendation for this slot" (leave it as authored).
 */
function batchResponse(pznblock, status = 200) {
  const key = `${EXPERIENCE}_${PLACEMENT}_en_US`;
  if (status !== 200) {
    return {
      [key]: {
        data: { recommendations: { fallback: true } },
        placement: PLACEMENT,
        experience: EXPERIENCE,
        status,
      },
    };
  }
  return {
    [key]: {
      data: {
        recommendations: {
          recommendation: [
            { copyData: { template: 'content', pznblock, contentId: '255044' } },
          ],
        },
      },
      placement: PLACEMENT,
      experience: EXPERIENCE,
      status: 200,
    },
  };
}

/**
 * Mocks the batch POST. `capture`, if given, receives `.init` (the fetch init)
 * so a test can assert method/headers/body. `response === null` → a 500.
 */
function mockBatch(response, capture) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl === BATCH_URL) {
      if (capture) capture.init = init;
      return response === null
        ? new Response('err', { status: 500 })
        : new Response(JSON.stringify(response), { status: 200, headers: jsonHeaders });
    }
    throw new Error(`unexpected fetch: ${reqUrl}`);
  });
}

function deRequest(path, init) {
  return new IncomingRequest(`https://worker.example.com${path}`, init);
}

// PZN_API_KEY is a Wrangler secret, so it is absent from the test env; supply it.
const DE_ENV = { ...env, PZN_API_KEY: 'test-pzn-key' };

// --- pure helpers -----------------------------------------------------------

describe('resolveDeRoute', () => {
  it('resolves the enrolled treatment page to its single real slot', () => {
    const route = resolveDeRoute('/drafts/pzn/treatment');
    expect(route?.slots.map((s) => s.location)).toEqual(['slot-1']);
    expect(route?.slots[0].placement).toBe(PLACEMENT);
    expect(route?.slots[0].experience).toBe(EXPERIENCE);
  });

  it('normalizes a trailing slash', () => {
    expect(resolveDeRoute('/drafts/pzn/treatment/')).not.toBeNull();
  });

  it('returns null for an unenrolled path', () => {
    expect(resolveDeRoute('/nope')).toBeNull();
  });
});

describe('buildBatchRequest', () => {
  it('emits one batchItem per slot (numberOfRecommendations 1, metadata true) + attributes', () => {
    const slots = [{ location: 'slot-1', placement: PLACEMENT, experience: EXPERIENCE }];
    const req = buildBatchRequest(slots, { ivid: 'abc', locale: 'en-US' });
    expect(req.batchItems).toEqual([
      {
        placement: PLACEMENT,
        experience: EXPERIENCE,
        numberOfRecommendations: 1,
        recommendationMetadata: true,
      },
    ]);
    expect(req.attributes).toEqual({ ivid: 'abc', locale: 'en-US' });
  });
});

// --- resolveDeEntries (batch → PznEntry[]) ----------------------------------

describe('resolveDeEntries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a 200 batch recommendation to a block-replace entry', async () => {
    mockBatch(batchResponse('fragments/pzn/slot1-hospitality'));
    const entries = await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'));
    expect(entries).toEqual([
      {
        path: '/drafts/pzn/treatment', fragment: 'fragments/pzn/slot1-hospitality', location: 'slot-1', action: 'replace', fidelity: 'block',
      },
    ]);
  });

  it('POSTs the batch with API-key auth, an intuit_tid, and the built body', async () => {
    const cap = {};
    mockBatch(batchResponse('fragments/pzn/slot1-hospitality'), cap);
    await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'));

    expect(cap.init.method).toBe('POST');
    expect(cap.init.headers.Authorization)
      .toBe('Intuit_APIKey intuit_apikey=test-pzn-key, intuit_apikey_version=1.0');
    expect(cap.init.headers['content-type']).toContain('json');
    expect(cap.init.headers.intuit_tid).toMatch(/^rp-/);

    const body = JSON.parse(cap.init.body);
    expect(body.batchItems).toEqual([
      {
        placement: PLACEMENT,
        experience: EXPERIENCE,
        numberOfRecommendations: 1,
        recommendationMetadata: true,
      },
    ]);
    expect(body.attributes).toMatchObject({
      ivid: 'abc', permalink: '/drafts/pzn/treatment', locale: 'en-US', newVisitor: true,
    });
  });

  it('leaves the slot as authored on a non-200 status', async () => {
    mockBatch(batchResponse(null, 204));
    expect(await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'))).toEqual([]);
  });

  it('returns [] when there is no ivid (no batch call)', async () => {
    const spy = mockBatch(batchResponse('fragments/pzn/slot1-hospitality'));
    expect(await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns [] on an unenrolled path (no calls)', async () => {
    const spy = mockBatch(batchResponse('fragments/pzn/slot1-hospitality'));
    expect(await resolveDeEntries(DE_ENV, deRequest('/nope?ivid=abc'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns [] when the batch call fails', async () => {
    mockBatch(null); // 500
    expect(await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'))).toEqual([]);
  });

  it('returns [] (passthrough) when PZN_API_KEY is not configured', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => { throw new Error('should not fetch'); });
    const noKeyEnv = { ...DE_ENV, PZN_API_KEY: undefined };
    expect(await resolveDeEntries(noKeyEnv, deRequest('/drafts/pzn/treatment?ivid=abc'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

// --- end-to-end through the worker in de mode -------------------------------

const TREATMENT_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<main>
  <div><div class="slot-1"><div>OLD SLOT 1</div></div></div>
</main>
</body></html>`;

const OFFER_1 = '<div><div class="offer"><div>NEW SLOT 1</div></div></div>';

/** Full DE fetch router: batch POST + offer fragment + origin page. */
function mockDeWorker(batch) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl === BATCH_URL) {
      return new Response(JSON.stringify(batch), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/fragments/pzn/slot1-hospitality')) {
      return new Response(OFFER_1, { status: 200, headers: htmlHeaders });
    }
    return new Response(TREATMENT_HTML, { status: 200, headers: htmlHeaders });
  });
}

async function runDe(path, headers) {
  const request = new IncomingRequest(`https://worker.example.com${path}`, { headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, DE_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('worker in de mode (?pzn=de)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fills the slot from the batch recommendation', async () => {
    mockDeWorker(batchResponse('fragments/pzn/slot1-hospitality'));
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de&ivid=abc')).text();
    expect(html).toContain('NEW SLOT 1');
    expect(html).not.toContain('OLD SLOT 1');
  });

  it('reads the ivid from a cookie (no query param)', async () => {
    mockDeWorker(batchResponse('fragments/pzn/slot1-hospitality'));
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de', { cookie: 'ivid=abc' })).text();
    expect(html).toContain('NEW SLOT 1');
  });

  it('leaves the page as authored on a non-200 recommendation', async () => {
    mockDeWorker(batchResponse(null, 204));
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de&ivid=abc')).text();
    expect(html).toContain('OLD SLOT 1');
  });

  it('passes through unchanged when there is no ivid', async () => {
    mockDeWorker(batchResponse('fragments/pzn/slot1-hospitality'));
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de')).text();
    expect(html).toBe(TREATMENT_HTML);
  });
});
