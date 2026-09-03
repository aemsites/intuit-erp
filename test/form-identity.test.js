import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { trackFormSubmit, getTraitData } from '../blocks/form/form.js';

describe('getTraitData', () => {
  it('maps Marketo field names to ECS identity traits', () => {
    const traits = getTraitData({
      FirstName: 'Dana',
      LastName: 'Cole',
      Email: 'controller@brightpathco.com',
      Phone: '555-1234',
      CountryCode: 'us',
    });

    expect(traits).toEqual(expect.objectContaining({
      first_name: 'Dana',
      last_name: 'Cole',
      email: 'controller@brightpathco.com',
      phone: '+1555-1234',
      lead_country: 'us',
      type: 'identity',
    }));
  });

  it('splits Full_Name__c when FirstName/LastName are absent', () => {
    const traits = getTraitData({ Full_Name__c: 'Dana Cole', Email: 'a@b.com' });
    expect(traits.first_name).toBe('Dana');
    expect(traits.last_name).toBe('Cole');
  });
});

describe('trackFormSubmit (ECS webAnalytics)', () => {
  const formVals = {
    Email: 'controller@brightpathco.com',
    FirstName: 'Dana',
    LastName: 'Cole',
    Phone: '555-1234',
    CountryCode: 'us',
    Lead_XRef_ID__c: 'xref-123',
    Product_Family_of_Interest__c: 'Intuit Enterprise Suite',
  };

  afterEach(() => {
    delete window.intuit;
  });

  it('fires ECS track and identify when webAnalytics is present', () => {
    const track = vi.fn();
    const identify = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { track, identify } } } };

    trackFormSubmit(formVals, '1058');

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      object: 'lead',
      action: 'create_submitted',
      type: 'track',
      custom_properties: expect.objectContaining({
        form_id: '1058',
        lead_xref_id: 'xref-123',
        product_family_of_interest: 'Intuit Enterprise Suite',
      }),
    }));
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith(expect.objectContaining({
      email: 'controller@brightpathco.com',
      first_name: 'Dana',
      type: 'identity',
    }));
  });

  it('no-ops when ECS webAnalytics is absent', () => {
    expect(() => trackFormSubmit(formVals, '1058')).not.toThrow();
  });
});
