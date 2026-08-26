import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import decorate from '../blocks/footer/footer.js';
import {
  initTracking, stampInteraction, resetTrackingState, ctasIn, trackIdOf,
} from '../scripts/tracking.js';

// A representative authored /footer fragment (Footer Columns + Footer Legal).
// It deliberately includes links whose host matches footer chrome — a "QuickBooks"
// column link to quickbooks.intuit.com/ (same host as the brand logo) and a
// "Mailchimp" column link to mailchimp.com — to prove the block's `trackId`
// derivation (brand- prefix) keeps them distinct from the brand logos.
const FRAGMENT = `
  <div class="footer-columns">
    <div><div>The company</div><div><ul>
      <li><a href="https://www.intuit.com/company">About Intuit</a></li>
      <li><a href="https://investors.intuit.com">Investor relations</a></li>
    </ul></div></div>
    <div><div>Products</div><div><ul>
      <li><a href="https://quickbooks.intuit.com/">QuickBooks</a></li>
      <li><a href="https://mailchimp.com/?utm_source=intuit.com">Mailchimp</a></li>
    </ul></div></div>
  </div>
  <div class="footer-legal">
    <div><ul><li><a href="https://www.intuit.com/careers">Careers</a></li></ul></div>
    <div><p>&copy; Intuit Inc.</p><p>All rights reserved.</p></div>
    <div><p><a href="https://www.intuit.com/legal/">Legal</a> | <a href="https://www.intuit.com/privacy/">Privacy</a></p></div>
  </div>`;

// A small id-keyed sheet (the shape gen-sheet-from-golden now emits): chrome by
// semantic id, authored links by the readable href slug. No positional `<key>-<n>`.
const SHEET = [
  { path: '*', id: 'footer:country-us', 'wa-link': 'ftr-corporate-country-enus', 'ui-object-detail': 'usa' },
  { path: '*', id: 'footer:brand-intuit', 'wa-link': 'ftr-corporate-icom', 'ui-object-detail': 'intuit' },
  { path: '*', id: 'footer:brand-quickbooks', 'wa-link': 'ftr-corporate-qb', 'ui-object-detail': 'quickbooks' },
  { path: '*', id: 'footer:manage-cookies', 'wa-link': 'ftr-corporate-managecookies', 'ui-object-detail': 'Manage cookies' },
  { path: '*', id: 'footer:company', 'wa-link': 'ftr-global-legal-About' },
  { path: '*', id: 'footer:quickbooks', 'wa-link': 'ftr-global-QuickBooks' },
];

// fetch is hit twice by the footer flow: the fragment (.text()) and, once
// initTracking runs, the sheet (.json()). Branch on the URL.
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('tracking.json')
    ? Promise.resolve({ ok: true, json: () => Promise.resolve({ data: SHEET }) })
    : Promise.resolve({ ok: true, text: () => Promise.resolve(FRAGMENT) }))));
}

async function buildFooter() {
  const footerEl = document.createElement('footer');
  const block = document.createElement('div');
  block.className = 'footer block';
  block.dataset.blockName = 'footer';
  footerEl.append(block);
  document.body.append(footerEl);
  await decorate(block);
  return block;
}

const idOf = (el) => el.getAttribute('data-track-id');

