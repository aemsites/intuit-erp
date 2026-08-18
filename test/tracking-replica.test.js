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

describe('computeTrackingPayload', () => {
  it('returns null when the gate finds no object/wa-link (nothing sent)', () => {
    document.body.innerHTML = '<div><a id="a" href="#">x</a></div>';
    expect(computeTrackingPayload(document.getElementById('a'))).toBe(null);
  });

  it('takes the wa-link path: hardcoded walink, object/action attrs discarded', () => {
    document.body.innerHTML = '<div data-tracking="cta_block">'
      + '<a id="a" data-wa-link="ies-nav:main-demo-cta" data-object-detail="nav|schedule_demo">x</a></div>';
    const p = computeTrackingPayload(document.getElementById('a'));
    expect(p.object).toBe('walink');
    expect(p.ui_action).toBe('INTERACTED');
    expect(p.custom_properties).toEqual({ 'data-wa-link': 'ies-nav:main-demo-cta' });
    expect(p.object_detail).toBeUndefined(); // discarded on the wa-link path
  });

  it('takes the full path and reproduces the live cta_block button payload', () => {
    document.body.innerHTML = '<div data-tracking="cta_block"><button id="b"'
      + ' data-object="content" data-object-detail="" data-ui-object="button"'
      + ' data-ui-object-detail="Schedule a call" data-action="interacted"'
      + ' data-ui-action="clicked" data-ui-access-point="" data-tracking="button"'
      + ' data-custom-properties="link_name|button-schedule-a-call">'
      + '<span id="s">Schedule a call</span></button></div>';
    const p = computeTrackingPayload(document.getElementById('s'));
    expect(p.object).toBe('content');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('Schedule a call');
    expect(p.object_detail).toBe(''); // present-but-empty ships
    expect(p.ui_access_point).toBe('cta_block'); // empty opt-in -> trail
    expect(p.custom_properties).toEqual({ link_name: 'button-schedule-a-call' });
  });

  it('lets an explicit ui-access-point win over the trail', () => {
    document.body.innerHTML = '<div data-tracking="cta_block">'
      + '<button id="b" data-object="content" data-ui-access-point="hero">x</button></div>';
    expect(computeTrackingPayload(document.getElementById('b')).ui_access_point).toBe('hero');
  });

  it('forwards survey fields (snake_case; survey-answer coerced to boolean)', () => {
    document.body.innerHTML = '<button id="b" data-object="content"'
      + ' data-survey-name="nps" data-survey-answer-optin="true">x</button>';
    const p = computeTrackingPayload(document.getElementById('b'));
    expect(p.survey_name).toBe('nps');
    expect(p.optin).toBe(true);
  });
});
