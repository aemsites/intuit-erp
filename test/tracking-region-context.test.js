import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  resolveRegionContext, regionCustomProperties, stampInteraction, resetTrackingState,
} from '../scripts/tracking.js';

// Coverage for the pzn/ixp region-context fold-in: byo.js's `renderDecision`
// (pzn-exp-byo branch, PR #756 — not present here) publishes
// `window.__pznTrackingContext` as a `WeakMap<Element, ctx>`; this file
// exercises the LOCAL reader (`resolveRegionContext`) and the custom-properties
// mapping (`regionCustomProperties`) this branch reimplements against that same
// window key, plus their wiring into `stampInteraction`.

describe('resolveRegionContext', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__pznTrackingContext;
  });
  afterEach(() => { delete window.__pznTrackingContext; });

  it('returns null when the registry was never published', () => {
    document.body.innerHTML = '<div id="a"><span id="b"></span></div>';
    expect(resolveRegionContext(document.getElementById('b'))).toBeNull();
  });

  it('returns null for a falsy fromEl', () => {
    window.__pznTrackingContext = new WeakMap();
    expect(resolveRegionContext(null)).toBeNull();
  });

  it('resolves a context registered directly on fromEl (inclusive walk)', () => {
    window.__pznTrackingContext = new WeakMap();
    document.body.innerHTML = '<div id="a"></div>';
    const a = document.getElementById('a');
    const ctx = { source: 'pzn', offerId: 'o1' };
    window.__pznTrackingContext.set(a, ctx);
    expect(resolveRegionContext(a)).toBe(ctx);
  });

  it('walks up to the nearest registered ancestor', () => {
    window.__pznTrackingContext = new WeakMap();
    document.body.innerHTML = '<div id="region"><div id="mid"><span id="leaf"></span></div></div>';
    const region = document.getElementById('region');
    const ctx = { source: 'ixp', experimentId: 'e1' };
    window.__pznTrackingContext.set(region, ctx);
    expect(resolveRegionContext(document.getElementById('leaf'))).toBe(ctx);
  });

  it('returns null when the registry exists but no ancestor is registered', () => {
    window.__pznTrackingContext = new WeakMap();
    document.body.innerHTML = '<div id="a"><span id="b"></span></div>';
    expect(resolveRegionContext(document.getElementById('b'))).toBeNull();
  });

  it('the nearest (innermost) registered region wins over an outer one', () => {
    window.__pznTrackingContext = new WeakMap();
    document.body.innerHTML = '<div id="outer"><div id="inner"><a id="cta" href="#">Go</a></div></div>';
    window.__pznTrackingContext.set(document.getElementById('outer'), { source: 'pzn', offerId: 'outer-offer' });
    window.__pznTrackingContext.set(document.getElementById('inner'), { source: 'pzn', offerId: 'inner-offer' });
    expect(resolveRegionContext(document.getElementById('cta')).offerId).toBe('inner-offer');
  });

  it('stops at document.body — a context registered on body itself is never returned', () => {
    window.__pznTrackingContext = new WeakMap();
    document.body.innerHTML = '<span id="leaf"></span>';
    window.__pznTrackingContext.set(document.body, { source: 'pzn', offerId: 'body-offer' });
    expect(resolveRegionContext(document.getElementById('leaf'))).toBeNull();
  });
});

describe('regionCustomProperties', () => {
  it('maps pzn identity fields to namespaced keys and drops the bare source key', () => {
    const props = regionCustomProperties({
      source: 'pzn', offerId: 'offer-1', experimentId: 'exp-1', treatmentId: 'treat-1', placement: 'ALPHA',
    });
    expect(props).toEqual({
      pzn_offer: 'offer-1', pzn_experiment: 'exp-1', pzn_treatment: 'treat-1', pzn_placement: 'ALPHA',
    });
    expect(props.source).toBeUndefined();
  });

  it('maps ixp identity fields to namespaced keys and drops the bare source key', () => {
    const props = regionCustomProperties({
      source: 'ixp', experimentId: 'exp-2', treatmentId: 'treat-2', treatmentKey: 'challenger-1', control: false,
    });
    expect(props).toEqual({
      ixp_experiment: 'exp-2', ixp_treatment: 'treat-2', ixp_treatment_key: 'challenger-1', ixp_control: 'false',
    });
  });

  it('returns {} for a null/undefined ctx or an unrecognized source', () => {
    expect(regionCustomProperties(null)).toEqual({});
    expect(regionCustomProperties(undefined)).toEqual({});
    expect(regionCustomProperties({ source: 'other', foo: 'bar' })).toEqual({});
    expect(regionCustomProperties({})).toEqual({});
  });

  it('drops null/undefined field values, keeps a falsy-but-present value stringified', () => {
    const props = regionCustomProperties({ source: 'ixp', experimentId: 'e1', control: false, treatmentKey: null });
    expect(props).toEqual({ ixp_experiment: 'e1', ixp_control: 'false' });
  });
});

