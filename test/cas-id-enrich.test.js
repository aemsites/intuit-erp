import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import installCasIdEnrich, {
  pageCasId,
  enrichEventPayload,
  wrapTrack,
} from '../scripts/cas-id-enrich.js';
import installPznPageViewEnrich from '../scripts/pzn-pageview-enrich.js';

beforeEach(() => {
  delete window.intuit;
  delete window.appVars;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pageCasId', () => {
  it('is the page pathname', () => {
    expect(pageCasId()).toBe(window.location.pathname);
  });
});

describe('enrichEventPayload', () => {
  it('fills page_cas_id from the pathname when absent', () => {
    const p = enrichEventPayload({ object: 'content', action: 'interacted' });
    expect(p.page_cas_id).toBe(window.location.pathname);
  });
  it('fills when empty-string', () => {
    expect(enrichEventPayload({ page_cas_id: '' }).page_cas_id).toBe(window.location.pathname);
  });
  it('does NOT clobber a value the profile already set', () => {
    expect(enrichEventPayload({ page_cas_id: 'c14O6fD4y' }).page_cas_id).toBe('c14O6fD4y');
  });
  it('tolerates a non-object', () => {
    expect(() => enrichEventPayload(null)).not.toThrow();
  });
});

describe('wrapTrack', () => {
  it('enriches the payload before the original track fires', () => {
    const original = vi.fn();
    const wa = { track: original };
    wrapTrack(wa);
    wa.track({ object: 'content', action: 'interacted' });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.calls[0][0].page_cas_id).toBe(window.location.pathname);
  });

  it('is idempotent — wrapping twice does not double-wrap', () => {
    const original = vi.fn();
    const wa = { track: original };
    wrapTrack(wa);
    const once = wa.track;
    wrapTrack(wa);
    expect(wa.track).toBe(once);
  });

  it('fails open — an enrichment error still lets the original through', () => {
    const original = vi.fn();
    const wa = { track: original };
    wrapTrack(wa);
    expect(() => wa.track(null)).not.toThrow(); // null payload -> enrich no-ops, original still called
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('no-ops when there is no track method', () => {
    expect(() => wrapTrack({})).not.toThrow();
  });
});

describe('installCasIdEnrich', () => {
  it('wraps track when the chain is built incrementally after install', () => {
    installCasIdEnrich();
    const original = vi.fn();
    window.intuit = {};
    window.intuit.tracking = {};
    window.intuit.tracking.ecs = {};
    window.intuit.tracking.ecs.webAnalytics = { track: original };
    window.intuit.tracking.ecs.webAnalytics.track({ object: 'content' });
    expect(original.mock.calls[0][0].page_cas_id).toBe(window.location.pathname);
  });

  it('wraps track when the whole chain is assigned as one literal after install', () => {
    installCasIdEnrich();
    const original = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { track: original } } } };
    window.intuit.tracking.ecs.webAnalytics.track({ object: 'content' });
    expect(original.mock.calls[0][0].page_cas_id).toBe(window.location.pathname);
  });

  it('coexists with the pzn enrich — both wraps fire on the shared webAnalytics (chain-safe trap)', () => {
    window.appVars = { pznPageRecDetailsArr: [{ personalization_placement: 'HomeHero', personalization_id: 'o1' }] };
    installPznPageViewEnrich(); // traps …webAnalytics first
    installCasIdEnrich(); // must chain onto the same trap, not clobber it
    const trackPage = vi.fn();
    const track = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { trackPage, track } } } };
    const wa = window.intuit.tracking.ecs.webAnalytics;
    wa.trackPage({ personalization_details: null });
    wa.track({ object: 'content' });
    expect(trackPage.mock.calls[0][0].personalization_details).toHaveLength(1); // pzn still works
    expect(track.mock.calls[0][0].page_cas_id).toBe(window.location.pathname); // cas-id works
  });
});
