import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  collectRequest, collectSlots, collectRulesPlacements, collectSwapRequest, fetchExperience,
  localApiBaseOverride, apiBase,
} from '../scripts/experience.js';
import { resetAepLookup } from '../scripts/aep-pzn.js';

const SEG = 'a8349e7b-5694-40fa-9f99-1a769fb2b548';
const html = (inner) => `<main>${inner}</main>`;
const main = (inner) => {
  document.body.innerHTML = html(inner);
  return document.querySelector('main');
};

// Routes by URL so a test can tell which backends a page touches.
function mockBackends() {
  const calls = { orchestrator: 0, fetchApi: 0, rules: [] };
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('intuit-orchestrator')) {
      calls.orchestrator += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          personalisation: { orch: { payload: { contentId: '/fragments/orch' }, trackingAttributes: { offerId: 'o1' } } },
        }),
      };
    }
    if (u.includes('/v2alpha1/fetch')) {
      calls.fetchApi += 1;
      return {
        ok: true,
        json: async () => ({ handle: [{ type: 'activation:pull', payload: [{ segments: [{ id: SEG }] }] }] }),
      };
    }
    calls.rules.push(u);
    return { ok: true, json: async () => ({ data: [{ SegmentId: SEG, ContentId: '/fragments/ruled' }] }) };
  });
  return calls;
}

describe('pzn vs pzn-rules routing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    document.cookie = 'ivid=ivid-1; path=/';
    window.hlx = {};
    resetAepLookup();
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('sends only `pzn`-only sections to the orchestrator request and `pzn-rules` to the rules list', () => {
    const m = main(
      '<div data-pzn="orch"></div>'
      + '<div data-pzn-rules="homepage-pzn-rules" data-pzn-block="hero"><div class="hero"></div></div>',
    );
    expect(collectRequest(document).accessPointNames).toEqual(['orch']);
    expect(collectSwapRequest(m).accessPointNames).toEqual(['orch']);
    expect(collectRulesPlacements(m)).toEqual(['homepage-pzn-rules']);
    expect(collectSlots(m).map((s) => [s.placement, !!s.rules])).toEqual([
      ['orch', false], ['homepage-pzn-rules', true],
    ]);
  });

  it('lets `pzn-rules` win when a section has both fields', () => {
    const m = main('<div data-pzn="orch" data-pzn-rules="rules-file"></div>');
    expect(collectRequest(document).accessPointNames).toEqual([]);
    expect(collectRulesPlacements(m)).toEqual(['rules-file']);
  });

  it('de-dupes rules placements and still drops them when an experiment targets the same thing', () => {
    const m = main(
      '<div data-pzn-rules="r"></div><div data-pzn-rules="r"></div>'
      + '<div data-pzn-rules="x" data-exp="123"></div>',
    );
    expect(collectRulesPlacements(m)).toEqual(['r']);
  });

  it('a pzn-rules-only page makes the Fetch call and rules fetch, but NO orchestrator call', async () => {
    const calls = mockBackends();
    const res = await fetchExperience(
      { experimentIds: [], accessPointNames: [], rulesPlacements: ['homepage-pzn-rules'] },
      {},
    );
    expect(calls.orchestrator).toBe(0);
    expect(calls.fetchApi).toBe(1);
    expect(res.personalisation['homepage-pzn-rules'].payload.contentId).toBe('/fragments/ruled');
  });

  it('a pzn-only page calls the orchestrator and NEVER the AEP Fetch API', async () => {
    const calls = mockBackends();
    const res = await fetchExperience({ experimentIds: [], accessPointNames: ['orch'] }, {});
    expect(calls.orchestrator).toBe(1);
    expect(calls.fetchApi).toBe(0);
    expect(calls.rules).toEqual([]);
    expect(res.personalisation.orch.payload.contentId).toBe('/fragments/orch');
  });

  it('a mixed page makes one call to each backend and merges both decisions', async () => {
    const calls = mockBackends();
    const res = await fetchExperience(
      { experimentIds: [], accessPointNames: ['orch'], rulesPlacements: ['rules-file'] },
      {},
    );
    expect(calls.orchestrator).toBe(1);
    expect(calls.fetchApi).toBe(1);
    expect(Object.keys(res.personalisation).sort()).toEqual(['orch', 'rules-file']);
  });

  it('keeps one Fetch call per page across the eager call and a later post-swap call', async () => {
    const calls = mockBackends();
    const req = { experimentIds: [], accessPointNames: [], rulesPlacements: ['rules-file'] };
    await fetchExperience(req, {});
    await fetchExperience(req, {});
    expect(calls.fetchApi).toBe(1);
    expect(calls.rules).toHaveLength(1);
  });
});

describe('local ?experience-api-base override', () => {
  const prod = 'https://erp.intuit.com/api';
  const qs = `?experience-api-base=${encodeURIComponent(prod)}`;

  it('is honoured only on localhost / 127.0.0.1', () => {
    expect(localApiBaseOverride('localhost', qs)).toBe(prod);
    expect(localApiBaseOverride('127.0.0.1', qs)).toBe(prod);
    expect(localApiBaseOverride('erp.intuit.com', qs)).toBe('');
    expect(localApiBaseOverride('main--erp--intuit.aem.page', qs)).toBe('');
  });

  it('accepts only an http(s) URL or a root-relative path', () => {
    const only = (v) => localApiBaseOverride('localhost', `?experience-api-base=${encodeURIComponent(v)}`);
    expect(only('/api')).toBe('/api');
    expect(only('//evil.example/api')).toBe('');
    expect(only('javascript:alert(1)')).toBe('');
    expect(only('')).toBe('');
  });

  it('feeds apiBase() and the orchestrator target on a local page', async () => {
    window.history.pushState({}, '', `/${qs}`);
    expect(apiBase()).toBe(prod);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await fetchExperience({ experimentIds: [], accessPointNames: ['orch'] }, {});
    expect(global.fetch.mock.calls[0][0]).toBe(`${prod}/intuit-orchestrator`);
    window.history.pushState({}, '', '/');
    expect(apiBase()).toBe('/api');
  });
});