describe('footer click-tracking — id-based keying', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetTrackingState();
    // Resolve the CA-privacy geo poll immediately (non-CA) so no timer dangles.
    window.OneTrust = { getGeolocationData: () => ({ country: 'US', state: 'TX' }) };
    stubFetch();
  });
  afterEach(() => { vi.unstubAllGlobals(); delete window.OneTrust; });

  it('stamps a data-track-id on every tracked CTA and none on skipped toggles', async () => {
    const block = await buildFooter();
    const all = ctasIn(block);
    const skipped = all.filter((el) => el.closest('[data-track-skip]'));
    const tracked = all.filter((el) => !el.closest('[data-track-skip]'));
    // the accordion col-toggles + the two country-toggles are skipped (and un-id'd)
    expect(skipped.length).toBeGreaterThanOrEqual(3);
    expect(skipped.every((el) => !trackIdOf(el))).toBe(true);
    // every tracked CTA carries an explicit id
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every((el) => !!trackIdOf(el))).toBe(true);
  });

  it('dedupes the mobile + desktop country menus to one id per destination', async () => {
    const block = await buildFooter();
    const us = [...block.querySelectorAll('.country a[href="https://www.intuit.com/"]')];
    expect(us.length).toBe(2); // mobile + desktop copies
    expect(us.every((a) => idOf(a) === 'footer:country-us')).toBe(true);
    const ca = [...block.querySelectorAll('.country a[href="https://www.intuit.com/ca/"]')];
    expect(ca.length).toBe(2);
    expect(ca.every((a) => idOf(a) === 'footer:country-ca')).toBe(true);
  });

  it('disambiguates same-host CTAs via semantic ids (Intuit logo vs US country; brand vs column)', async () => {
    const block = await buildFooter();
    // logo and US country share href intuit.com/ but get distinct ids
    expect(idOf(block.querySelector('.ftr-logo'))).toBe('footer:brand-intuit');
    expect(idOf(block.querySelector('.country a[href="https://www.intuit.com/"]'))).toBe('footer:country-us');
    // brand QuickBooks logo vs the authored "QuickBooks" column link (same host)
    expect(idOf(block.querySelector('.brand-logos a[aria-label="QuickBooks"]'))).toBe('footer:brand-quickbooks');
    const qbColumn = [...block.querySelectorAll('.footer-col a')].find((a) => a.textContent.trim() === 'QuickBooks');
    expect(idOf(qbColumn)).toBe('footer:quickbooks');
  });

  it('derives readable slugs for authored links; the href-less control gets a semantic id', async () => {
    const block = await buildFooter();
    const about = [...block.querySelectorAll('.footer-col a')].find((a) => a.textContent.includes('About Intuit'));
    expect(idOf(about)).toBe('footer:company');
    // "Manage cookies" is href="#" — the block's trackId returns a semantic id
    expect(idOf(block.querySelector('.footer-copy-btn'))).toBe('footer:manage-cookies');
  });

  describe('runtime resolution (order-independent — the whole point)', () => {
    let block;
    beforeEach(async () => {
      block = await buildFooter();
      initTracking(document);
      await new Promise((r) => { setTimeout(r, 0); }); // let the sheet settle -> sheetMap
    });

    const wa = (el) => { stampInteraction({ target: el }); return el.getAttribute('data-wa-link'); };

    it('resolves the US country link to its OWN residue, not a brand-logo row', () => {
      const us = block.querySelector('.country-mobile a[href="https://www.intuit.com/"]');
      expect(wa(us)).toBe('ftr-corporate-country-enus');
      expect(us.getAttribute('data-ui-object-detail')).toBe('usa');
    });

    it('resolves the Intuit logo (same href as US country) to the brand row', () => {
      const logo = block.querySelector('.ftr-logo');
      expect(wa(logo)).toBe('ftr-corporate-icom');
      expect(logo.getAttribute('data-ui-object-detail')).toBe('intuit');
    });

    it('resolves the desktop country copy identically to the mobile one (dedup)', () => {
      const desktop = block.querySelector('.footer-sitemap .country a[href="https://www.intuit.com/"]');
      expect(wa(desktop)).toBe('ftr-corporate-country-enus');
    });

    it('resolves authored column links by their href-slug id', () => {
      const about = [...block.querySelectorAll('.footer-col a')].find((a) => a.textContent.includes('About Intuit'));
      expect(wa(about)).toBe('ftr-global-legal-About');
      const qbColumn = [...block.querySelectorAll('.footer-col a')].find((a) => a.textContent.trim() === 'QuickBooks');
      expect(wa(qbColumn)).toBe('ftr-global-QuickBooks');
    });

    it('resolves the href-less "Manage cookies" control by its semantic id', () => {
      expect(wa(block.querySelector('.footer-copy-btn'))).toBe('ftr-corporate-managecookies');
    });
  });
});

// Clicking "Manage cookies" must undo OneTrust's focus-into-modal scroll-to-top without
// touching any scrolling the reader does themselves. jsdom stubs `window.scrollTo` as a
// no-op, so scroll position is mocked here to observe what the handler actually calls it
// with.
function mockScrollPosition(x, y) {
  const pos = { x, y };
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => pos.x });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pos.y });
  const scrollTo = vi.fn((newX, newY) => { pos.x = newX; pos.y = newY; });
  window.scrollTo = scrollTo;
  return { setPos: (newX, newY) => { pos.x = newX; pos.y = newY; }, scrollTo };
}

// pinScroll rechecks across a couple of animation frames after the focusin it reacts to;
// let those settle before a test ends, or they fire later against a torn-down mock.
function flushFrames(n = 3) {
  return new Promise((resolve) => {
    let count = 0;
    const step = () => { count += 1; if (count >= n) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

describe('footer cookie preferences — scroll pinning', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetTrackingState();
    window.OneTrust = { getGeolocationData: () => ({ country: 'US', state: 'TX' }) };
    window.scrollTo = vi.fn();
    stubFetch();
  });
  afterEach(() => { vi.unstubAllGlobals(); delete window.OneTrust; delete window.scrollTo; });

  it('restores scroll when OneTrust moves focus into the preference centre', async () => {
    const block = await buildFooter();
    const { setPos, scrollTo } = mockScrollPosition(0, 3000);

    const consent = document.createElement('div');
    consent.id = 'onetrust-consent-sdk';
    const closeBtn = document.createElement('button');
    consent.append(closeBtn);
    document.body.append(consent);

    block.querySelector('.footer-copy-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // OneTrust's own scroll-into-view jumping the page as focus lands in the modal.
    setPos(0, 0);
    closeBtn.focus();

    expect(scrollTo).toHaveBeenCalledWith(0, 3000);
    await flushFrames(); // let the deferred rechecks settle before teardown
  });

  it('does not fight a reader scroll that has nothing to do with OneTrust', async () => {
    const block = await buildFooter();
    const { setPos, scrollTo } = mockScrollPosition(0, 3000);

    block.querySelector('.footer-copy-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // The reader scrolls on their own; nothing ever focuses inside OneTrust's widget.
    setPos(0, 500);
    window.dispatchEvent(new window.Event('scroll'));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(500);
  });

  it('ignores focus moving to unrelated page controls', async () => {
    const block = await buildFooter();
    const { setPos, scrollTo } = mockScrollPosition(0, 3000);

    block.querySelector('.footer-copy-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    setPos(0, 0);
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
