import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import installPznPageViewEnrich, {
  personalizationDetails,
  experimentTrackString,
  enrichPagePayload,
  wrapTrackPage,
  whenAssigned,
} from '../scripts/pzn-pageview-enrich.js';

beforeEach(() => {
  delete window.ixp;
  delete window.intuit;
  delete window.appVars;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('personalizationDetails', () => {
  it('page-level records win over section-level', () => {
    const av = { pznPageRecDetailsArr: [{ personalization_id: 'p' }], pznRecDetailsArr: [{ personalization_id: 's' }] };
    expect(personalizationDetails(av)).toEqual([{ personalization_id: 'p' }]);
  });
  it('falls back to section-level, then to [] (never null)', () => {
    expect(personalizationDetails({ pznPageRecDetailsArr: [], pznRecDetailsArr: [{ personalization_id: 's' }] }))
      .toEqual([{ personalization_id: 's' }]);
    expect(personalizationDetails({})).toEqual([]);
  });
});

describe('experimentTrackString', () => {
  it('joins id:version:treatment and publishes window.ixp.xt', () => {
    const xt = experimentTrackString([
      { experiment_id: '111', experiment_version: '2', experiment_treatment: '333' },
      { experiment_id: '444', experiment_version: '1', experiment_treatment: '555' },
    ]);
    expect(xt).toBe('111:2:333|444:1:555');
    expect(window.ixp.xt).toBe('111:2:333|444:1:555');
  });
  it('empty -> "" and does not touch window.ixp', () => {
    expect(experimentTrackString([])).toBe('');
    expect(window.ixp).toBeUndefined();
  });
});

describe('enrichPagePayload', () => {
  const appVars = {
    pznPageRecDetailsArr: [{ personalization_placement: 'HomeHero', personalization_id: 'o1' }],
    ixpDetailsArr: [{ experiment_id: '111', experiment_version: '2', experiment_treatment: '333' }],
  };

  it('fills personalization_details when the profile left it null or empty', () => {
    expect(enrichPagePayload({ personalization_details: null }, appVars).personalization_details).toHaveLength(1);
    expect(enrichPagePayload({ personalization_details: [] }, appVars).personalization_details).toHaveLength(1);
  });

  it('fills experiment_ids and publishes window.ixp.xt', () => {
    const p = enrichPagePayload({}, appVars);
    expect(p.experiment_ids).toBe('111:2:333');
    expect(window.ixp.xt).toBe('111:2:333');
  });

  it('NEVER clobbers values the profile already populated', () => {
    const existing = [{ personalization_placement: 'FromProfile', personalization_id: 'x' }];
    const p = enrichPagePayload({ personalization_details: existing, experiment_ids: '999:9:999' }, appVars);
    expect(p.personalization_details).toBe(existing);
    expect(p.experiment_ids).toBe('999:9:999');
  });

  it('adds nothing when appVars has no records', () => {
    const p = enrichPagePayload({ personalization_details: null }, {});
    expect(p.personalization_details).toBeNull();
    expect('experiment_ids' in p).toBe(false);
  });
});

describe('wrapTrackPage', () => {
  it('enriches the payload, then delegates to the original', () => {
    window.appVars = { pznPageRecDetailsArr: [{ personalization_placement: 'HomeHero', personalization_id: 'o1' }] };
    const original = vi.fn();
    const wa = { trackPage: original };
    wrapTrackPage(wa);
    wa.trackPage({ personalization_details: null, screen: 'homepage' });
    const sent = original.mock.calls[0][0];
    expect(sent.personalization_details).toEqual([{ personalization_placement: 'HomeHero', personalization_id: 'o1' }]);
    expect(sent.screen).toBe('homepage');
  });

  it('is idempotent — a second wrap does not double-invoke the original', () => {
    const original = vi.fn();
    const wa = { trackPage: original };
    wrapTrackPage(wa);
    wrapTrackPage(wa);
    wa.trackPage({});
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('fails open — an enrichment error still lets the original through', () => {
    Object.defineProperty(window, 'appVars', { configurable: true, get() { throw new Error('boom'); } });
    const original = vi.fn();
    const wa = { trackPage: original };
    wrapTrackPage(wa);
    expect(() => wa.trackPage({ screen: 's' })).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
  });
});

describe('whenAssigned', () => {
  it('invokes immediately when already present', () => {
    const cb = vi.fn();
    whenAssigned({ a: 42 }, 'a', cb);
    expect(cb).toHaveBeenCalledWith(42);
  });
  it('invokes on later assignment (accessor trap)', () => {
    const obj = {};
    const cb = vi.fn();
    whenAssigned(obj, 'a', cb);
    expect(cb).not.toHaveBeenCalled();
    obj.a = 7;
    expect(cb).toHaveBeenCalledWith(7);
    expect(obj.a).toBe(7);
  });
});

describe('installPznPageViewEnrich', () => {
  it('wraps trackPage when the chain is built incrementally after install', () => {
    window.appVars = { pznPageRecDetailsArr: [{ personalization_placement: 'HomeHero', personalization_id: 'o1' }] };
    installPznPageViewEnrich();
    const original = vi.fn();
    window.intuit = {};
    window.intuit.tracking = {};
    window.intuit.tracking.ecs = {};
    window.intuit.tracking.ecs.webAnalytics = { trackPage: original };
    window.intuit.tracking.ecs.webAnalytics.trackPage({ personalization_details: null });
    expect(original.mock.calls[0][0].personalization_details).toHaveLength(1);
  });

  it('wraps trackPage when the whole chain is assigned as one literal after install', () => {
    window.appVars = { pznPageRecDetailsArr: [{ personalization_placement: 'HomeHero', personalization_id: 'o1' }] };
    installPznPageViewEnrich();
    const original = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { trackPage: original } } } };
    window.intuit.tracking.ecs.webAnalytics.trackPage({ personalization_details: [] });
    expect(original.mock.calls[0][0].personalization_details).toHaveLength(1);
  });
});
