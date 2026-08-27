import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

// Mock the fragment loader so applyLayer's applyFragment never pulls in scripts.js.
vi.mock('../blocks/fragment/fragment.js', () => ({
  loadFragment: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  fragmentPath, casToPath, buildContext, resolveIvid,
  collectRequest, collectExperiments, collectSlots, sameTargetAsExp,
  experimentDecision, pznDecision, pznRecord, ixpRecord,
  ensureAppVars, flushAppVars, recordPzn, recordPznPage, recordIxp, resetAnalytics,
  stampPzn, stampExperiment,
  fetchExperience, applyPage, applyLayer,
  whenFullStoryReady, notifyFullStory,
} from '../scripts/experience.js';
// eslint-disable-next-line import/first
import { loadFragment } from '../blocks/fragment/fragment.js';

function main(html) {
  const m = document.createElement('main');
  m.innerHTML = html;
  return m;
}

function setMeta(name, content) {
  const m = document.createElement('meta');
  m.setAttribute('name', name);
  m.setAttribute('content', content);
  document.head.appendChild(m);
}

// A consolidated-response builder: experiments keyed by id, personalisation by name.
function expResp(id, {
  originalCasId = '/orig', replacementCasId = '/fragments/exp/a',
  treatmentId = 'T1', experimentId = id, experimentIdVersion = '2',
} = {}) {
  return {
    experiments: {
      [id]: {
        payload: JSON.stringify({ originalCasId, replacementCasId }),
        trackingAttributes: { treatmentId, experimentId, experimentIdVersion },
      },
    },
  };
}
function pznResp(name, { casId = '/fragments/pzn/a', offerId = 'offer-1' } = {}) {
  return { personalisation: { [name]: { payload: casId, trackingAttributes: { offerId } } } };
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  resetAnalytics();
  delete window.appVars;
  window.localStorage.clear();
  // Run the idle-deferred analytics flush synchronously for deterministic asserts.
  window.requestIdleCallback = (cb) => { cb(); return 0; };
  // restoreMocks wipes the factory's implementation before each test; re-arm a
  // fragment loader that returns decorated content.
  loadFragment.mockImplementation(async (path) => {
    const m = document.createElement('main');
    m.innerHTML = `<div data-frag="${path}">FRAG</div>`;
    return m;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.requestIdleCallback;
  resetAnalytics();
  delete window.appVars;
  window.localStorage.clear();
  document.cookie = 'ivid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('fragmentPath / casToPath', () => {
  it('makes a bare ref root-absolute and leaves an absolute one alone', () => {
    expect(fragmentPath('fragments/pzn/a')).toBe('/fragments/pzn/a');
    expect(fragmentPath('/fragments/pzn/a')).toBe('/fragments/pzn/a');
  });
  it('reduces an absolute URL to its pathname (no cross-origin .plain.html)', () => {
    expect(fragmentPath('https://main--x--y.aem.live/fragments/exp/a')).toBe('/fragments/exp/a');
  });
  it('returns null for an empty ref or non-string', () => {
    expect(fragmentPath('')).toBeNull();
    expect(fragmentPath(null)).toBeNull();
    expect(fragmentPath({})).toBeNull();
  });
  // Security: the ref is untrusted response data. We keep ONLY the pathname, fetched
  // from our own origin — the ref's host can never redirect the fetch off-origin.
  it('discards the host of a protocol-relative or cross-origin ref (same-origin path only)', () => {
    expect(fragmentPath('//evil.com/fragments/x')).toBe('/fragments/x');
    expect(fragmentPath('https://evil.com/fragments/x?token=1#h')).toBe('/fragments/x');
  });
  it('rejects non-http(s) schemes and a bare-root ref', () => {
    expect(fragmentPath('javascript:alert(1)')).toBeNull();
    expect(fragmentPath('data:text/html,<script>x</script>')).toBeNull();
    expect(fragmentPath('/')).toBeNull();
  });
  it('percent-encodes unsafe characters in the path', () => {
    expect(fragmentPath('/frag ment/a')).toBe('/frag%20ment/a');
  });
  it('casToPath normalizes a bare casId to a path (single resolution seam)', () => {
    expect(casToPath('c7EfF7rYM')).toBe('/c7EfF7rYM');
    expect(casToPath('/fragments/pzn/a')).toBe('/fragments/pzn/a');
  });
});

describe('buildContext', () => {
  it('carries front-end signals and NOT zoominfo firmographics', () => {
    const ctx = buildContext('/pricing');
    expect(ctx).toMatchObject({
      permalink: '/pricing', deviceType: expect.any(String), newVisitor: true,
    });
    expect(ctx.locale).toBeTruthy();
    expect(Object.keys(ctx).some((k) => k.startsWith('zi_c_'))).toBe(false);
    expect(ctx).not.toHaveProperty('zoominfo');
  });
  it('sends the full URL as permalink and the pathname as casId, plus ivid from the cookie', () => {
    document.cookie = 'ivid=cookie-ivid';
    const ctx = buildContext('https://erp.intuit.com/products/enterprise-suite');
    expect(ctx.permalink).toBe('https://erp.intuit.com/products/enterprise-suite');
    expect(ctx.casId).toBe('/products/enterprise-suite');
    expect(ctx.ivid).toBe('cookie-ivid');
  });
  it('sends locale with underscore (en_US), not BCP 47 hyphen (en-US)', () => {
    const orig = window.location.href;
    window.history.replaceState({}, '', `${orig.split('?')[0]}?locale=en-US`);
    const ctx = buildContext('/pricing');
    expect(ctx.locale).toBe('en_US');
    window.history.replaceState({}, '', orig);
  });
  it('includes of1Intent when a behavior profile exists', () => {
    const domain = window.location.hostname.replace(/^www\./, '');
    window.localStorage.setItem('of1_behavior_profiles', JSON.stringify({
      [domain]: {
        domain,
        interests: [{ topic: 'payroll' }],
        intentProfile: { topIntent: 'researching' },
        pageVisits: [{ path: '/a' }],
        entryContext: { source: 'organic-search' },
      },
    }));
    const ctx = buildContext();
    expect(ctx.of1Intent).toMatchObject({ topIntent: 'researching', journeyStage: 'consideration' });
  });
  it('omits of1Intent when there is no profile', () => {
    expect(buildContext()).not.toHaveProperty('of1Intent');
  });
});

describe('resolveIvid', () => {
  it('reads the ivid cookie, else undefined; ignores any ?ivid= param', () => {
    expect(resolveIvid()).toBeUndefined();
    window.history.replaceState({}, '', '?ivid=url-xyz');
    expect(resolveIvid()).toBeUndefined(); // URL param no longer honored
    document.cookie = 'ivid=cookie-abc';
    expect(resolveIvid()).toBe('cookie-abc'); // cookie is the only source
    window.history.replaceState({}, '', window.location.pathname);
  });
});

describe('collectRequest', () => {
  it('gathers page + section ids/names, de-duped, with IXP-over-PZN precedence', () => {
    setMeta('experiment-id', '111');
    setMeta('personalization-id', 'PagePzn');
    document.body.appendChild(main(
      '<div data-exp="222"></div>'
      + '<div data-pzn="alpha"></div>'
      + '<div data-pzn="alpha"></div>' // dup
      + '<div data-pzn="beta" data-exp="333"></div>', // same target ⇒ IXP wins, pzn dropped
    ));
    const req = collectRequest(document);
    expect(req.experimentIds.sort()).toEqual(['111', '222', '333']);
    expect(req.accessPointNames.sort()).toEqual(['PagePzn', 'alpha']);
  });
  it('drops a non-numeric page experiment-id and ignores experiment-label (labels unsupported)', () => {
    setMeta('experiment-id', 'not-a-number');
    setMeta('experiment-label', 'MyLabel');
    document.body.appendChild(main('<div data-exp="Homepage_Hero"></div>'));
    const req = collectRequest(document);
    expect(req.experimentIds).toEqual([]);
  });
  it('returns empty lists on a page with no tags', () => {
    document.body.appendChild(main('<div class="hero"></div>'));
    expect(collectRequest(document)).toEqual({ experimentIds: [], accessPointNames: [] });
  });
});

describe('collectExperiments', () => {
  it('finds numeric data-exp sections; section fidelity by default', () => {
    const m = main('<div data-exp="385944"><p>base</p></div><div class="hero"></div>');
    const exps = collectExperiments(m);
    expect(exps).toHaveLength(1);
    expect(exps[0]).toMatchObject({ id: '385944', fidelity: 'section' });
    expect(exps[0].el).toBe(m.querySelector('[data-exp]'));
  });
  it('scopes to the named block (block fidelity) for data-exp-block', () => {
    const m = main('<div data-exp="385944" data-exp-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    const exps = collectExperiments(m);
    expect(exps[0].fidelity).toBe('block');
    expect(exps[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
  });
  it('drops non-numeric ids (labels no longer supported) and honors { skip }', () => {
    expect(collectExperiments(main('<div data-exp="Homepage_Hero"></div>'))).toEqual([]);
    const m = main('<div data-exp="1"></div><div data-exp="2"></div>');
    expect(collectExperiments(m, m.querySelector('[data-exp]')).map((e) => e.id)).toEqual(['2']);
  });
  it('carries append=true only when data-exp-mode is "append"', () => {
    expect(collectExperiments(main('<div data-exp="1" data-exp-mode="append"></div>'))[0].append).toBe(true);
    expect(collectExperiments(main('<div data-exp="1"></div>'))[0].append).toBe(false);
  });
});

describe('collectSlots + sameTargetAsExp (IXP precedence)', () => {
  it('reads the placement verbatim; whole-section target', () => {
    const m = main('<div data-pzn="alpha"><p>base</p></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].placement).toBe('alpha');
  });
  it('drops a pzn slot when the same target also carries an experiment', () => {
    expect(collectSlots(main('<div data-pzn="p" data-exp="385944"></div>'))).toEqual([]);
    expect(sameTargetAsExp(main('<div data-pzn="p" data-exp="1"></div>').firstChild)).toBe(true);
  });
  it('keeps pzn when exp targets a different block', () => {
    const m = main('<div data-pzn="p" data-pzn-block="cards" data-exp="1" data-exp-block="hero"><div class="cards" data-block-name="cards"></div><div class="hero" data-block-name="hero"></div></div>');
    expect(collectSlots(m)).toHaveLength(1);
  });
  it('carries append=true only when data-pzn-mode is "append"', () => {
    expect(collectSlots(main('<div data-pzn="a" data-pzn-mode="append"></div>'))[0].append).toBe(true);
    expect(collectSlots(main('<div data-pzn="a"></div>'))[0].append).toBe(false);
  });
});

describe('experimentDecision / pznDecision', () => {
  it('parses the experiment payload JSON + tracking attributes', () => {
    const d = experimentDecision(expResp('376648'), '376648');
    expect(d).toEqual({
      originalCasId: '/orig',
      replacementCasId: '/fragments/exp/a',
      treatmentId: 'T1',
      experimentId: '376648',
      experimentIdVersion: '2',
    });
  });
  it('returns null for an id absent from the response', () => {
    expect(experimentDecision(expResp('1'), '2')).toBeNull();
    expect(experimentDecision({}, '1')).toBeNull();
  });
  it('reads the pzn casId + offerId case-insensitively', () => {
    const d = pznDecision(pznResp('SBSEG_Modal'), 'sbseg_modal');
    expect(d).toEqual({ casId: '/fragments/pzn/a', offerId: 'offer-1' });
  });
  it('tolerates the American spelling `personalization`', () => {
    const resp = { personalization: { x: { payload: '/p', trackingAttributes: { offerId: 'o' } } } };
    expect(pznDecision(resp, 'x')).toEqual({ casId: '/p', offerId: 'o' });
  });
  it('returns null for a name absent from the response', () => {
    expect(pznDecision(pznResp('a'), 'b')).toBeNull();
    expect(pznDecision({}, 'a')).toBeNull();
  });
});

describe('record shapes', () => {
  it('pznRecord: ECS keys with the replacement casId as content id', () => {
    expect(pznRecord('alpha', { casId: '/frag', offerId: 'o1' })).toEqual({
      personalization_placement: 'alpha',
      personalization_id: 'o1',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      content_id: '/frag',
      externalContentIdentifier: '/frag',
    });
  });
  it('pznRecord: null when there is no offer', () => {
    expect(pznRecord('alpha', { casId: null, offerId: undefined })).toBeNull();
  });
  it('ixpRecord: treatment carries a replacement; control does not', () => {
    const treat = ixpRecord({
      experimentId: '376648', experimentIdVersion: '2', treatmentId: 'T1',
      originalCasId: '/orig', replacementCasId: '/rep',
    }, '/page');
    expect(treat).toEqual({
      experiment_id: '376648',
      experiment_version: '2',
      experiment_treatment: 'T1',
      original_content_id: '/orig',
      replacement_content_id: '/rep',
    });
    const control = ixpRecord({
      experimentId: '376648', experimentIdVersion: '2', treatmentId: 'T1', originalCasId: null, replacementCasId: null,
    }, '/page');
    expect(control).not.toHaveProperty('replacement_content_id');
    expect(control.original_content_id).toBe('/page');
  });
  it('ixpRecord: null without experiment identity', () => {
    expect(ixpRecord({ replacementCasId: '/r' }, '/p')).toBeNull();
  });
});

describe('analytics buffers on window.appVars', () => {
  it('flushes deduped real arrays into the three channels', () => {
    recordPzn([{ personalization_id: 'o1', a: 1 }, { personalization_id: 'o1', a: 2 }]);
    recordIxp([{ experiment_id: 'e1' }]);
    recordPznPage([{ personalization_id: 'p1' }]);
    flushAppVars();
    expect(window.appVars.pznRecDetailsArr).toEqual([{ personalization_id: 'o1', a: 1 }]);
    expect(window.appVars.ixpDetailsArr).toEqual([{ experiment_id: 'e1' }]);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([{ personalization_id: 'p1' }]);
  });
  it('ensureAppVars reuses an existing object', () => {
    window.appVars = { foo: 1 };
    expect(ensureAppVars()).toBe(window.appVars);
    expect(window.appVars.foo).toBe(1);
  });
});

describe('stamping', () => {
  it('stampPzn writes placement + id (blank values skipped)', () => {
    const el = document.createElement('div');
    stampPzn(el, { personalization_placement: 'alpha', personalization_id: 'o1' });
    expect(el.getAttribute('data-pzn-placement')).toBe('alpha');
    expect(el.getAttribute('data-pzn-id')).toBe('o1');
    const el2 = document.createElement('div');
    stampPzn(el2, { personalization_placement: '', personalization_id: 'o2' });
    expect(el2.hasAttribute('data-pzn-placement')).toBe(false);
  });
  it('stampPzn writes the full data-pzn-* set the click tracker walks (action/workflow/model)', () => {
    const el = document.createElement('div');
    stampPzn(el, {
      personalization_placement: 'alpha',
      personalization_id: 'o1',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      model_name: 'm1',
      model_version: 'v2',
    });
    expect(el.getAttribute('data-pzn-action')).toBe('im');
    expect(el.getAttribute('data-pzn-workflow')).toBe('marketing');
    expect(el.getAttribute('data-pzn-model-name')).toBe('m1');
    expect(el.getAttribute('data-pzn-model-version')).toBe('v2');
  });
  it('stampPzn omits model/action attributes a record does not carry (matches prod)', () => {
    const el = document.createElement('div');
    stampPzn(el, { personalization_placement: 'alpha', personalization_id: 'o1' });
    expect(el.hasAttribute('data-pzn-action')).toBe(false);
    expect(el.hasAttribute('data-pzn-workflow')).toBe(false);
    expect(el.hasAttribute('data-pzn-model-name')).toBe(false);
  });
  it('stampExperiment writes id/version/treatment', () => {
    const el = document.createElement('div');
    stampExperiment(el, { experiment_id: '1', experiment_version: '2', experiment_treatment: 'T' });
    expect(el.getAttribute('data-experiment-id')).toBe('1');
    expect(el.getAttribute('data-experiment-version')).toBe('2');
    expect(el.getAttribute('data-treatment-id')).toBe('T');
  });
});

describe('fetchExperience', () => {
  it('POSTs the consolidated body and returns the parsed response', async () => {
    const payload = expResp('1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const ctx = { locale: 'en_US' };
    const res = await fetchExperience({ experimentIds: ['1'], accessPointNames: ['a'] }, ctx);
    expect(res).toEqual(payload);

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/intuit-orchestrator');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['content-type']).toBe('application/json');
    expect(opts.headers.intuit_tid).toMatch(/^rp-/);
    expect(JSON.parse(opts.body)).toEqual({
      experimentIds: ['1'], accessPointName: ['a'], context: { locale: 'en_US' },
    });
  });
  it('honors the experience-api-base metadata override', async () => {
    setMeta('experience-api-base', 'https://qa.example/svc/');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await fetchExperience({ experimentIds: ['1'], accessPointNames: [] }, {});
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://qa.example/svc/intuit-orchestrator');
  });
  it('fails open (null) on a non-ok response and on a thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await fetchExperience({ experimentIds: ['1'], accessPointNames: [] }, {})).toBeNull();
    globalThis.fetch.mockRejectedValueOnce(new Error('network'));
    expect(await fetchExperience({ experimentIds: ['1'], accessPointNames: [] }, {})).toBeNull();
  });
});

describe('applyPage (whole-page swap, before decorate)', () => {
  beforeEach(() => { document.body.innerHTML = '<main><div class="hero">BASE</div></main>'; });

  it('swaps <main>, stamps it, and records exposure for a page experiment', async () => {
    setMeta('experiment-id', '376648');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div class="hero">VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await applyPage(document, expResp('376648', { replacementCasId: '/fragments/exp/page' }));

    expect(globalThis.fetch).toHaveBeenCalledWith('/fragments/exp/page.plain.html', expect.anything());
    expect(document.querySelector('main').innerHTML).toContain('VARIATION');
    expect(document.querySelector('main').getAttribute('data-treatment-id')).toBe('T1');
    expect(window.appVars.ixpDetailsArr[0]).toMatchObject({ experiment_id: '376648', replacement_content_id: '/fragments/exp/page' });
  });

  it('leaves the baseline but records exposure on a control arm (replacement == original)', async () => {
    setMeta('experiment-id', '376648');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await applyPage(document, expResp('376648', { originalCasId: '/same', replacementCasId: '/same' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('main').innerHTML).toContain('BASE');
    expect(window.appVars.ixpDetailsArr[0]).not.toHaveProperty('replacement_content_id');
  });

  it('swaps + records for a page personalization (pznPage channel)', async () => {
    setMeta('personalization-id', 'HomeHero');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div>PZN</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await applyPage(document, pznResp('HomeHero', { casId: '/fragments/pzn/home' }));
    expect(document.querySelector('main').innerHTML).toContain('PZN');
    expect(document.querySelector('main').getAttribute('data-pzn-id')).toBe('offer-1');
    expect(window.appVars.pznPageRecDetailsArr[0]).toMatchObject({ personalization_placement: 'HomeHero' });
  });

  it('IXP wins when the page carries both experiment-id and personalization-id', async () => {
    setMeta('experiment-id', '376648');
    setMeta('personalization-id', 'HomeHero');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div>EXP</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const resp = { ...expResp('376648'), ...pznResp('HomeHero') };
    await applyPage(document, resp);
    expect(window.appVars.ixpDetailsArr).toHaveLength(1);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([]);
  });
});

describe('applyLayer (section/block swaps, from the cached response)', () => {
  it('replaces a section experiment target and stamps it; no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const m = main('<div data-exp="376648"></div>');
    await applyLayer(m, expResp('376648', { replacementCasId: '/fragments/exp/a' }));
    expect(loadFragment).toHaveBeenCalledWith('/fragments/exp/a');
    const el = m.querySelector('[data-exp]');
    expect(el.querySelector('[data-frag]')).toBeTruthy();
    expect(el.getAttribute('data-treatment-id')).toBe('T1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.appVars.ixpDetailsArr).toHaveLength(1);
  });

  it('resolves a bare casId through casToPath before loading', async () => {
    const m = main('<div data-pzn="alpha"></div>');
    await applyLayer(m, pznResp('alpha', { casId: 'c7EfF7rYM' }));
    expect(loadFragment).toHaveBeenCalledWith('/c7EfF7rYM');
  });

  it('applies a block-scoped decision to the named block, not the section', async () => {
    const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    await applyLayer(m, pznResp('alpha'));
    expect(loadFragment).toHaveBeenCalledTimes(1);
    const block = m.querySelector('[data-block-name="cards"]');
    expect(block.querySelector('[data-frag]')).toBeTruthy();
    expect(block.getAttribute('data-pzn-id')).toBe('offer-1');
    expect(m.querySelector('[data-pzn]').hasAttribute('data-pzn-id')).toBe(false);
  });

  it('honors { skip } to leave the first/LCP section for the eager phase', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    await applyLayer(m, { personalisation: {
      alpha: { payload: '/a', trackingAttributes: { offerId: 'oa' } },
      beta: { payload: '/b', trackingAttributes: { offerId: 'ob' } },
    } }, { skip: m.querySelector('[data-pzn]') });
    expect(loadFragment).toHaveBeenCalledTimes(1);
    expect(loadFragment).toHaveBeenCalledWith('/b');
  });

  it('records exposure but does not swap a control experiment (no replacement)', async () => {
    const m = main('<div data-exp="376648"></div>');
    await applyLayer(m, expResp('376648', { originalCasId: '/x', replacementCasId: '/x' }));
    expect(loadFragment).not.toHaveBeenCalled();
    expect(window.appVars.ixpDetailsArr).toHaveLength(1);
  });

  it('IXP precedence: a target with both exp and pzn gets only the experiment swap', async () => {
    const m = main('<div data-exp="376648" data-pzn="alpha"></div>');
    const resp = { ...expResp('376648', { replacementCasId: '/exp' }), ...pznResp('alpha', { casId: '/pzn' }) };
    await applyLayer(m, resp);
    expect(loadFragment).toHaveBeenCalledTimes(1);
    expect(loadFragment).toHaveBeenCalledWith('/exp');
  });

  it('does not stamp when the swap does not land (loadFragment returns null)', async () => {
    loadFragment.mockResolvedValueOnce(null);
    const m = main('<div data-pzn="alpha"></div>');
    await applyLayer(m, pznResp('alpha'));
    expect(m.querySelector('[data-pzn]').hasAttribute('data-pzn-id')).toBe(false);
  });

  it('is a no-op on a null response', async () => {
    const m = main('<div data-pzn="alpha"></div>');
    await applyLayer(m, null);
    expect(loadFragment).not.toHaveBeenCalled();
  });

  it('append mode (data-pzn-mode) appends the fragment, preserving existing content', async () => {
    const m = main('<div data-pzn="alpha" data-pzn-mode="append"><p class="base">keep</p></div>');
    await applyLayer(m, pznResp('alpha', { casId: '/frag' }));
    const el = m.querySelector('[data-pzn]');
    expect(el.querySelector('.base')).toBeTruthy(); // existing content preserved
    expect(el.querySelector('[data-frag]')).toBeTruthy(); // fragment appended
  });

  it('append mode works for experiments too (data-exp-mode)', async () => {
    const m = main('<div data-exp="376648" data-exp-mode="append"><p class="base">keep</p></div>');
    await applyLayer(m, expResp('376648', { replacementCasId: '/frag' }));
    const el = m.querySelector('[data-exp]');
    expect(el.querySelector('.base')).toBeTruthy();
    expect(el.querySelector('[data-frag]')).toBeTruthy();
  });

  it('default (swap) mode replaces existing content', async () => {
    const m = main('<div data-pzn="alpha"><p class="base">gone</p></div>');
    await applyLayer(m, pznResp('alpha', { casId: '/frag' }));
    const el = m.querySelector('[data-pzn]');
    expect(el.querySelector('.base')).toBeFalsy();
    expect(el.querySelector('[data-frag]')).toBeTruthy();
  });
});

describe('FullStory swap notification', () => {
  // FS's stub is a *function* with an .event method — the guard checks typeof === 'function'.
  function stubFullStory() {
    const event = vi.fn();
    window.FS = Object.assign(function fs() {}, { event });
    window._fs_namespace = 'FS';
    return event;
  }
  // A macrotask flush so the fire-and-forget .then() (and any pending poll) settles.
  const tick = () => new Promise((r) => { setTimeout(r, 0); });

  afterEach(() => {
    delete window.FS;
    delete window._fs_namespace;
  });

  describe('whenFullStoryReady', () => {
    it('is memoized — one poll per page', () => {
      expect(whenFullStoryReady()).toBe(whenFullStoryReady());
    });
    it('resolves the FS function when present', async () => {
      const event = stubFullStory();
      const fs = await whenFullStoryReady();
      expect(typeof fs).toBe('function');
      expect(fs.event).toBe(event);
    });
    it('resolves null when FS never loads (fail-open timeout)', async () => {
      expect(await whenFullStoryReady({ intervalMs: 5, timeoutMs: 20 })).toBeNull();
    });
  });

  describe('notifyFullStory', () => {
    it('fires the event with { id, name } when FS is present', async () => {
      const event = stubFullStory();
      notifyFullStory('Experiment Viewed', 't1', 'e1');
      await tick();
      expect(event).toHaveBeenCalledWith('Experiment Viewed', { id: 't1', name: 'e1' });
    });
    it('is a no-op when the id is falsy', async () => {
      const event = stubFullStory();
      notifyFullStory('Experiment Viewed', undefined, 'e1');
      await tick();
      expect(event).not.toHaveBeenCalled();
    });
    it('gives up after the timeout and does not fire for a late-loading FS', async () => {
      notifyFullStory('Experiment Viewed', 't1', 'e1', { intervalMs: 5, timeoutMs: 20 });
      await new Promise((r) => { setTimeout(r, 50); });
      const event = stubFullStory(); // FS arrives only after the poll gave up
      await tick();
      expect(event).not.toHaveBeenCalled();
    });
  });

  describe('from applyPage', () => {
    beforeEach(() => { document.body.innerHTML = '<main><div class="hero">BASE</div></main>'; });

    it('fires "Experiment Viewed" {id:treatmentId, name:experimentId} on a page IXP swap', async () => {
      const event = stubFullStory();
      setMeta('experiment-id', '376648');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<div>VARIATION</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
      await applyPage(document, expResp('376648', { treatmentId: 'T1', replacementCasId: '/fragments/exp/page' }));
      await tick();
      expect(event).toHaveBeenCalledWith('Experiment Viewed', { id: 'T1', name: '376648' });
    });

    it('fires "Personalization Viewed" {id:offerId, name:placement} on a page PZN swap', async () => {
      const event = stubFullStory();
      setMeta('personalization-id', 'HomeHero');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<div>PZN</div>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
      await applyPage(document, pznResp('HomeHero', { casId: '/fragments/pzn/home', offerId: 'offer-1' }));
      await tick();
      expect(event).toHaveBeenCalledWith('Personalization Viewed', { id: 'offer-1', name: 'HomeHero' });
    });

    it('does NOT fire on a control arm (no swap)', async () => {
      const event = stubFullStory();
      setMeta('experiment-id', '376648');
      await applyPage(document, expResp('376648', { originalCasId: '/same', replacementCasId: '/same' }));
      await tick();
      expect(event).not.toHaveBeenCalled();
    });
  });

  describe('from applyLayer', () => {
    it('fires "Experiment Viewed" on a section IXP swap', async () => {
      const event = stubFullStory();
      const m = main('<div data-exp="376648"></div>');
      await applyLayer(m, expResp('376648', { treatmentId: 'T1', replacementCasId: '/fragments/exp/a' }));
      await tick();
      expect(event).toHaveBeenCalledWith('Experiment Viewed', { id: 'T1', name: '376648' });
    });

    it('fires "Personalization Viewed" on a section PZN swap', async () => {
      const event = stubFullStory();
      const m = main('<div data-pzn="alpha"></div>');
      await applyLayer(m, pznResp('alpha', { offerId: 'offer-1' }));
      await tick();
      expect(event).toHaveBeenCalledWith('Personalization Viewed', { id: 'offer-1', name: 'alpha' });
    });

    it('does NOT fire when the swap fails (loadFragment returns null)', async () => {
      const event = stubFullStory();
      loadFragment.mockResolvedValueOnce(null);
      const m = main('<div data-pzn="alpha"></div>');
      await applyLayer(m, pznResp('alpha'));
      await tick();
      expect(event).not.toHaveBeenCalled();
    });

    it('does NOT fire on a null response', async () => {
      const event = stubFullStory();
      const m = main('<div data-pzn="alpha"></div>');
      await applyLayer(m, null);
      await tick();
      expect(event).not.toHaveBeenCalled();
    });
  });
});
