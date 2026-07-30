import { describe, it, expect } from 'vitest';
import { isValidBusinessEmail, buildIdentityXdm } from '../blocks/form/form.js';
import { OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';

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
      firstName: 'Dana', lastName: 'Cole', businessName: 'Bright Path',
      email: 'controller@brightpathco.com', phone: '555-1234',
    });
    const id = xdm.identityMap.Email[0];
    expect(id.id).toBe('controller@brightpathco.com');
    expect(id.primary).toBe(true);
    expect(id.authenticatedState).toBe('ambiguous');
    const lead = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object].lead;
    expect(lead.businessName).toBe('Bright Path');
    expect(lead.email).toBe('controller@brightpathco.com');
  });
});
