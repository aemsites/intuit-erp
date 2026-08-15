import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../plugins/martech/src/index.js';
import decorate, { parseFormConfig } from '../blocks/form/form.js';

vi.mock('../plugins/martech/src/index.js', () => ({
  sendEvent: vi.fn(() => Promise.resolve()),
}));
vi.mock('../scripts/aem.js', () => ({
  loadScript: vi.fn(() => Promise.resolve()),
}));
vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({
    'marketo.munchkin': '743-RZM-619',
    'chilipiper.subdomain': 'intuitsales',
  })),
}));

const flush = () => new Promise((r) => { setTimeout(r, 0); });

let onSuccessFn;
beforeEach(() => {
  onSuccessFn = null;
  sendEvent.mockClear();
  delete window.utag;
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }

    observe() { this.cb([{ isIntersecting: true }]); }

    disconnect() {}
  };
  window.MktoForms2 = {
    loadForm: vi.fn((host, munchkin, formId, cb) => {
      cb({
        onSuccess: (fn) => { onSuccessFn = fn; },
        getValues: () => ({ Email: 'controller@brightpathco.com', FirstName: 'Dana', Company: 'Bright Path' }),
      });
    }),
  };
  window.ChiliPiper = { submit: vi.fn(), scheduling: vi.fn() };
});

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
});

describe('decorate — live Marketo form', () => {
  it('renders a Marketo form element with the authored form id', async () => {
    const block = make([['formId', '1058'], ['header', 'Let’s connect'], ['disclaimer', 'Privacy.']]);
    await decorate(block);
    expect(block.querySelector('form#mktoForm_1058')).not.toBeNull();
    expect(block.querySelector('.form-header').textContent).toBe('Let’s connect');
    expect(block.querySelector('.form-disclaimer').textContent).toBe('Privacy.');
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
  });

  it('hands off to ChiliPiper and tracks on Marketo success', async () => {
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
      expect.objectContaining({ map: true }),
    );
    // analytics preserved: with no Tealium, the Adobe identity event fires with mapped values
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent.mock.calls[0][0].xdm.identityMap.Email[0].id).toBe('controller@brightpathco.com');
  });
});
