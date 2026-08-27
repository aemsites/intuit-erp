import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

// web-survey + form-vs-chilipiper import createModal; stub it so importing the modules doesn't
// pull the modal → fragment → scripts.js graph into these pure-helper tests.
vi.mock('../blocks/modal/modal.js', () => ({
  createModal: vi.fn(async () => ({ showModal: vi.fn(), block: document.createElement('div') })),
}));

// eslint-disable-next-line import/first
import { createUUID, buildChiliPiperUrl } from '../widgets/pzn/form-vs-chilipiper/form-vs-chilipiper.js';
// eslint-disable-next-line import/first
import { alreadyHandled, surveyUrl } from '../widgets/pzn/web-survey/web-survey.js';
// eslint-disable-next-line import/first
import { appendDisclaimer } from '../widgets/pzn/smartform/smartform.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  ['wsp_accepted', 'wsp_declined', 'wsp_displayed'].forEach((c) => {
    document.cookie = `${c}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
});

describe('form-vs-chilipiper: createUUID / buildChiliPiperUrl', () => {
  it('createUUID returns a v4 UUID', () => {
    expect(createUUID()).toMatch(UUID_RE);
  });
  it('buildChiliPiperUrl appends lead_xref_id and returns the matching id', () => {
    const { url, leadXrefId } = buildChiliPiperUrl('https://x.chilipiper.com/round-robin/r');
    expect(leadXrefId).toMatch(UUID_RE);
    expect(url).toBe(`https://x.chilipiper.com/round-robin/r?lead_xref_id=${leadXrefId}`);
  });
  it('uses & when the base already has a query string', () => {
    const { url } = buildChiliPiperUrl('https://x.chilipiper.com/r?a=1');
    expect(url).toContain('?a=1&lead_xref_id=');
  });
});

describe('web-survey: alreadyHandled / surveyUrl', () => {
  it('alreadyHandled is false with no cookies, true once any wsp_* is true', () => {
    expect(alreadyHandled()).toBe(false);
    document.cookie = 'wsp_declined=true';
    expect(alreadyHandled()).toBe(true);
  });
  it('surveyUrl appends the ivid as transid, url-encoded', () => {
    expect(surveyUrl('https://s.example/pub/x?pan=991', 'iv 1')).toBe('https://s.example/pub/x?pan=991&transid=iv%201');
    expect(surveyUrl('https://s.example/pub/x', 'iv1')).toBe('https://s.example/pub/x?transid=iv1');
  });
});

describe('smartform: appendDisclaimer', () => {
  const formWithCompany = () => {
    const form = document.createElement('form');
    form.innerHTML = '<input name="intuitCompanyName" id="intuitCompanyName">';
    return form;
  };

  it('inserts the note right after the company field', () => {
    const form = formWithCompany();
    appendDisclaimer(form);
    const msg = form.querySelector('.zi-formcomplete-msg');
    expect(msg).toBeTruthy();
    expect(form.querySelector('[name="intuitCompanyName"]').nextElementSibling).toBe(msg);
  });
  it('does not double-insert', () => {
    const form = formWithCompany();
    appendDisclaimer(form);
    appendDisclaimer(form);
    expect(form.querySelectorAll('.zi-formcomplete-msg')).toHaveLength(1);
  });
  it('skips when the visitor already typed the company name', () => {
    const form = formWithCompany();
    form.querySelector('[name="intuitCompanyName"]').dataset.hasusertyped = 'true';
    appendDisclaimer(form);
    expect(form.querySelector('.zi-formcomplete-msg')).toBeNull();
  });
  it('is a no-op (no throw) when there is no company field', () => {
    const form = document.createElement('form');
    expect(() => appendDisclaimer(form)).not.toThrow();
    expect(form.querySelector('.zi-formcomplete-msg')).toBeNull();
  });
});
