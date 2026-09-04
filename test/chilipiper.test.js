import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../scripts/aem.js', () => ({ loadScript: vi.fn(() => Promise.resolve()) }));
vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../scripts/experience.js', () => ({
  experienceLog: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  openChiliPiper, submitChiliPiper,
} from '../scripts/chilipiper.js';
// eslint-disable-next-line import/first
import { getSiteConfig } from '../scripts/scripts.js';
// eslint-disable-next-line import/first
import { loadScript } from '../scripts/aem.js';
// eslint-disable-next-line import/first
import { experienceLog } from '../scripts/experience.js';

const CFG = {
  'chilipiper.subdomain': 'intuitsales',
  'chilipiper.src': '//js.chilipiper.com/marketing.js',
};

const LEAD = {
  Lead_XRef_ID__c: 'XREF-1',
  FirstName: 'Dana',
  LastName: 'Lee',
  Email: 'a@b.com',
  Phone: '555-0100',
  Country: 'US',
  NumberOfEmployees: '50',
  Language__c: 'English',
  formId: '1058',
  IVID__c: 'ivid-123',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSiteConfig.mockResolvedValue(CFG);
  window.ChiliPiper = { scheduling: vi.fn(), submit: vi.fn() };
});

describe('openChiliPiper', () => {
  it('loads the script and opens the scheduler for the router', async () => {
    const ok = await openChiliPiper('cal-first-construction');
    expect(ok).toBe(true);
    expect(loadScript).toHaveBeenCalledWith('//js.chilipiper.com/marketing.js');
    expect(window.ChiliPiper.scheduling).toHaveBeenCalledWith(
      'intuitsales',
      'cal-first-construction',
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it('no-ops (false) without a router or subdomain', async () => {
    expect(await openChiliPiper('')).toBe(false);
    getSiteConfig.mockResolvedValue({});
    expect(await openChiliPiper('r')).toBe(false);
  });
});

describe('submitChiliPiper', () => {
  it('submits with prod args: map:false, disableRelation, and the xref event', async () => {
    const ok = await submitChiliPiper('mid-us', LEAD);
    expect(ok).toBe(true);
    expect(window.ChiliPiper.submit).toHaveBeenCalledWith('intuitsales', 'mid-us', {
      map: false,
      lead: {
        Lead_XRef_ID__c: 'XREF-1',
        FirstName: 'Dana',
        LastName: 'Lee',
        Email: 'a@b.com',
        Phone: '555-0100',
        Country: 'US',
        Number_of_Employees__c: '50',
        Language: 'English',
      },
      disableRelation: true,
      event: { Lead_XRef_ID__c: 'XREF-1' },
    });
  });

  it('no-ops (false) without a router or subdomain', async () => {
    expect(await submitChiliPiper('', LEAD)).toBe(false);
    getSiteConfig.mockResolvedValue({});
    expect(await submitChiliPiper('mid-us', LEAD)).toBe(false);
  });

  it('returns false when submit throws and logs the failure', async () => {
    window.ChiliPiper.submit.mockImplementation(() => {
      throw new Error('ChiliPiper submit failed');
    });
    const ok = await submitChiliPiper('mid-us', LEAD);
    expect(ok).toBe(false);
    expect(experienceLog).toHaveBeenCalledWith(
      'error',
      'MARKETOFORM_CHILIPIPER_API_CALL_FAILED,formId:1058,leadXRefID:XREF-1,ivid:ivid-123',
    );
  });
});
