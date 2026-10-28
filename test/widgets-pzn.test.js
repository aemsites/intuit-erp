import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

// web-survey + form-vs-chilipiper import createModal, and web-survey imports loadFragment; stub both
// so importing the modules doesn't pull the modal/fragment → scripts.js graph (which runs loadPage
// on import) into these pure-helper tests.
vi.mock('../blocks/modal/modal.js', () => ({
  createModal: vi.fn(async () => {
    const block = document.createElement('div');
    block.innerHTML = '<dialog></dialog>';
    return { showModal: vi.fn(), block };
  }),
  openModal: vi.fn(() => Promise.resolve(null)),
  isModalActive: vi.fn(() => false),
}));
vi.mock('../blocks/fragment/fragment.js', () => ({
  loadFragment: vi.fn(async () => null),
}));

// eslint-disable-next-line import/first
import decorateChiliPiper, {
  createUUID,
  buildChiliPiperUrl,
} from '../widgets/pzn/form-vs-chilipiper/form-vs-chilipiper.js';
// eslint-disable-next-line import/first
import { createModal, openModal, isModalActive } from '../blocks/modal/modal.js';
// eslint-disable-next-line import/first
import { openScheduleModal } from '../scripts/schedule-modal.js';
// eslint-disable-next-line import/first
import {
  alreadyHandled, surveyUrl, resolveSurveyBase, bindAccept,
} from '../widgets/pzn/web-survey/web-survey.js';
// eslint-disable-next-line import/first
import decorateSmartform, { appendDisclaimer } from '../widgets/pzn/smartform/smartform.js';
// eslint-disable-next-line import/first
import decorateScheduleFragment, {
  resolveFragmentPath,
} from '../widgets/pzn/schedule-fragment/schedule-fragment.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.chilipiperBound;
  delete document.documentElement.dataset.scheduleFragmentBound;
  vi.clearAllMocks();
  ['wsp_accepted', 'wsp_declined', 'wsp_displayed', 'ivid'].forEach((c) => {
    document.cookie = `${c}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
  delete window.ziFcInstalled;
  delete window.ZIProjectKey;
  delete window._zi_fc;
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

  it('claims the header CTA (rendered after decorate) and suppresses its baseline handler', async () => {
    document.body.innerHTML = '<header></header><div class="widget"></div>';
    const widget = document.querySelector('.widget');
    await decorateChiliPiper(widget);

    // Header chrome (and its "Schedule a call" nav CTA) can render after the
    // widget decorates; the capture-phase handler must still claim it.
    document.querySelector('header').innerHTML = '<button type="button" class="nav-cta">Schedule a call</button>';
    const cta = document.querySelector('header .nav-cta');
    // Baseline header handler (blocks/header/header.js) opens the schedule modal;
    // the widget must suppress it without any header.js cooperation.
    cta.addEventListener('click', () => openScheduleModal());
    // A sibling document-capture listener (e.g. of1-intent) must still fire —
    // the widget uses stopPropagation, not stopImmediatePropagation.
    const siblingCapture = vi.fn();
    document.addEventListener('click', siblingCapture, true);

    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(cta.dataset.chilipiperTrigger).toBe('true');
    expect(createModal).toHaveBeenCalledTimes(1);
    expect(openModal).not.toHaveBeenCalled(); // baseline schedule handler suppressed
    expect(siblingCapture).toHaveBeenCalledTimes(1);

    document.removeEventListener('click', siblingCapture, true);
  });

  it('shows a spinner and aria-disabled on the CTA while the ChiliPiper modal opens', async () => {
    let resolveCreate;
    createModal.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    // Unique trigger class to avoid stale listeners bound by earlier tests in this file.
    document.body.innerHTML = '<div class="widget"></div><button type="button" class="spinner-test-cta">Schedule a call</button>';
    const widget = document.querySelector('.widget');
    widget.dataset.trigger = '.spinner-test-cta';
    await decorateChiliPiper(widget);
    const cta = document.querySelector('.spinner-test-cta');

    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(cta.getAttribute('aria-disabled')).toBe('true');
    expect(cta.querySelector('.modal-trigger-spinner')).not.toBeNull();

    const block = document.createElement('div');
    block.innerHTML = '<dialog></dialog>';
    resolveCreate({ showModal: vi.fn(), block });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(cta.querySelector('.modal-trigger-spinner')).toBeNull();
    expect(cta.getAttribute('aria-disabled')).toBe('true'); // stays disabled until the dialog closes
  });

  it('does not open a ChiliPiper modal when a modal is already active elsewhere', async () => {
    isModalActive.mockReturnValueOnce(true);
    document.body.innerHTML = '<div class="widget"></div><button type="button" class="blocked-test-cta">Schedule a call</button>';
    const widget = document.querySelector('.widget');
    widget.dataset.trigger = '.blocked-test-cta';
    await decorateChiliPiper(widget);
    const cta = document.querySelector('.blocked-test-cta');

    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(createModal).not.toHaveBeenCalled();
    expect(cta.hasAttribute('aria-disabled')).toBe(false);
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

describe('web-survey: resolveSurveyBase / bindAccept', () => {
  const DEFAULT = 'https://j1.intellisurvey.com/pub/is14262?pan=991';
  const anchor = (href) => {
    const a = document.createElement('a');
    if (href != null) a.setAttribute('href', href);
    a.className = 'button';
    return a;
  };

  it('resolveSurveyBase prefers the widget ?survey override', () => {
    const widget = document.createElement('div');
    widget.dataset.survey = 'https://override.example/s';
    expect(resolveSurveyBase(widget, anchor('https://frag.example/x'))).toBe('https://override.example/s');
  });
  it('falls back to the CTA href when it is absolute', () => {
    expect(resolveSurveyBase(document.createElement('div'), anchor('https://frag.example/x'))).toBe('https://frag.example/x');
  });
  it('falls back to the default with no override and a non-absolute (or missing) CTA href', () => {
    expect(resolveSurveyBase(document.createElement('div'), anchor('#'))).toBe(DEFAULT);
    expect(resolveSurveyBase(document.createElement('div'), null)).toBe(DEFAULT);
  });

  it('bindAccept stamps tracking attrs and, on click, sets wsp_accepted + opens the survey with the ivid', () => {
    document.cookie = 'ivid=visitor-9';
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const a = anchor('#');
    bindAccept(a, 'https://s.example/pub/x?pan=1');

    expect(a.getAttribute('data-ui-object-detail')).toBe('ies-web-survey-popup-modal continue button');
    expect(a.getAttribute('data-action')).toBe('interacted');

    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.cookie).toContain('wsp_accepted=true');
    expect(openSpy).toHaveBeenCalledWith('https://s.example/pub/x?pan=1&transid=visitor-9', '_self');
    openSpy.mockRestore();
  });
});

describe('smartform: appendDisclaimer', () => {
  // Mirrors the real Marketo markup: input nested in .mktoFieldWrap beside a floated label.
  const formWithCompany = (value = 'Acme Inc') => {
    const form = document.createElement('form');
    form.className = 'mktoForm';
    form.innerHTML = `
      <div class="mktoFormRow"><div class="mktoFieldDescriptor mktoFormCol">
        <div class="mktoOffset"></div>
        <div class="mktoFieldWrap">
          <label for="intuitCompanyName">Business Name:</label>
          <div class="mktoGutter"></div>
          <input id="intuitCompanyName" name="intuitCompanyName" class="mktoField mktoValid"
            value="${value}" data-zi-input-enriched="true">
          <span class="mktoInstruction"></span>
          <div class="mktoClear"></div>
        </div>
        <div class="mktoClear"></div>
      </div></div>`;
    return form;
  };

  it('drops the note below the field wrap, clear of the floated input', () => {
    const form = formWithCompany();
    appendDisclaimer(form);
    const msg = form.querySelector('.zi-formcomplete-msg');
    expect(msg).toBeTruthy();
    expect(form.querySelector('.mktoFieldWrap').nextElementSibling).toBe(msg);
  });
  it('does not double-insert', () => {
    const form = formWithCompany();
    appendDisclaimer(form);
    appendDisclaimer(form);
    expect(form.querySelectorAll('.zi-formcomplete-msg')).toHaveLength(1);
  });
  it('survives the synthetic change/input events fired by ZI autofill and Marketo validation', () => {
    const form = formWithCompany();
    appendDisclaimer(form);
    const input = form.querySelector('[name="intuitCompanyName"]');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(form.querySelector('.zi-formcomplete-msg')).toBeTruthy();
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

describe('smartform: decorate defers ZoomInfo until the Marketo form is present', () => {
  const addMktoForm = () => {
    const form = document.createElement('form');
    form.className = 'mktoForm';
    form.innerHTML = '<input name="Email" type="email">';
    document.body.append(form);
    return form;
  };

  it('does not load ZoomInfo while no .mktoForm exists, then loads it once one appears', async () => {
    await decorateSmartform();
    expect(window.ziFcInstalled).toBeFalsy();
    expect(document.querySelector('script[src*="zi-tag"]')).toBeNull();

    addMktoForm();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(window.ziFcInstalled).toBe(true);
    expect(document.querySelector('script[src*="zi-tag"]')).toBeTruthy();
  });

  it('loads ZoomInfo immediately when the form is already present', async () => {
    addMktoForm();
    await decorateSmartform();
    expect(window.ziFcInstalled).toBe(true);
    expect(document.querySelector('script[src*="zi-tag"]')).toBeTruthy();
  });

  // ZoomInfo's formcomplete.js dispatches lifecycle callbacks via window._zi_fc[method] — registering
  // them under any other global (e.g. window.zi__fc) means onMatch never fires and the disclaimer
  // never appears even though ZI enriches the field. Pin the exact global and the onMatch behaviour.
  it('registers lifecycle callbacks on window._zi_fc and appends the disclaimer on match', async () => {
    const form = addMktoForm();
    form.insertAdjacentHTML('beforeend', '<div class="mktoFieldWrap">'
      + '<input name="intuitCompanyName" class="mktoField" value="Acme Inc" data-zi-input-enriched="true">'
      + '</div>');
    await decorateSmartform();

    expect(typeof window._zi_fc?.onMatch).toBe('function');
    window._zi_fc.onMatch({});
    expect(form.querySelector('.zi-formcomplete-msg')).toBeTruthy();
  });
});

describe('schedule-fragment: resolveFragmentPath', () => {
  it('keeps absolute paths and resolves bare names under /fragments/', () => {
    expect(resolveFragmentPath('/fragments/pzn/x/form-a')).toBe('/fragments/pzn/x/form-a');
    expect(resolveFragmentPath('schedule-call-vertical')).toBe('/fragments/schedule-call-vertical');
  });
  it('returns null when no fragment is configured', () => {
    expect(resolveFragmentPath('')).toBeNull();
    expect(resolveFragmentPath(undefined)).toBeNull();
  });
});

describe('schedule-fragment: decorate repoints the schedule modal', () => {
  const click = async (el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  };

  it('opens the configured fragment instead of the baseline schedule modal', async () => {
    document.body.innerHTML = '<div class="widget"></div>';
    const widget = document.querySelector('.widget');
    widget.dataset.fragment = '/fragments/pzn/test/form-variant';
    widget.dataset.trigger = '.sf-test-cta';
    await decorateScheduleFragment(widget);

    // The CTA renders after the widget decorates; the capture-phase handler still claims it.
    document.body.insertAdjacentHTML('beforeend', '<a class="sf-test-cta" href="#schedule">Schedule a call</a>');
    const cta = document.querySelector('.sf-test-cta');
    const baseline = vi.fn();
    cta.addEventListener('click', baseline);

    await click(cta);
    expect(openModal).toHaveBeenCalledWith('/fragments/pzn/test/form-variant');
    expect(baseline).not.toHaveBeenCalled();
  });

  it('defaults to every #schedule link (relative or absolute)', async () => {
    // (The header nav CTA is in the default selector too; it's not clicked here because the
    // ChiliPiper tests above leave a document listener that claims `header .nav-cta`.)
    document.body.innerHTML = '<div class="widget"></div><a class="cta-a" href="#schedule">A</a>'
      + '<a class="cta-b" href="https://erp.intuit.com/x#schedule">B</a>';
    const widget = document.querySelector('.widget');
    widget.dataset.fragment = 'pzn/test/form-default';
    await decorateScheduleFragment(widget);

    await click(document.querySelector('.cta-a'));
    await click(document.querySelector('.cta-b'));
    expect(openModal).toHaveBeenCalledTimes(2);
    expect(openModal).toHaveBeenNthCalledWith(1, '/fragments/pzn/test/form-default');
  });

  it('leaves CTAs alone when no fragment is configured, and yields to a ChiliPiper claim', async () => {
    document.body.innerHTML = '<div class="widget"></div><a class="sf-cp-cta" href="#schedule" data-chilipiper-trigger="true">x</a>';
    const empty = document.querySelector('.widget');
    empty.dataset.trigger = '.sf-cp-cta';
    await decorateScheduleFragment(empty);
    expect(document.documentElement.dataset.scheduleFragmentBound).toBeUndefined();

    empty.dataset.fragment = '/fragments/pzn/test/form-cp';
    await decorateScheduleFragment(empty);
    await click(document.querySelector('.sf-cp-cta'));
    expect(openModal).not.toHaveBeenCalled();
  });
});
