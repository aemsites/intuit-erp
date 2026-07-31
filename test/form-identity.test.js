import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../plugins/martech/src/index.js';
import decorate, { isValidBusinessEmail, buildIdentityXdm } from '../blocks/form/form.js';

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

// Populates the 5 rendered inputs on a decorated form block, in the order
// they're declared in blocks/form/form.js's FIELDS list.
function fillForm(block, {
  firstName = 'Dana', lastName = 'Cole', businessName = 'Bright Path',
  email = 'controller@brightpathco.com', phone = '555-1234',
} = {}) {
  const inputs = block.querySelectorAll('input');
  const values = [firstName, lastName, businessName, email, phone];
  inputs.forEach((input, i) => {
    input.value = values[i];
  });
}

describe('form submit wiring', () => {
  beforeEach(() => {
    sendEvent.mockClear();
  });

  it('sends the identity event wrapped under `xdm` so the ECID stitch transmits', async () => {
    const block = document.createElement('div');
    decorate(block);
    fillForm(block, { email: 'controller@brightpathco.com' });

    block.querySelector('.form-submit').click();
    // Let the fire-and-forget promise chain (sendEvent(...).catch(...)) settle.
    await Promise.resolve();

    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [arg] = sendEvent.mock.calls[0];
    expect(arg.xdm).toBeDefined();
    expect(arg.xdm.identityMap.Email[0].id).toBe('controller@brightpathco.com');
    expect(arg.xdm.identityMap.Email[0].authenticatedState).toBe('ambiguous');
  });

  it('does not send an event and shows a validation message for an invalid email', async () => {
    const block = document.createElement('div');
    decorate(block);
    fillForm(block, { email: 'not-an-email' });

    block.querySelector('.form-submit').click();
    await Promise.resolve();

    expect(sendEvent).not.toHaveBeenCalled();
    expect(block.querySelector('.form-note').textContent).toBe('Please enter a valid business email.');
  });
});
