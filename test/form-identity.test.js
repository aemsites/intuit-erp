import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { trackFormSubmit } from '../blocks/form/form.js';

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js and blocks/form/form.js.
// // eslint-disable-next-line import/no-relative-packages
// import { sendEvent } from '../plugins/martech/src/index.js';
// import { buildIdentityXdm, LEAD_XDM_TARGET } from '../blocks/form/form.js';
// vi.mock('../plugins/martech/src/index.js', () => ({
//   sendEvent: vi.fn(() => Promise.resolve()),
// }));

// describe('buildIdentityXdm', () => {
//   it('puts the email in identityMap as ambiguous and carries lead fields', () => {
//     const xdm = buildIdentityXdm({
//       firstName: 'Dana',
//       lastName: 'Cole',
//       businessName: 'Bright Path',
//       email: 'controller@brightpathco.com',
//       phone: '555-1234',
//     });
//     const id = xdm.identityMap.Email[0];
//     expect(id.id).toBe('controller@brightpathco.com');
//     expect(id.primary).toBe(true);
//     expect(id.authenticatedState).toBe('ambiguous');
//     const { lead } = xdm[LEAD_XDM_TARGET.prefix][LEAD_XDM_TARGET.object];
//     expect(lead.businessName).toBe('Bright Path');
//     expect(lead.email).toBe('controller@brightpathco.com');
//   });
// });

describe('trackFormSubmit (Tealium)', () => {
  const fields = {
    firstName: 'Dana',
    lastName: 'Cole',
    businessName: 'Bright Path',
    email: 'controller@brightpathco.com',
    phone: '555-1234',
  };

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
  });

  it('withholds the Tealium form_submit link while consent is unresolved (getConsentState()===0)', () => {
    window.utag = { link: vi.fn(), gdpr: { getConsentState: () => 0 } };
    window.utag_data = { ivid: 'visitor-123' };

    trackFormSubmit(fields);

    // Firing while consent is 0 would enqueue the link and risk the ies-erp processQueue recursion.
    expect(window.utag.link).not.toHaveBeenCalled();
  });

  // Uncomment with the AEP/WebSDK integration in scripts/scripts.js and blocks/form/form.js.
  // it('falls back to the Adobe sendEvent identity call when window.utag is absent', () => {
  //   trackFormSubmit(fields);
  //
  //   expect(sendEvent).toHaveBeenCalledTimes(1);
  //   expect(sendEvent).toHaveBeenCalledWith({ xdm: buildIdentityXdm(fields) });
  // });
});
