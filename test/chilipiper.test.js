import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/aem.js', () => ({ loadScript: vi.fn(() => Promise.resolve()) }));
vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({})),
}));

// eslint-disable-next-line import/first
import {
  openChiliPiper, submitChiliPiper, mintLeadXref, trackLeadCreated,
} from '../scripts/chilipiper.js';
// eslint-disable-next-line import/first
import { getSiteConfig } from '../scripts/scripts.js';
// eslint-disable-next-line import/first
import { loadScript } from '../scripts/aem.js';

const CFG = {
  'chilipiper.subdomain': 'intuitsales',
  'chilipiper.src': '//js.chilipiper.com/marketing.js',
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
    const ok = await submitChiliPiper('mid-us', { Email: 'a@b.com' }, 'XREF-1');
    expect(ok).toBe(true);
    expect(window.ChiliPiper.submit).toHaveBeenCalledWith('intuitsales', 'mid-us', {
      map: false,
      lead: { Email: 'a@b.com' },
      disableRelation: true,
      event: { Lead_XRef_ID__c: 'XREF-1' },
    });
  });
  it('mints an xref when one is not passed', async () => {
    await submitChiliPiper('mid-us', { Email: 'a@b.com' });
    const { event } = window.ChiliPiper.submit.mock.calls[0][2];
    expect(event.Lead_XRef_ID__c).toBeTruthy();
  });
});

describe('mintLeadXref', () => {
  it('returns a fresh id each call', () => {
    const a = mintLeadXref();
    expect(a).toBeTruthy();
    expect(a).not.toBe(mintLeadXref());
  });
});

describe('trackLeadCreated', () => {
  afterEach(() => { delete window.intuit; });
  it('no-ops (false) off-intuit where the ECS stack is not injected', () => {
    expect(trackLeadCreated({ leadXrefId: 'x', formId: '1' })).toBe(false);
  });
  it('fires wa.track with the container gating fields when ECS is present', () => {
    const track = vi.fn();
    window.intuit = { tracking: { ecs: { webAnalytics: { track } } } };
    expect(trackLeadCreated({ leadXrefId: 'x1', formId: '1058' })).toBe(true);
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      object: 'lead',
      action: 'create_submitted',
      lead_xref_id: 'x1',
      product_family_of_interest: 'Intuit Enterprise Suite',
      form_id: '1058',
    }));
  });
});
