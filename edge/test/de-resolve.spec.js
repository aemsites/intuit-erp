import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import worker from '../src/index.js';
import { resolveDeEntries } from '../src/de/resolve.js';
import { resolveDeRoute } from '../src/de/routes.js';
import { fetchVisitorContext } from '../src/de/zoominfo.js';
import { buildBatchRequest } from '../src/de/batch-client.js';

const IncomingRequest = Request;

const ORIGIN = env.ORIGIN_BASE_URL;
const jsonHeaders = { 'content-type': 'application/json' };
const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };

const PLACEMENT_1 = 'CGTTCOMMContentTTLCTY255044';
const PLACEMENT_2 = 'CGTTCOMMContentTTLCTY255044Modal';

/** ZoomInfo context body with a given primary industry (omit for "no industry"). */
function zoominfoBody(industry) {
  const attributes = [{ attributeName: 'zi_c_company_name', attributeValue: 'Acme Co' }];
  if (industry) attributes.push({ attributeName: 'zi_c_industry_primary', attributeValue: industry });
  return { marketingProfile: { zoominfo: { attributes } } };
}

/** One batch response entry for a placement (status 200 with a contentId, or 204). */
function batchEntry(placement, contentId) {
  if (contentId === null) {
    return {
      data: { recommendations: { fallback: true, fallbackMessage: '' } },
      placement,
      experience: 'ttcom',
      status: 204,
    };
  }
  return {
    data: {
      recommendations: [
        {
          id: 'x', score: 10, copyData: { template: 'content', contentId }, placement,
        },
      ],
    },
    placement,
    experience: 'ttcom',
    status: 200,
  };
}

// --- pure helpers -----------------------------------------------------------

describe('resolveDeRoute', () => {
  it('resolves the enrolled treatment page to its two slots', () => {
    const route = resolveDeRoute('/drafts/pzn/treatment');
    expect(route?.slots.map((s) => s.location)).toEqual(['slot-1', 'slot-2']);
    expect(route?.slots[0].placement).toBe(PLACEMENT_1);
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
    const slots = [{ location: 'slot-1', placement: PLACEMENT_1, experience: 'ttcom' }];
    const req = buildBatchRequest(slots, { ivid: 'abc', industry: 'Hospitality' });
    expect(req.batchItems).toEqual([
      {
        placement: PLACEMENT_1, experience: 'ttcom', numberOfRecommendations: 1, recommendationMetadata: true,
      },
    ]);
    expect(req.attributes).toEqual({ ivid: 'abc', industry: 'Hospitality' });
  });
});

describe('fetchVisitorContext', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses the primary industry from the zoominfo attribute list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(zoominfoBody('Hospitality')), { status: 200, headers: jsonHeaders }),
    );
    expect(await fetchVisitorContext({ ZOOMINFO_URL: 'https://x/z.json' }, 'abc'))
      .toEqual({ industry: 'Hospitality' });
  });

  it('returns an empty context when no industry attribute is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(zoominfoBody()), { status: 200, headers: jsonHeaders }),
    );
    expect(await fetchVisitorContext({ ZOOMINFO_URL: 'https://x/z.json' }, 'abc')).toEqual({});
  });

  it('returns null on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await fetchVisitorContext({ ZOOMINFO_URL: 'https://x/z.json' }, 'abc')).toBeNull();
  });

  it('returns null when no URL is configured', async () => {
    expect(await fetchVisitorContext({}, 'abc')).toBeNull();
  });
});

// --- resolveDeEntries (zoominfo + batch → PznEntry[]) -----------------------

const DE_ENV = {
  ...env,
  ZOOMINFO_URL: `${ORIGIN}/pzn/zoominfo/context.json`,
  DECISION_ENGINE_BATCH_URL: `${ORIGIN}/pzn/de`,
};

/**
 * Routes mocked fetches for the DE flow: zoominfo returns `zi`, the industry and
 * default batch files return `hospitality`/`fallback` respectively.
 */
function mockDe({ zi, hospitality, fallback }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl.includes('/pzn/zoominfo/')) {
      return zi === null
        ? new Response('nope', { status: 404 })
        : new Response(JSON.stringify(zi), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/pzn/de/batch-hospitality.json')) {
      return hospitality
        ? new Response(JSON.stringify(hospitality), { status: 200, headers: jsonHeaders })
        : new Response('nope', { status: 404 });
    }
    if (reqUrl.includes('/pzn/de/batch-default.json')) {
      return fallback
        ? new Response(JSON.stringify(fallback), { status: 200, headers: jsonHeaders })
        : new Response('nope', { status: 404 });
    }
    throw new Error(`unexpected fetch: ${reqUrl}`);
  });
}

function deRequest(path) {
  return new IncomingRequest(`https://worker.example.com${path}`);
}

