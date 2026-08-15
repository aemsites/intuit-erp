import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../plugins/martech/src/index.js';
import {
  isValidBusinessEmail, buildIdentityXdm, trackFormSubmit,
} from '../blocks/form/form.js';

vi.mock('../plugins/martech/src/index.js', () => ({
  sendEvent: vi.fn(() => Promise.resolve()),
}));

describe('isValidBusinessEmail', () => {
  it('accepts a normal business email', () => {
    expect(isValidBusinessEmail('controller@brightpathco.com')).toBe(true);
  });
  it('rejects empty / malformed', () => {
    expect(isValidBusinessEmail('')).toBe(false);
    expect(isValidBusinessEmail('not-an-email')).toBe(false);
    expect(isValidBusinessEmail('a@b')).toBe(false);
  });
});

describe('buildIdentityXdm', () => {
  it('puts the email in identityMap as ambiguous and carries lead fields', () => {
    const xdm = buildIdentityXdm({
      firstName: 'Dana',
      lastName: 'Cole',
      businessName: 'Bright Path',
      email: 'controller@brightpathco.com',
      phone: '555-1234',
    });
    const id = xdm.identityMap.Email[0];
    expect(id.id).toBe('controller@brightpathco.com');
    expect(id.primary).toBe(true);
    expect(id.authenticatedState).toBe('ambiguous');
    const { lead } = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(lead.businessName).toBe('Bright Path');
    expect(lead.email).toBe('controller@brightpathco.com');
  });
});

// trackFormSubmit is the provider-aware helper the submit handler delegates to: Tealium
// (window.utag.link) when scripts/scripts.js selected that provider and it's enabled, otherwise
// the Adobe sendEvent path exercised by the "form submit wiring" tests above.
describe('trackFormSubmit (provider-aware)', () => {
  const fields = {
    firstName: 'Dana',
    lastName: 'Cole',
    businessName: 'Bright Path',
    email: 'controller@brightpathco.com',
    phone: '555-1234',
  };

  beforeEach(() => {
    sendEvent.mockClear();
  });

  afterEach(() => {
    delete window.utag;
    delete window.utag_data;
  });

  it('fires a Tealium form_submit link event (with ivid) when window.utag.link is present', () => {
    window.utag = { link: vi.fn() };
    window.utag_data = { ivid: 'visitor-123' };

    trackFormSubmit(fields);

    expect(window.utag.link).toHaveBeenCalledTimes(1);
    expect(window.utag.link).toHaveBeenCalledWith({
      tealium_event: 'form_submit',
      ...fields,
      ivid: 'visitor-123',
    });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('withholds the Tealium form_submit link while consent is unresolved (getConsentState()===0)', () => {
    window.utag = { link: vi.fn(), gdpr: { getConsentState: () => 0 } };
    window.utag_data = { ivid: 'visitor-123' };

    trackFormSubmit(fields);

    // Firing while consent is 0 would enqueue the link and risk the ies-erp processQueue recursion.
    expect(window.utag.link).not.toHaveBeenCalled();
    // On the Tealium provider we drop rather than fall back to the Adobe path.
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('falls back to the Adobe sendEvent identity call when window.utag is absent', () => {
    trackFormSubmit(fields);

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith({ xdm: buildIdentityXdm(fields) });
  });
});