describe('stampInteraction — region context fold-in (additive)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetTrackingState();
    delete window.__pznTrackingContext;
  });
  afterEach(() => { delete window.__pznTrackingContext; });

  it('folds a registered pzn region context into custom_properties for a CTA inside it', () => {
    document.body.innerHTML = '<main><div id="region"><div class="cta block tracking-demo" data-block-name="cta">'
      + '<a class="button" href="#">Schedule a call</a></div></div></main>';
    window.__pznTrackingContext = new WeakMap();
    window.__pznTrackingContext.set(document.getElementById('region'), {
      source: 'pzn', offerId: 'offer-42', experimentId: 'exp-7', treatmentId: 'treat-3', placement: 'ALPHA',
    });

    const a = document.querySelector('a');
    stampInteraction({ target: a });
    const cp = a.getAttribute('data-custom-properties');

    expect(cp).toContain('pzn_offer|offer-42');
    expect(cp).toContain('pzn_experiment|exp-7');
    expect(cp).toContain('pzn_treatment|treat-3');
    expect(cp).toContain('pzn_placement|ALPHA');
    expect(cp).toContain('link_name|button-schedule-a-call'); // derived custom prop still present
    expect(cp).not.toContain('source|'); // bare source key never emitted
    // no new DOM data-attributes are used to carry the region identity
    expect(a.hasAttribute('data-pzn-offer')).toBe(false);
  });

  it('folds a registered ixp region context into custom_properties for a CTA inside it', () => {
    document.body.innerHTML = '<main><div id="region"><div class="cta block tracking-demo" data-block-name="cta">'
      + '<a class="button" href="#">Go</a></div></div></main>';
    window.__pznTrackingContext = new WeakMap();
    window.__pznTrackingContext.set(document.getElementById('region'), {
      source: 'ixp', experimentId: 'exp-9', treatmentId: 'treat-9', treatmentKey: 'challenger-1', control: false,
    });

    const a = document.querySelector('a');
    stampInteraction({ target: a });
    const cp = a.getAttribute('data-custom-properties');

    expect(cp).toContain('ixp_experiment|exp-9');
    expect(cp).toContain('ixp_treatment|treat-9');
    expect(cp).toContain('ixp_treatment_key|challenger-1');
    expect(cp).toContain('ixp_control|false');
  });

  it('the nearest region wins when a CTA sits inside nested registered regions', () => {
    document.body.innerHTML = '<main><div id="outer"><div id="inner"><div class="cta block tracking-demo">'
      + '<a class="button" href="#">Go</a></div></div></div></main>';
    window.__pznTrackingContext = new WeakMap();
    window.__pznTrackingContext.set(document.getElementById('outer'), { source: 'pzn', offerId: 'outer-offer' });
    window.__pznTrackingContext.set(document.getElementById('inner'), { source: 'pzn', offerId: 'inner-offer' });

    const a = document.querySelector('a');
    stampInteraction({ target: a });
    const cp = a.getAttribute('data-custom-properties');

    expect(cp).toContain('pzn_offer|inner-offer');
    expect(cp).not.toContain('outer-offer');
  });

  it('a CTA outside any registered region is unchanged (no pzn_/ixp_ keys leak in)', () => {
    document.body.innerHTML = '<main>'
      + '<div id="region"><div class="cta block tracking-demo" data-block-name="cta">'
      + '<a class="button" href="#">Schedule a call</a></div></div>'
      + '<div class="cta2 block tracking-outside" data-block-name="cta2">'
      + '<a class="button" id="outside" href="#">Elsewhere</a></div>'
      + '</main>';
    window.__pznTrackingContext = new WeakMap();
    window.__pznTrackingContext.set(document.getElementById('region'), { source: 'pzn', offerId: 'offer-42' });

    const outside = document.getElementById('outside');
    stampInteraction({ target: outside });

    expect(outside.getAttribute('data-object')).toBe('content');
    expect(outside.getAttribute('data-ui-object-detail')).toBe('Elsewhere');
    // exactly the derived link_name (jsdom's window.location.hostname suffix,
    // same as any other stampInteraction call), no region identity leaked in
    // from the sibling region
    expect(outside.getAttribute('data-custom-properties')).toBe('link_name|button-elsewhere [localhost]');
  });

  it('a CTA with no region registry at all behaves exactly as before this change', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<a class="button" href="#">Schedule a call</a></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object')).toBe('button');
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call');
    expect(a.getAttribute('data-tracking')).toBe('button');
    expect(a.getAttribute('data-ui-access-point')).toBe('');
    expect(a.getAttribute('data-custom-properties')).toBe('link_name|button-schedule-a-call [localhost]');
  });
});
