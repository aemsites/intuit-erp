import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import decorate, { parseFormConfig } from '../blocks/form/form.js';

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js and blocks/form/form.js.
// // eslint-disable-next-line import/no-relative-packages
// import { sendEvent } from '../plugins/martech/src/index.js';
// vi.mock('../plugins/martech/src/index.js', () => ({
//   sendEvent: vi.fn(() => Promise.resolve()),
// }));
vi.mock('../scripts/aem.js', () => ({
  loadScript: vi.fn(() => Promise.resolve()),
  getMetadata: vi.fn(() => ''),
  decorateIcons: vi.fn(),
}));
vi.mock('../scripts/placeholders.js', () => ({
  fetchPlaceholders: vi.fn(() => Promise.resolve({})),
}));
import { loadScript, getMetadata } from '../scripts/aem.js';
import { getSiteConfig } from '../scripts/scripts.js';

vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({
    'marketo.munchkin': '743-RZM-619',
    'chilipiper.subdomain': 'intuitsales',
  })),
}));

const flush = () => new Promise((r) => { setTimeout(r, 0); });

const RECAPTCHA_CFG = {
  'marketo.munchkin': '743-RZM-619',
  'chilipiper.subdomain': 'intuitsales',
  'recaptcha.enabled': true,
  'recaptcha.siteKey': '6LeQ-test',
  'recaptcha.verifyUrl': 'https://marketingplatform.api.intuit.com/v3/captcha/verify',
  'recaptcha.apiKey': 'Intuit_APIKey intuit_apikey=test',
};

let onSuccessFn;
let onValidateFn;
let submittable;
let hiddenFields;
beforeEach(() => {
  onSuccessFn = null;
  onValidateFn = null;
  submittable = vi.fn();
  hiddenFields = {};
  // Uncomment with the AEP/WebSDK integration in scripts/scripts.js and blocks/form/form.js.
  // sendEvent.mockClear();
  getSiteConfig.mockResolvedValue({
    'marketo.munchkin': '743-RZM-619',
    'chilipiper.subdomain': 'intuitsales',
  });
  getMetadata.mockReturnValue(''); // no `marketo` metadata → prod instance
  delete window.utag;
  delete window.grecaptcha;
  delete global.fetch;
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }

    observe() { this.cb([{ isIntersecting: true }]); }

    disconnect() {}
  };
  window.MktoForms2 = {
    whenReady: vi.fn((cb) => {
      queueMicrotask(() => {
        const formId = document.querySelector('[id^="mktoForm_"]')?.id?.replace('mktoForm_', '');
        if (!formId) return;
        const el = document.getElementById(`mktoForm_${formId}`);
        cb({
          getId: () => formId,
          getFormElem: () => (el ? [el] : []),
        });
      });
    }),
    loadForm: vi.fn((host, munchkin, formId, cb) => {
      // simulate Marketo rendering its button row into the form element
      const el = document.getElementById(`mktoForm_${formId}`);
      if (el) el.innerHTML = '<div class="mktoButtonRow"><button class="mktoButton" type="submit">Schedule a call</button></div>';
      cb({
        onSuccess: (fn) => { onSuccessFn = fn; },
        onValidate: (fn) => { onValidateFn = fn; },
        submittable,
        addHiddenFields: (fields) => { hiddenFields = { ...hiddenFields, ...fields }; },
        getId: () => formId,
        getFormElem: () => {
          const el = document.getElementById(`mktoForm_${formId}`);
          return el ? [el] : [];
        },
        getValues: () => ({
          Email: 'controller@brightpathco.com',
          FirstName: 'Dana',
          Company: 'Bright Path',
          ...hiddenFields,
        }),
        onSubmit: vi.fn(),
      });
    }),
  };
  window.ChiliPiper = { submit: vi.fn(), scheduling: vi.fn() };
});

// grecaptcha stub whose execute() resolves the given token
function mockGrecaptcha(token = 'tok') {
  window.grecaptcha = {
    ready: (fn) => fn(),
    execute: vi.fn(() => Promise.resolve(token)),
  };
}

