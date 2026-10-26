import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  extractSegmentIds, parseRules, matchRule, resolveAepPersonalization,
  readCachedSegments, whenSegmentIds, eagerLookup, resetAepLookup,
} from '../scripts/aep-pzn.js';

describe('aep-pzn', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    window.hlx = { aepSegmentIds: ['seg-b'] };
    window.localStorage.clear();
    resetAepLookup();
  });

  it('extracts segment ids from a nested interact response', () => {
    const data = { handle: [{ payload: [{ segments: [{ id: 'seg-a', namespace: 'ups' }] }] }] };
    expect(extractSegmentIds(data)).toEqual(['seg-a']);
    expect(extractSegmentIds({ handle: [] })).toEqual([]);
  });

  it('parses AEM sheet and plain-map rules', () => {
    expect(parseRules({ data: [{ SegmentId: 'a', ContentId: '/f/a ' }, { segmentId: '', contentId: 'x' }] }))
      .toEqual([{ segmentId: 'a', contentId: '/f/a' }]);
    expect(parseRules({ a: '/f/a' })).toEqual([{ segmentId: 'a', contentId: '/f/a' }]);
  });

  it('parses the real homepage-pzn-rules sheet', () => {
    const sheet = {
      total: 1,
      limit: 1,
      offset: 0,
      data: [{
        SegmentId: 'a8349e7b-5694-40fa-9f99-1a769fb2b548',
        ContentId: '/fragments/ftc/ies-comparison-hero',
      }],
      ':type': 'sheet',
    };
    expect(parseRules(sheet)).toEqual([{
      segmentId: 'a8349e7b-5694-40fa-9f99-1a769fb2b548',
      contentId: '/fragments/ftc/ies-comparison-hero',
    }]);
  });

  it('reads SegmentPriority as a number and ignores blank or non-numeric values', () => {
    const rows = parseRules({
      data: [
        { SegmentId: 'a', ContentId: '/f/a', SegmentPriority: '10' },
        { SegmentId: 'b', ContentId: '/f/b', SegmentPriority: 2 },
        { SegmentId: 'c', ContentId: '/f/c', SegmentPriority: '' },
        { SegmentId: 'd', ContentId: '/f/d', SegmentPriority: 'high' },
        { SegmentId: 'e', ContentId: '/f/e' },
      ],
    });
    expect(rows.map((r) => r.priority)).toEqual([10, 2, undefined, undefined, undefined]);
  });

  describe('matchRule with several matching segments', () => {
    const rules = [
      { segmentId: 'low', contentId: '/f/low', priority: 1 },
      { segmentId: 'high', contentId: '/f/high', priority: 10 },
      { segmentId: 'mid', contentId: '/f/mid', priority: 5 },
      { segmentId: 'none', contentId: '/f/none' },
    ];
    it('picks the HIGHEST priority number among the segments the user is in', () => {
      expect(matchRule(rules, ['low', 'mid', 'high']).contentId).toBe('/f/high');
      expect(matchRule(rules, ['low', 'mid']).contentId).toBe('/f/mid');
    });
    it('ranks a row without a priority lowest', () => {
      expect(matchRule(rules, ['none', 'low']).contentId).toBe('/f/low');
      expect(matchRule(rules, ['none']).contentId).toBe('/f/none');
    });
    it('keeps sheet order on equal priorities, and when no row has a priority', () => {
      const ties = [
        { segmentId: 'x', contentId: '/f/x', priority: 5 },
        { segmentId: 'y', contentId: '/f/y', priority: 5 },
      ];
      expect(matchRule(ties, ['y', 'x']).contentId).toBe('/f/x');
      const plain = [{ segmentId: 'p', contentId: '/f/p' }, { segmentId: 'q', contentId: '/f/q' }];
      expect(matchRule(plain, ['q', 'p']).contentId).toBe('/f/p');
    });
    it('returns null when the user is in none of the segments', () => {
      expect(matchRule(rules, ['other'])).toBeNull();
    });
  });

  it('matches the first rule whose segment the user has', () => {
    const rules = [{ segmentId: 'a', contentId: '/f/a' }, { segmentId: 'b', contentId: '/f/b' }];
    expect(matchRule(rules, ['b'])).toEqual(rules[1]);
    expect(matchRule(rules, ['z'])).toBeNull();
  });

  it('extracts segments from a Web SDK sendEvent result (destinations[].segments)', () => {
    const result = { propositions: [], destinations: [{ alias: 'x', segments: [{ id: 'seg-c' }] }] };
    expect(extractSegmentIds(result)).toEqual(['seg-c']);
  });

  it('returns fresh cached ids, ignores stale or corrupt entries, and retries empty ones after 5 minutes', () => {
    const store = (ids, ts) => window.localStorage.setItem('aep-pzn-segments', JSON.stringify({ ids, ts }));
    store(['seg-a'], Date.now());
    expect(readCachedSegments()).toEqual(['seg-a']);
    store(['seg-a'], Date.now() - 25 * 60 * 60 * 1000);
    expect(readCachedSegments()).toBeNull();
    store([], Date.now() - 6 * 60 * 1000);
    expect(readCachedSegments()).toBeNull();
    store(['seg-a'], Date.now() - 6 * 60 * 1000);
    expect(readCachedSegments()).toEqual(['seg-a']);
    window.localStorage.setItem('aep-pzn-segments', '{not json');
    expect(readCachedSegments()).toBeNull();
  });

  describe('Fetch API lookup', () => {
    const SEG = 'a8349e7b-5694-40fa-9f99-1a769fb2b548';
    const fetchResponse = (ids) => ({
      ok: true,
      json: async () => ({
        handle: [{
          type: 'activation:pull',
          payload: [{ type: 'profileLookup', segments: ids.map((id) => ({ id, namespace: 'ups' })) }],
        }],
      }),
    });

    beforeEach(() => {
      document.cookie = 'ivid=ivid-1; path=/';
      window.hlx = {};
    });

    it('POSTs the IVID identity payload to /ee/or2/v2alpha1/fetch and returns the segments', async () => {
      global.fetch = vi.fn().mockResolvedValue(fetchResponse([SEG]));
      expect(await eagerLookup()).toEqual([SEG]);
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://aec.intuit.com/ee/or2/v2alpha1/fetch?dataStreamId=bee9bcff-84ab-42ab-9a3c-700f5f84d7ad');
      expect(init.method).toBe('POST');
      // text/plain keeps the request CORS-simple, so the browser sends no preflight
      expect(init.headers['content-type']).toBe('text/plain;charset=UTF-8');
      const { xdm } = JSON.parse(init.body);
      expect(xdm._id).toMatch(/^event-.+/);
      expect(xdm.identityMap).toEqual({
        IVID: [{ authenticatedState: 'ambiguous', id: 'ivid-1', primary: true }],
      });
      expect(xdm._turbotax).toEqual({ identifiers: { ivid: 'ivid-1', pseudonym_id: 'null' } });
      expect(init.credentials).toBeUndefined();
      expect(window.hlx.aepSegmentIds).toEqual([SEG]);
    });

    it('makes no call without an ivid cookie', async () => {
      document.cookie = 'ivid=; path=/; max-age=0';
      global.fetch = vi.fn();
      expect(await eagerLookup()).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fails open on an HTTP error and backs off with a short-lived empty cache entry', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      expect(await eagerLookup()).toEqual([]);
      expect(readCachedSegments()).toEqual([]);
    });

    it('ignores the cache and a live segment, but makes only ONE Fetch call per page load', async () => {
      window.hlx = { aepSegmentIds: ['stale'] };
      window.localStorage.setItem('aep-pzn-segments', JSON.stringify({ ids: ['stale'], ts: Date.now() }));
      global.fetch = vi.fn().mockResolvedValue(fetchResponse([SEG]));
      expect(await whenSegmentIds(1500)).toEqual([SEG]);
      expect(await whenSegmentIds(1500)).toEqual([SEG]); // shared, not a second request
      expect(global.fetch).toHaveBeenCalledTimes(1);
      resetAepLookup(); // a new page load
      expect(await whenSegmentIds(1500)).toEqual([SEG]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('is skipped with ?aep-eager=off', async () => {
      window.history.pushState({}, '', '/?aep-eager=off');
      global.fetch = vi.fn();
      expect(await whenSegmentIds(1500)).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
      window.history.pushState({}, '', '/');
    });

    it('builds an orchestrator-shaped response from the fetched segment and the rules sheet', async () => {
      global.fetch = vi.fn(async (url) => (String(url).includes('/v2alpha1/fetch')
        ? fetchResponse([SEG])
        : {
          ok: true,
          json: async () => ({ data: [{ SegmentId: SEG, ContentId: '/fragments/ftc/ies-comparison-hero' }] }),
        }));
      const res = await resolveAepPersonalization(['homepage-pzn-rules']);
      expect(global.fetch.mock.calls[1][0]).toContain('/drafts/megha/homepage-pzn-rules.json');
      expect(res).toEqual({
        personalisation: {
          'homepage-pzn-rules': {
            payload: { contentId: '/fragments/ftc/ies-comparison-hero' },
            trackingAttributes: { offerId: SEG },
          },
        },
      });
    });

    it('shares one Fetch call and one rules fetch per file across several placements and calls', async () => {
      global.fetch = vi.fn(async (url) => (String(url).includes('/v2alpha1/fetch')
        ? fetchResponse([SEG])
        : { ok: true, json: async () => ({ data: [{ SegmentId: SEG, ContentId: '/fragments/x' }] }) }));
      await resolveAepPersonalization(['a', 'b']);
      await resolveAepPersonalization(['a']); // e.g. the post-swap call
      const urls = global.fetch.mock.calls.map(([u]) => String(u));
      expect(urls.filter((u) => u.includes('/v2alpha1/fetch'))).toHaveLength(1);
      expect(urls.filter((u) => u.endsWith('/drafts/megha/a.json'))).toHaveLength(1);
      expect(urls.filter((u) => u.endsWith('/drafts/megha/b.json'))).toHaveLength(1);
    });

    it('uses the highest-priority content when the visitor is in several segments', async () => {
      global.fetch = vi.fn(async (url) => (String(url).includes('/v2alpha1/fetch')
        ? fetchResponse(['seg-low', SEG, 'seg-mid'])
        : {
          ok: true,
          json: async () => ({
            data: [
              { SegmentId: 'seg-low', ContentId: '/fragments/low', SegmentPriority: '1' },
              { SegmentId: SEG, ContentId: '/fragments/ftc/ies-comparison-hero', SegmentPriority: '10' },
              { SegmentId: 'seg-mid', ContentId: '/fragments/mid', SegmentPriority: '5' },
            ],
          }),
        }));
      const res = await resolveAepPersonalization(['homepage-pzn-rules']);
      const decision = res.personalisation['homepage-pzn-rules'];
      expect(decision.payload.contentId).toBe('/fragments/ftc/ies-comparison-hero');
      expect(decision.trackingAttributes.offerId).toBe(SEG); // the winning segment is what gets recorded
    });

    it('returns null (baseline) when the user has no segment', async () => {
      global.fetch = vi.fn().mockResolvedValue(fetchResponse([]));
      expect(await resolveAepPersonalization(['x'])).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(1); // no rules fetch
    });
  });
});
