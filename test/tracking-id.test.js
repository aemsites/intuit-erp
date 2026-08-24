import { describe, it, expect } from 'vitest';
import {
  normalizeHref, hostLabel, hrefSlug, hrefTrackId, sheetRowById, trackIdOf, indexRows, trackAs,
} from '../scripts/tracking.js';

describe('normalizeHref', () => {
  it('strips a trailing slash so /foo/ and /foo share one id', () => {
    expect(normalizeHref('https://www.intuit.com/foo/')).toBe('https://www.intuit.com/foo');
    expect(normalizeHref('https://www.intuit.com/foo')).toBe('https://www.intuit.com/foo');
  });

  it('collapses the root path with and without a slash (logo vs US-country collision)', () => {
    expect(normalizeHref('https://www.intuit.com/')).toBe('https://www.intuit.com');
    expect(normalizeHref('https://www.intuit.com')).toBe('https://www.intuit.com');
  });

  it('strips query + hash (campaign params are not identity)', () => {
    expect(normalizeHref('https://mailchimp.com/?utm_source=intuit.com&utm_medium=referral')).toBe('https://mailchimp.com');
    expect(normalizeHref('https://x.com/p?a=1#frag')).toBe('https://x.com/p');
  });

  it('returns "" for non-navigational hrefs (not id-worthy)', () => {
    ['', '   ', '#', '#section', 'javascript:void(0)', 'mailto:a@b.com', 'tel:+1'].forEach((h) => {
      expect(normalizeHref(h)).toBe('');
    });
  });
});

describe('hostLabel', () => {
  it('reduces a host to its distinctive label', () => {
    expect(hostLabel('https://turbotax.intuit.com/')).toBe('turbotax');
    expect(hostLabel('https://www.intuit.com/')).toBe('intuit');
    expect(hostLabel('https://intuit.com')).toBe('intuit');
    expect(hostLabel('https://mailchimp.com/?x=1')).toBe('mailchimp');
    expect(hostLabel('https://privacy.trustarc.com/seal')).toBe('trustarc');
  });
});

describe('hrefSlug (readable id core)', () => {
  it('reduces an own-site link to its path', () => {
    expect(hrefSlug('https://www.intuit.com/company')).toBe('company');
    expect(hrefSlug('https://www.intuit.com/company/corporate-responsibility')).toBe('company-corporate-responsibility');
  });

  it('keeps a leading host label for an external link', () => {
    expect(hrefSlug('https://turbotax.intuit.com/')).toBe('turbotax');
    expect(hrefSlug('https://quickbooks.intuit.com/payroll')).toBe('quickbooks-payroll');
  });

  it('is "" for a non-navigational href', () => {
    expect(hrefSlug('#')).toBe('');
    expect(hrefSlug('javascript:void(0)')).toBe('');
  });
});

describe('sheetRowById', () => {
  it('prefers a page-scoped row over the site-wide one', () => {
    const map = new Map([['/p|x', { object: 'scoped' }], ['x', { object: 'wide' }]]);
    expect(sheetRowById(map, 'x', '/p')).toEqual({ object: 'scoped' });
    expect(sheetRowById(map, 'x', '/other')).toEqual({ object: 'wide' });
  });

  it('is null on a missing id or map', () => {
    expect(sheetRowById(new Map(), 'x', '/')).toBe(null);
    expect(sheetRowById(null, 'x', '/')).toBe(null);
    expect(sheetRowById(new Map([['x', {}]]), '', '/')).toBe(null);
  });

  it('indexRows keys a row by its `id` column (id-based) as well as legacy `key`', () => {
    const map = indexRows([
      { path: '*', id: 'footer:brand-intuit', 'wa-link': 'ftr-corporate-icom' },
      { path: '*', key: 'nav-1', object: 'legacy' },
    ]);
    expect(sheetRowById(map, 'footer:brand-intuit', '/')).toEqual({ 'wa-link': 'ftr-corporate-icom' });
    expect(map.has('nav-1')).toBe(true); // legacy positional key still indexed
  });
});

describe('trackIdOf', () => {
  it('returns the explicit data-track-id, else null (no href fallback in the resolver)', () => {
    const a = document.createElement('a');
    a.setAttribute('href', 'https://x.com/y');
    expect(trackIdOf(a)).toBe(null); // href alone is NOT read at resolution
    a.setAttribute('data-track-id', 'footer:manage-cookies');
    expect(trackIdOf(a)).toBe('footer:manage-cookies');
  });
});

describe('trackAs — trackId deriver', () => {
  const build = () => {
    const block = document.createElement('div');
    block.innerHTML = '<button class="toggle">x</button>'
      + '<a class="chrome" href="https://www.intuit.com/">Home</a>'
      + '<a class="authored" href="https://quickbooks.intuit.com/payroll/">Payroll</a>'
      + '<a class="preset" data-track-id="explicit:id" href="https://z.com/">Z</a>'
      + '<a class="hashless" href="#">Manage</a>';
    return block;
  };

  it('runs the block trackId on each non-skipped CTA; falsy leaves it un-keyed; authored id wins', () => {
    const block = build();
    trackAs('demo', block, {
      skip: '.toggle',
      trackId: (el) => {
        if (el.matches('.hashless')) return 'demo:manage'; // href-less special case
        if (el.matches('.chrome')) return null; // opt out -> pure-derive
        return hrefTrackId(el, 'demo'); // default cleanup for the rest
      },
    });
    expect(block.querySelector('.toggle').hasAttribute('data-track-id')).toBe(false); // skipped
    expect(block.querySelector('.chrome').hasAttribute('data-track-id')).toBe(false); // falsy -> un-keyed
    expect(trackIdOf(block.querySelector('.authored'))).toBe('demo:quickbooks-payroll'); // href cleanup
    expect(trackIdOf(block.querySelector('.preset'))).toBe('explicit:id'); // authored id preserved
    expect(trackIdOf(block.querySelector('.hashless'))).toBe('demo:manage'); // href-less -> special
  });

  it('defaults to <key>:<clean-href> when no trackId is passed', () => {
    const block = document.createElement('div');
    block.innerHTML = '<a href="https://www.intuit.com/company">About</a><a href="https://turbotax.intuit.com/">TT</a>';
    trackAs('footer', block, { key: 'footer' });
    const [a, b] = block.querySelectorAll('a');
    expect(trackIdOf(a)).toBe('footer:company'); // own host -> path
    expect(trackIdOf(b)).toBe('footer:turbotax'); // external -> host label
  });
});