function make(rows) {
  const block = document.createElement('div');
  block.className = 'form block';
  block.innerHTML = rows.map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`).join('');
  return block;
}

describe('parseFormConfig', () => {
  it('extracts the per-page config rows', () => {
    const cfg = parseFormConfig(make([
      ['formId', '1058'],
      ['chiliPiperRouter', 'mid-us-webform-managed-ies'],
      ['header', 'Let’s connect'],
      ['downloadUrl', '/assets/report.pdf'],
    ]));
    expect(cfg.formId).toBe('1058');
    expect(cfg.chiliPiperRouter).toBe('mid-us-webform-managed-ies');
    expect(cfg.header).toBe('Let’s connect');
    expect(cfg.downloadUrl).toBe('/assets/report.pdf');
  });

  it('parses the per-form recaptcha opt-in as a boolean', () => {
    expect(parseFormConfig(make([['formId', '1058'], ['recaptcha', 'true']])).recaptcha).toBe(true);
    expect(parseFormConfig(make([['formId', '1058'], ['recaptcha', 'false']])).recaptcha).toBe(false);
    expect(parseFormConfig(make([['formId', '1058']])).recaptcha).toBe(false);
  });
});

describe('decorate — live Marketo form', () => {
  it('renders a Marketo form element with the authored form id and header', async () => {
    const block = make([['formId', '1058'], ['header', 'Let’s connect']]);
    await decorate(block);
    expect(block.querySelector('form#mktoForm_1058')).not.toBeNull();
    expect(block.querySelector('.form-header').textContent).toBe('Let’s connect');
  });

  it('injects the disclaimer (with markup) above the Marketo submit button', async () => {
    const block = make([['formId', '1058'], ['disclaimer', 'See our <a href="/privacy">Privacy Statement</a>.']]);
    document.body.append(block);
    await decorate(block);
    await flush();
    const form = block.querySelector('form#mktoForm_1058');
    const disc = block.querySelector('.form-disclaimer');
    const btnRow = form.querySelector('.mktoButtonRow');
    expect(disc).not.toBeNull();
    expect(disc.querySelector('a')).not.toBeNull(); // link preserved
    // Without rendered field rows, disclaimer is placed before the form shell.
    // eslint-disable-next-line no-bitwise
    expect(disc.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(disc.compareDocumentPosition(btnRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    block.remove();
  });

  it('renders nothing when no form id is authored', async () => {
    const block = make([['header', 'Let’s connect']]);
    await decorate(block);
    expect(block.querySelector('form')).toBeNull();
    expect(block.children).toHaveLength(0);
  });

  it('adds the download variant when a downloadUrl is authored', async () => {
    const block = make([['formId', '1058'], ['downloadUrl', '/assets/report.pdf']]);
    await decorate(block);
    expect(block.classList.contains('download')).toBe(true);
  });

  it('embeds the Marketo form once the block scrolls into view', async () => {
    const block = make([['formId', '1058']]);
    await decorate(block);
    await flush();
    expect(window.MktoForms2.loadForm).toHaveBeenCalledWith(
      '//743-rzm-619.mktoweb.com',
      '743-RZM-619',
      '1058',
      expect.any(Function),
    );
    // Forms2 script generated from the (prod) Munchkin, not a site-config key
    expect(loadScript).toHaveBeenCalledWith('//743-rzm-619.mktoweb.com/js/forms2/js/forms2.min.js');
  });

  it('uses the e2e Munchkin when the page metadata opts into e2e', async () => {
    getMetadata.mockReturnValue('e2e');
    getSiteConfig.mockResolvedValue({
      'marketo.munchkin': '743-RZM-619',
      'marketo.munchkin.e2e': '929-LXU-908',
      'marketo.munchkin.dev': '964-TCT-456',
    });
    const block = make([['formId', '2001']]);
    await decorate(block);
    await flush();
    expect(window.MktoForms2.loadForm).toHaveBeenCalledWith(
      '//929-lxu-908.mktoweb.com',
      '929-LXU-908',
      '2001', // authored formId used as-is against the selected instance
      expect.any(Function),
    );
    expect(loadScript).toHaveBeenCalledWith('//929-lxu-908.mktoweb.com/js/forms2/js/forms2.min.js');
  });

  it('uses the dev Munchkin when the page metadata opts into dev', async () => {
    getMetadata.mockReturnValue('dev');
    getSiteConfig.mockResolvedValue({
      'marketo.munchkin': '743-RZM-619',
      'marketo.munchkin.dev': '964-TCT-456',
    });
    const block = make([['formId', '3001']]);
    await decorate(block);
    await flush();
    expect(window.MktoForms2.loadForm).toHaveBeenCalledWith(
      '//964-tct-456.mktoweb.com',
      '964-TCT-456',
      '3001',
      expect.any(Function),
    );
  });

  it('falls back to the base Munchkin when the opted-in per-env key is missing', async () => {
    getMetadata.mockReturnValue('e2e');
    getSiteConfig.mockResolvedValue({ 'marketo.munchkin': '743-RZM-619' });
    const block = make([['formId', '1058']]);
    await decorate(block);
    await flush();
    expect(window.MktoForms2.loadForm).toHaveBeenCalledWith(
      '//743-rzm-619.mktoweb.com',
      '743-RZM-619',
      '1058',
      expect.any(Function),
    );
  });

  it('hands off to ChiliPiper (prod args + xref) and fires the ECS lead track on success', async () => {
    const track = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { track } } } };
    const block = make([['formId', '1058'], ['chiliPiperRouter', 'mid-us-webform-managed-ies']]);
    await decorate(block);
    await flush();
    expect(onSuccessFn).toBeTypeOf('function');

    const result = onSuccessFn({ Email: 'controller@brightpathco.com', FirstName: 'Dana', Company: 'Bright Path' });
    expect(result).toBe(false); // suppress Marketo's default redirect
    await flush();

    expect(window.ChiliPiper.submit).toHaveBeenCalledWith(
      'intuitsales',
      'mid-us-webform-managed-ies',
      expect.objectContaining({
        map: false,
        disableRelation: true,
        event: expect.objectContaining({ Lead_XRef_ID__c: expect.any(String) }),
      }),
    );
    // The same minted xref feeds the ECS lead track → IES_lead.
    const xref = window.ChiliPiper.submit.mock.calls[0][2].event.Lead_XRef_ID__c;
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      object: 'lead',
      action: 'create_submitted',
      custom_properties: expect.objectContaining({
        form_id: '1058',
        lead_xref_id: xref,
      }),
    }));
    // Uncomment with the AEP/WebSDK integration in scripts/scripts.js and blocks/form/form.js.
    // expect(sendEvent).toHaveBeenCalledTimes(1);
    // expect(sendEvent.mock.calls[0][0].xdm.identityMap.Email[0].id)
    //   .toBe('controller@brightpathco.com');
    delete window.intuit;
  });
});

describe('decorate — inside the shared "Schedule a call" modal', () => {
  it('recovers the authored config on a forced re-decoration instead of wiping the block', async () => {
    // blocks/modal/modal.js caches an already-decorated fragment (loadFragment() runs
    // loadSections() once), then clones it and resets block/section status to force a
    // second decorate() pass. By then the authored formId/header rows are gone —
    // replaced by the <form> shell this same decorate() call created the first time.
    const block = make([['formId', '1058'], ['header', 'Let’s connect']]);
    await decorate(block); // first pass, as loadFragment() runs internally
    await flush();
    expect(block.querySelector('form#mktoForm_1058')).not.toBeNull();

    const clone = block.cloneNode(true); // cloneNode keeps the dataset attribute the first pass stashed
    document.body.append(clone);
    await decorate(clone); // second pass, on markup that no longer has config rows
    await flush();

    expect(clone.querySelector('form#mktoForm_1058')).not.toBeNull();
    expect(clone.querySelector('.form-header').textContent).toBe('Let’s connect');
    clone.remove();
  });
});

describe('decorate — reCAPTCHA v3 gate', () => {
  const settle = async () => { for (let i = 0; i < 6; i += 1) await flush(); };

  async function decorateWithRecaptcha(rows, fetchImpl) {
    getSiteConfig.mockResolvedValue(RECAPTCHA_CFG);
    mockGrecaptcha('score-token');
    global.fetch = vi.fn(fetchImpl);
    await decorate(make([['formId', '1058'], ['recaptcha', 'true'], ...rows]));
    await settle();
  }

  const okScore = () => Promise.resolve({ json: () => Promise.resolve({ success: true, score: 0.9 }) });
  const lowScore = () => Promise.resolve({ json: () => Promise.resolve({ success: true, score: 0.1 }) });

  it('does not load reCAPTCHA when the form does not opt in', async () => {
    getSiteConfig.mockResolvedValue(RECAPTCHA_CFG);
    global.fetch = vi.fn(okScore);
    await decorate(make([['formId', '1058']])); // no recaptcha row
    await flush();
    expect(onValidateFn).toBeTypeOf('function');
    expect(window.grecaptcha).toBeUndefined();
  });

  it('does nothing when reCAPTCHA is globally disabled, even if the form opts in', async () => {
    getSiteConfig.mockResolvedValue({ ...RECAPTCHA_CFG, 'recaptcha.enabled': false });
    global.fetch = vi.fn(okScore);
    await decorate(make([['formId', '1058'], ['recaptcha', 'true']]));
    await flush();
    expect(onValidateFn).toBeNull();
  });

  it('verifies the token and marks the form submittable on a passing score', async () => {
    await decorateWithRecaptcha([], okScore);
    expect(window.grecaptcha.execute).toHaveBeenCalledWith('6LeQ-test', { action: '' });
    // token POSTed to the Intuit siteverify proxy with the API key + response body
    expect(global.fetch).toHaveBeenCalledWith(
      RECAPTCHA_CFG['recaptcha.verifyUrl'],
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: RECAPTCHA_CFG['recaptcha.apiKey'] }),
        body: 'response=score-token',
      }),
    );
    onValidateFn();
    expect(submittable).toHaveBeenLastCalledWith(true);
  });

  it('blocks submit on a failing score', async () => {
    await decorateWithRecaptcha([], lowScore);
    onValidateFn();
    expect(submittable).toHaveBeenLastCalledWith(false);
  });

  it('fails open (allows submit) when the verify endpoint is unreachable', async () => {
    await decorateWithRecaptcha([], () => Promise.reject(new Error('CORS')));
    onValidateFn();
    expect(submittable).toHaveBeenLastCalledWith(true);
  });
});
