import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  trackingKey, blockNameOf, rowForIndex, decorateTracking, applyTrackingSheet,
} from '../scripts/tracking.js';

describe('trackingKey', () => {
  it('extracts the key from a tracking-<key> class', () => {
    const d = document.createElement('div');
    d.className = 'cta block tracking-demo';
    expect(trackingKey(d)).toBe('demo');
  });
  it('is null without the prefix', () => {
    const d = document.createElement('div');
    d.className = 'cta block';
    expect(trackingKey(d)).toBe(null);
  });
});

describe('blockNameOf', () => {
  it('prefers dataset.blockName', () => {
    const d = document.createElement('div');
    d.className = 'foo block tracking-x';
    d.dataset.blockName = 'cta';
    expect(blockNameOf(d)).toBe('cta');
  });
  it('falls back to the first non-structural class', () => {
    const d = document.createElement('div');
    d.className = 'cta block tracking-x';
    expect(blockNameOf(d)).toBe('cta');
  });
});

describe('rowForIndex', () => {
  it('matches an explicit 1-based cta index', () => {
    const rows = [{ cta: 1, object: 'a' }, { cta: 2, object: 'b' }];
    expect(rowForIndex(rows, 1).object).toBe('b');
  });
  it('falls the first CTA back to the row without a cta', () => {
    const rows = [{ object: 'solo' }];
    expect(rowForIndex(rows, 0).object).toBe('solo');
    expect(rowForIndex(rows, 1)).toBe(null);
  });
});

describe('decorateTracking (sync derived pass)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

  it('stamps derived identity + anchor on the CTA and the block access-point', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<p class="button-wrapper"><a class="button" href="#">Schedule a call</a></p></div></main>';
    const main = document.querySelector('main');
    decorateTracking(main);
    const a = main.querySelector('a');
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object')).toBe('button');
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call');
    expect(a.getAttribute('data-tracking')).toBe('button'); // sacrificial anchor
    expect(a.getAttribute('data-ui-access-point')).toBe(''); // opt-in presence
    expect(main.querySelector('.cta').getAttribute('data-tracking')).toBe('cta_block');
  });

  it('ignores CTAs outside an opted-in block', () => {
    document.body.innerHTML = '<main><div class="cta block"><p><a class="button" href="#">X</a></p></div></main>';
    const main = document.querySelector('main');
    decorateTracking(main);
    expect(main.querySelector('a').hasAttribute('data-object')).toBe(false);
  });

  it('stamps the page-level trail on <main> from meta[name=tracking]', () => {
    document.head.innerHTML = '<meta name="tracking" content="home">';
    document.body.innerHTML = '<main><div class="cta block tracking-x" data-block-name="cta"></div></main>';
    const main = document.querySelector('main');
    decorateTracking(main);
    expect(main.getAttribute('data-tracking')).toBe('home');
  });
});

describe('applyTrackingSheet (authoritative overlay)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
  afterEach(() => vi.unstubAllGlobals());

  it('overlays the sheet: identity override on CTA 1, wa-link path on CTA 2 (DOM order)', async () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<p><a class="button" href="#">Schedule a call</a></p>'
      + '<p><button>Watch</button></p></div></main>';
    const main = document.querySelector('main');
    const data = [
      { key: 'demo', cta: '1', 'ui-object': 'input' },
      { key: 'demo', cta: '2', 'wa-link': 'ies:watch' },
    ];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    await applyTrackingSheet(main);
    const [a, btn] = [...main.querySelectorAll('a[href], button')];
    expect(a.getAttribute('data-ui-object')).toBe('input'); // sheet override
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call'); // still derived
    expect(btn.getAttribute('data-wa-link')).toBe('ies:watch');
    expect(btn.hasAttribute('data-object')).toBe(false); // wa-link path, no injected object
    expect(main.querySelector('.cta').getAttribute('data-tracking')).toBe('cta_block');
  });
});
