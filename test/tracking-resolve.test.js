import { describe, it, expect } from 'vitest';
import { deriveBaseline } from '../scripts/tracking.js';
import {
  resolveCta, assembleCustomProperties, mergeCustomProperties,
} from '../scripts/tracking.js';

const cta = (over = {}) => deriveBaseline({
  tagName: 'A', label: 'Schedule a call', blockName: 'cta', ...over,
});

describe('assembleCustomProperties', () => {
  it('joins pairs as k|v,k|v', () => {
    expect(assembleCustomProperties({ link_name: 'button-x', campaign: 'spring' }))
      .toBe('link_name|button-x,campaign|spring');
  });
  it('drops unrepresentable pairs (would break the tracker parse — trap #2)', () => {
    expect(assembleCustomProperties({ ok: 'a', bad: 'a|b', worse: 'a,b' })).toBe('ok|a');
  });
  it('drops empty/null values', () => {
    expect(assembleCustomProperties({ a: '', b: null, c: 'x' })).toBe('c|x');
  });
});

describe('mergeCustomProperties', () => {
  it('later sources win on key collision (specific wins)', () => {
    expect(mergeCustomProperties({ campaign: 'page' }, { campaign: 'cta' })).toEqual({ campaign: 'cta' });
  });
});

describe('resolveCta — full path', () => {
  it('stamps the derived baseline when there is no sheet row', () => {
    const a = resolveCta(cta(), null);
    expect(a['data-object']).toBe('content');
    expect(a['data-ui-object']).toBe('button');
    expect(a['data-ui-object-detail']).toBe('Schedule a call');
    expect(a['data-action']).toBe('interacted');
    expect(a['data-ui-action']).toBe('clicked');
    expect(a['data-tracking']).toBe('button'); // sacrificial anchor
    expect(a['data-ui-access-point']).toBe(''); // opt-in presence
    expect(a['data-custom-properties']).toBe('link_name|button-schedule-a-call');
    expect(a['data-wa-link']).toBeUndefined();
  });

  it('lets the sheet override a derived identity field (button -> input)', () => {
    const a = resolveCta(cta(), { 'ui-object': 'input' });
    expect(a['data-ui-object']).toBe('input');
    expect(a['data-ui-object-detail']).toBe('Schedule a call'); // still derived
  });

  it('uses an explicit ui-access-point value over the trail', () => {
    const a = resolveCta(cta(), { 'ui-access-point': 'hero' });
    expect(a['data-ui-access-point']).toBe('hero');
  });

  it('emits opt-in survey fields, prefixing bare keys', () => {
    const a = resolveCta(cta(), { survey: { 'survey-name': 'nps', screen: 'welcome' } });
    expect(a['data-survey-name']).toBe('nps');
    expect(a['data-survey-screen']).toBe('welcome');
  });
});

describe('resolveCta — wa-link (re-verified: no separate path)', () => {
  it('defaults object=content and keeps deriving; wa-link is added, not exclusive', () => {
    const a = resolveCta(cta(), { 'wa-link': 'ies-nav:main-demo-cta' });
    expect(a['data-wa-link']).toBe('ies-nav:main-demo-cta');
    expect(a['data-object']).toBe('content'); // derived default (no walink short-circuit)
    expect(a['data-ui-object']).toBe('button'); // derived kind still applied
    expect(a['data-tracking']).toBe('button'); // anchor
  });

  it('keeps object-detail / ui-object residue alongside a wa-link (live-sheet shape)', () => {
    const a = resolveCta(cta(), {
      'wa-link': 'hero-schedule-call-cta',
      'object-detail': 'hero|schedule_call',
      'ui-object': 'accordion_item_1',
    });
    expect(a['data-wa-link']).toBe('hero-schedule-call-cta');
    expect(a['data-object-detail']).toBe('hero|schedule_call'); // NOT dropped
    expect(a['data-ui-object']).toBe('accordion_item_1'); // sheet override, NOT dropped
    expect(a['data-object']).toBe('content');
  });

  it('takes the sheet object when authored', () => {
    const a = resolveCta(cta(), { 'wa-link': 'ies:demo', object: 'video' });
    expect(a['data-object']).toBe('video');
    expect(a['data-wa-link']).toBe('ies:demo');
  });
});

describe('resolveCta — custom-properties cascade', () => {
  it('merges context + derived + sheet, sheet (specific) wins', () => {
    const a = resolveCta(
      cta(),
      { 'custom-properties': { campaign: 'cta' } },
      { customProperties: { campaign: 'page', region: 'us' } },
    );
    // region from page, campaign from the CTA-level sheet, link_name derived
    expect(a['data-custom-properties']).toContain('region|us');
    expect(a['data-custom-properties']).toContain('campaign|cta');
    expect(a['data-custom-properties']).toContain('link_name|button-schedule-a-call');
    expect(a['data-custom-properties']).not.toContain('campaign|page');
  });
});