describe('resolveDeEntries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a two-slot 200 batch (industry variant) to two block-replace entries', async () => {
    mockDe({
      zi: zoominfoBody('Hospitality'),
      hospitality: {
        [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-hospitality'),
        [`ttcom_${PLACEMENT_2}_en_US`]: batchEntry(PLACEMENT_2, '/fragments/pzn/slot2-hospitality'),
      },
    });
    const entries = await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'));
    expect(entries).toEqual([
      {
        path: '/drafts/pzn/treatment', fragment: '/fragments/pzn/slot1-hospitality', location: 'slot-1', action: 'replace', fidelity: 'block',
      },
      {
        path: '/drafts/pzn/treatment', fragment: '/fragments/pzn/slot2-hospitality', location: 'slot-2', action: 'replace', fidelity: 'block',
      },
    ]);
  });

  it('skips a status-204 slot (falls back to the default variant when no industry)', async () => {
    mockDe({
      zi: zoominfoBody(), // no industry → default variant
      fallback: {
        [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-default'),
        [`ttcom_${PLACEMENT_2}_en_US`]: batchEntry(PLACEMENT_2, null), // 204 → skipped
      },
    });
    const entries = await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ location: 'slot-1', fragment: '/fragments/pzn/slot1-default' });
  });

  it('returns [] when there is no ivid (no zoominfo/batch call)', async () => {
    const spy = mockDe({ zi: zoominfoBody('Hospitality') });
    expect(await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns [] on an unenrolled path (no calls)', async () => {
    const spy = mockDe({ zi: zoominfoBody('Hospitality') });
    expect(await resolveDeEntries(DE_ENV, deRequest('/nope?ivid=abc'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still personalizes via the default variant when zoominfo fails', async () => {
    mockDe({
      zi: null, // zoominfo 404 → no industry → default variant
      fallback: { [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-default') },
    });
    const entries = await resolveDeEntries(DE_ENV, deRequest('/drafts/pzn/treatment?ivid=abc'));
    expect(entries).toHaveLength(1);
  });
});

// --- end-to-end through the worker in de mode -------------------------------

const TREATMENT_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<main>
  <div><div class="slot-1"><div>OLD SLOT 1</div></div></div>
  <div><div class="slot-2"><div>OLD SLOT 2</div></div></div>
</main>
</body></html>`;

const OFFER_1 = '<div><div class="offer"><div>NEW SLOT 1</div></div></div>';
const OFFER_2 = '<div><div class="offer"><div>NEW SLOT 2</div></div></div>';
const OFFER_D1 = '<div><div class="offer"><div>DEFAULT SLOT 1</div></div></div>';

/** Full DE fetch router: zoominfo + batch variants + offer fragments + origin page. */
function mockDeWorker({ zi, hospitality, fallback }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    if (reqUrl.includes('/pzn/zoominfo/')) {
      return zi === null
        ? new Response('nope', { status: 404 })
        : new Response(JSON.stringify(zi), { status: 200, headers: jsonHeaders });
    }
    if (reqUrl.includes('/pzn/de/batch-hospitality.json')) {
      return hospitality
        ? new Response(JSON.stringify(hospitality), { status: 200, headers: jsonHeaders })
        : new Response('nope', { status: 404 });
    }
    if (reqUrl.includes('/pzn/de/batch-default.json')) {
      return fallback
        ? new Response(JSON.stringify(fallback), { status: 200, headers: jsonHeaders })
        : new Response('nope', { status: 404 });
    }
    if (reqUrl.includes('/fragments/pzn/slot1-hospitality')) return new Response(OFFER_1, { status: 200, headers: htmlHeaders });
    if (reqUrl.includes('/fragments/pzn/slot2-hospitality')) return new Response(OFFER_2, { status: 200, headers: htmlHeaders });
    if (reqUrl.includes('/fragments/pzn/slot1-default')) return new Response(OFFER_D1, { status: 200, headers: htmlHeaders });
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

  it('fills both slots from the industry batch variant', async () => {
    mockDeWorker({
      zi: zoominfoBody('Hospitality'),
      hospitality: {
        [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-hospitality'),
        [`ttcom_${PLACEMENT_2}_en_US`]: batchEntry(PLACEMENT_2, '/fragments/pzn/slot2-hospitality'),
      },
    });
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de&ivid=abc')).text();
    expect(html).toContain('NEW SLOT 1');
    expect(html).toContain('NEW SLOT 2');
    expect(html).not.toContain('OLD SLOT 1');
    expect(html).not.toContain('OLD SLOT 2');
  });

  it('replaces only the 200 slot and leaves the 204 slot as authored', async () => {
    mockDeWorker({
      zi: zoominfoBody(),
      fallback: {
        [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-default'),
        [`ttcom_${PLACEMENT_2}_en_US`]: batchEntry(PLACEMENT_2, null),
      },
    });
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de&ivid=abc')).text();
    expect(html).toContain('DEFAULT SLOT 1');
    expect(html).not.toContain('OLD SLOT 1');
    expect(html).toContain('OLD SLOT 2'); // 204 → untouched
  });

  it('reads the ivid from a cookie', async () => {
    mockDeWorker({
      zi: zoominfoBody('Hospitality'),
      hospitality: { [`ttcom_${PLACEMENT_1}_en_US`]: batchEntry(PLACEMENT_1, '/fragments/pzn/slot1-hospitality') },
    });
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de', { cookie: 'ivid=abc' })).text();
    expect(html).toContain('NEW SLOT 1');
  });

  it('passes through unchanged when there is no ivid', async () => {
    mockDeWorker({ zi: zoominfoBody('Hospitality') });
    const html = await (await runDe('/drafts/pzn/treatment?pzn=de')).text();
    expect(html).toBe(TREATMENT_HTML);
  });
});
