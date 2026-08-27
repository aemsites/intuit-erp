import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../scripts/aem.js', () => ({ loadScript: vi.fn(() => Promise.resolve()) }));
vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({})),
}));

// eslint-disable-next-line import/first
import { openChiliPiper, submitChiliPiper, leadXrefId } from '../scripts/chilipiper.js';
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
  delete window.chilipiperLeadXrefId;
});

describe('leadXrefId', () => {
  it('generates and publishes a correlation id on window', () => {
    const id = leadXrefId();
    expect(id).toBeTruthy();
    expect(window.chilipiperLeadXrefId).toBe(id);
  });
});

describe('openChiliPiper', () => {
  it('loads the script and opens the scheduler for the router, setting a lead_xref_id', async () => {
    const ok = await openChiliPiper('cal-first-construction');
    expect(ok).toBe(true);
    expect(loadScript).toHaveBeenCalledWith('//js.chilipiper.com/marketing.js');
    expect(window.ChiliPiper.scheduling).toHaveBeenCalledWith(
      'intuitsales',
      'cal-first-construction',
      expect.objectContaining({ title: expect.any(String) }),
    );
    expect(window.chilipiperLeadXrefId).toBeTruthy();
  });

  it('no-ops (false) without a router or subdomain', async () => {
    expect(await openChiliPiper('')).toBe(false);
    getSiteConfig.mockResolvedValue({});
    expect(await openChiliPiper('r')).toBe(false);
  });
});

describe('submitChiliPiper', () => {
  it('submits a mapped lead to the router', async () => {
    const ok = await submitChiliPiper('mid-us', { Email: 'a@b.com' });
    expect(ok).toBe(true);
    expect(window.ChiliPiper.submit).toHaveBeenCalledWith(
      'intuitsales',
      'mid-us',
      { map: true, lead: { Email: 'a@b.com' } },
    );
  });
});
