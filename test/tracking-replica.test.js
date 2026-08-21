import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTrackingAccessStructure, computeTrackingPayload, parseCustomProperties,
} from '../scripts/diff/tracker-replica.mjs';

beforeEach(() => { document.body.innerHTML = ''; });

describe('getTrackingAccessStructure (reverse-engineered trail)', () => {
  it('joins broad->specific, matching the live carousel value', () => {
    document.body.innerHTML = '<div data-tracking="rw_cards_container">'
      + '<div data-tracking="carousel"><div data-tracking="rw_card_1">'
      + '<img id="img" data-tracking="image"></div></div></div>';
    expect(getTrackingAccessStructure(document.getElementById('img')))
      .toBe('rw_cards_container|carousel|rw_card_1');
  });

  it('matches the live footer value', () => {
    document.body.innerHTML = '<div data-tracking="footer"><div data-tracking="footer_menus">'
      + '<div data-tracking="footer_menu_section"><a id="l" data-tracking="link">x</a>'
      + '</div></div></div>';
    expect(getTrackingAccessStructure(document.getElementById('l')))
      .toBe('footer|footer_menus|footer_menu_section');
  });

  it('skips the sacrificial anchor: click a span inside a button in a cta_block', () => {
    document.body.innerHTML = '<div data-tracking="cta_block">'
      + '<button data-tracking="button"><span id="s">Schedule a call</span></button></div>';
    expect(getTrackingAccessStructure(document.getElementById('s'))).toBe('cta_block');
  });

  it('normalizes hyphens to underscores', () => {
    document.body.innerHTML = '<div data-tracking="rw-cards"><a id="a" data-tracking="link">x</a></div>';
    expect(getTrackingAccessStructure(document.getElementById('a'))).toBe('rw_cards');
  });
});

describe('parseCustomProperties', () => {
  it('keeps two-part pairs', () => {
    expect(parseCustomProperties('link_name|button-x,campaign|spring'))
      .toEqual({ link_name: 'button-x', campaign: 'spring' });
  });
  it('drops a three-part segment (live nav bug — trap #2)', () => {
    expect(parseCustomProperties('link_name|button-nav|schedule_demo')).toEqual({});
  });
});

describe('computeTrackingPayload (re-verified 2026-08-20 tracker contract)', () => {
  it('returns null when the gate finds no object/wa-link (nothing sent)', () => {
    document.body.innerHTML = '<div><a id="a" href="#">x</a></div>';
    expect(computeTrackingPayload(document.getElementById('a'))).toBe(null);
  });

  it('wa-link without data-object defaults object=content/action=engaged and folds into icom_user_action', () => {
    document.body.innerHTML = '<div data-tracking="cta_block">'
      + '<a id="a" data-wa-link="ies-nav:main-demo-cta" data-object-detail="nav|schedule_demo">x</a></div>';
    const p = computeTrackingPayload(document.getElementById('a'), { breadcrumb: 'cmo|mktg|corp|enterprise|homepage' });
    expect(p.event).toBe('content:engaged');
    expect(p.object).toBe('content'); // no walink hardcoding anymore
    expect(p.action).toBe('engaged');
    expect(p.ui_object).toBe('link');
    expect(p['data-wa-link']).toBe('ies-nav:main-demo-cta');
    expect(p.icom_user_action).toBe('ies-nav:main-demo-cta [cmo|mktg|corp|enterprise|homepage]');
    expect(p.object_detail).toBe('nav|schedule_demo'); // read normally, not discarded
    expect(p.custom_properties).toBeUndefined(); // no custom_properties object
  });

  it('reads the full path and derives the event name from object:action', () => {
    document.body.innerHTML = '<div data-tracking="cta_block"><button id="b"'
      + ' data-object="content" data-object-detail="" data-ui-object="button"'
      + ' data-ui-object-detail="Schedule a call" data-action="interacted"'
      + ' data-ui-action="clicked" data-ui-access-point="" data-tracking="button"'
      + ' data-custom-properties="link_name|button-schedule-a-call">'
      + '<span id="s">Schedule a call</span></button></div>';
    const p = computeTrackingPayload(document.getElementById('s'));
    expect(p.event).toBe('content:interacted');
    expect(p.object).toBe('content');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('Schedule a call');
    expect(p.object_detail).toBe(''); // present-but-empty ships
    expect(p.ui_access_point).toBe('cta_block'); // empty opt-in -> trail, anchor skipped
    expect(p.link_name).toBe('button-schedule-a-call'); // custom-prop expanded to top-level
    expect(p.custom_properties).toBeUndefined();
  });

  it('computes the trail for ui_access_point — an authored value does NOT win', () => {
    document.body.innerHTML = '<div data-tracking="cta_block">'
      + '<button id="b" data-object="content" data-ui-access-point="hero" data-tracking="button">x</button></div>';
    // authored "hero" is ignored; the computed trail (anchor skipped) wins
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBe('cta_block');
  });

  it('falls ui_access_point back to "page" when the trail is empty in the body', () => {
    document.body.innerHTML = '<main><button id="b" data-object="content" data-ui-access-point="">x</button></main>';
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBe('page');
  });

  it('falls ui_access_point back to "" inside <header> (global-nav reports empty)', () => {
    document.body.innerHTML = '<header><button id="b" data-object="content" data-ui-access-point="">x</button></header>';
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBe('');
  });

  it('falls ui_access_point back to "page" in the <footer> (not empty like the header)', () => {
    document.body.innerHTML = '<footer><a id="b" href="/x" data-object="content" data-ui-access-point="">x</a></footer>';
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBe('page');
  });

  it('omits ui_access_point entirely when data-ui-access-point is absent (no opt-in)', () => {
    document.body.innerHTML = '<button id="b" data-object="content">x</button>';
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBeUndefined();
  });

  it('expands every custom-property to a top-level field (not a custom_properties object)', () => {
    document.body.innerHTML = '<button id="b" data-object="content"'
      + ' data-custom-properties="link_name|button-x,my_prop|xyz">x</button>';
    const p = computeTrackingPayload(document.getElementById('b'));
    expect(p.link_name).toBe('button-x');
    expect(p.my_prop).toBe('xyz');
    expect(p.custom_properties).toBeUndefined();
  });

  it('forwards survey fields (snake_case; survey-answer coerced to boolean)', () => {
    document.body.innerHTML = '<button id="b" data-object="content"'
      + ' data-survey-name="nps" data-survey-answer-optin="true">x</button>';
    const p = computeTrackingPayload(document.getElementById('b'));
    expect(p.survey_name).toBe('nps');
    expect(p.optin).toBe(true);
  });
});
