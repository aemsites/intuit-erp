import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  trackingKey, blockNameOf, deriveForCta,
  stampTrail, resolveTrackable, stampInteraction, initTracking, resetTrackingState, trackAs,
  partLabel,
} from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

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

describe('stampTrail (structural access-point trail — NOT per-CTA)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('stamps the page trail on <main> and the block name, leaving CTAs clean', () => {
    document.head.innerHTML = '<meta name="tracking" content="home">';
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<p class="button-wrapper"><a class="button" href="#">Schedule a call</a></p></div></main>';
    const main = document.querySelector('main');
    stampTrail(main);
    expect(main.getAttribute('data-tracking')).toBe('home');
    expect(main.querySelector('.cta').getAttribute('data-tracking')).toBe('cta'); // block name (default)
    expect(main.querySelector('a').hasAttribute('data-object')).toBe(false); // clean at rest
  });

  it('respects an explicit authored data-tracking on the block (customer override wins)', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta" data-tracking="cta_block">'
      + '<a class="button" href="#">Go</a></div></main>';
    stampTrail(document.querySelector('main'));
    expect(document.querySelector('.cta').getAttribute('data-tracking')).toBe('cta_block'); // not overwritten
  });

  it('falls the block segment back to the CSS class when there is no block-name', () => {
    document.body.innerHTML = '<main><div class="rw-cards block tracking-x"><a class="button" href="#">Go</a></div></main>';
    stampTrail(document.querySelector('main'));
    expect(document.querySelector('.rw-cards').getAttribute('data-tracking')).toBe('rw-cards');
  });

  it('respects an explicit authored data-tracking on <main> (page override wins)', () => {
    document.head.innerHTML = '<meta name="tracking" content="home">';
    document.body.innerHTML = '<main data-tracking="landing"><div class="cta block tracking-demo"><a class="button" href="#">Go</a></div></main>';
    stampTrail(document.querySelector('main'));
    expect(document.querySelector('main').getAttribute('data-tracking')).toBe('landing');
  });
});

describe('resolveTrackable', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('resolves the nearest a/button inside an opted-in block from an inner target', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo">'
      + '<a class="button" href="#"><span>Go</span></a></div></main>';
    const hit = resolveTrackable(document.querySelector('span'));
    expect(hit).not.toBeNull();
    expect(hit.cta.tagName).toBe('A');
    expect(hit.block.classList.contains('tracking-demo')).toBe(true);
  });
  it('resolves a CTA outside any declared block (track-by-default) with block=null', () => {
    document.body.innerHTML = '<main><div class="cta block"><a href="#">X</a></div></main>';
    const hit = resolveTrackable(document.querySelector('a'));
    expect(hit).not.toBeNull();
    expect(hit.cta.tagName).toBe('A');
    expect(hit.block).toBeNull(); // loose content CTA -> page bucket
  });
  it('resolves a native summary disclosure as a trackable control', () => {
    document.body.innerHTML = '<main><div class="disclosure block"><details>'
      + '<summary>Important pricing details</summary></details></div></main>';
    const hit = resolveTrackable(document.querySelector('summary'));
    expect(hit).not.toBeNull();
    expect(hit.cta.tagName).toBe('SUMMARY');
    expect(hit.block).toBeNull();
  });
  it('returns null outside the content regions (injected chrome at the body root)', () => {
    document.body.innerHTML = '<div class="cookie block"><a href="#">Accept</a></div>';
    expect(resolveTrackable(document.querySelector('a'))).toBeNull();
  });
  it('returns null for a data-track-skip control (pure UI)', () => {
    document.body.innerHTML = '<main><button class="nav-toggle" data-track-skip>menu</button></main>';
    expect(resolveTrackable(document.querySelector('button'))).toBeNull();
  });
  it('returns null when the target is not a CTA', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo"><p>text</p></div></main>';
    expect(resolveTrackable(document.querySelector('p'))).toBeNull();
  });
});

describe('stampInteraction (JIT stamp on interaction)', () => {
  beforeEach(() => { document.body.innerHTML = ''; resetTrackingState(); });

  it('stamps derived identity + sacrificial anchor on the interacted CTA', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<p class="button-wrapper"><a class="button" href="#">Schedule a call</a></p></div></main>';
    const a = document.querySelector('a');
    expect(a.hasAttribute('data-object')).toBe(false); // clean before interaction
    stampInteraction({ target: a });
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object')).toBe('button');
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call');
    expect(a.getAttribute('data-tracking')).toBe('button'); // sacrificial anchor
    expect(a.getAttribute('data-ui-access-point')).toBe(''); // opt-in by presence
  });

  it('stamps a block-less content CTA (track-by-default, page bucket)', () => {
    document.body.innerHTML = '<main><div class="cta block"><a href="#">Read more</a></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-object')).toBe('content'); // pure-derive default
    expect(a.getAttribute('data-ui-object-detail')).toBe('Read more');
    expect(a.getAttribute('data-ui-access-point')).toBe(''); // opt-in present -> trail computed to "page"
  });

  it('no-ops for a target outside the content regions', () => {
    document.body.innerHTML = '<div class="cookie"><a href="#">Accept</a></div>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.hasAttribute('data-object')).toBe(false);
  });
});

describe('initTracking (delegated capture-phase runtime)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });
  afterEach(() => vi.unstubAllGlobals());

  it('JIT-stamps on a delegated pointerdown from an inner target; nothing before', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    document.body.innerHTML = '<main><div class="cta block tracking-demo" data-block-name="cta">'
      + '<p class="button-wrapper"><a class="button" href="#"><span>Schedule a call</span></a></p></div></main>';
    const main = document.querySelector('main');
    initTracking(main);
    const a = main.querySelector('a');
    expect(a.hasAttribute('data-object')).toBe(false);
    main.querySelector('span').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call');
  });

  it('activates on keyboard Enter as well', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    document.body.innerHTML = '<main><div class="cta block tracking-demo"><button>Go</button></div></main>';
    const main = document.querySelector('main');
    initTracking(main);
    const btn = main.querySelector('button');
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(btn.getAttribute('data-object')).toBe('content');
    expect(btn.getAttribute('data-ui-object-detail')).toBe('Go');
  });

  it('JIT-stamps a block-less content CTA too (track-by-default)', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    document.body.innerHTML = '<main><div class="cta block"><a href="#">Read more</a></div></main>';
    const main = document.querySelector('main');
    initTracking(main);
    main.querySelector('a').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(main.querySelector('a').getAttribute('data-object')).toBe('content');
  });

  it('ignores a delegated pointerdown outside the content regions', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    document.body.innerHTML = '<div class="cookie"><a href="#">Accept</a></div>';
    initTracking(document);
    document.querySelector('a').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector('a').hasAttribute('data-object')).toBe(false);
  });

  // Regression: the delegated handler must reach header + footer CTAs, which are
  // SIBLINGS of <main> — a main-scoped handler never sees them, so the injected
  // tracker's data-object gate fails and header/footer fire no beacons. scripts.js
  // must init on `document`. (The synthetic parity gate can't see this — it calls
  // stampInteraction directly, bypassing the delegated handler.)
  it('the delegated handler covers header + footer CTAs (not just main)', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    document.body.innerHTML = '<header><a href="/nav">Nav</a></header><main></main><footer><a href="/foot">Foot</a></footer>';
    initTracking(document);
    const nav = document.querySelector('header a');
    const foot = document.querySelector('footer a');
    nav.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    foot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(nav.getAttribute('data-object')).toBe('content'); // handler reached <header>
    expect(foot.getAttribute('data-object')).toBe('content'); // handler reached <footer>
  });

  it('overlays the sheet once it resolves (id override, still derived label)', async () => {
    const data = [{ id: 'demo:schedule-a-call', 'ui-object': 'input' }]; // keyed by the CTA's data-track-id
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    document.body.innerHTML = '<main><div class="cta block" data-block-name="cta">'
      + '<p><a class="button" href="#">Schedule a call</a></p></div></main>';
    const main = document.querySelector('main');
    trackAs('demo', main.querySelector('.block'), { key: 'demo' }); // stamps data-track-id=demo:schedule-a-call
    initTracking(main);
    await new Promise((r) => { setTimeout(r, 0); }); // let the sheet promise settle -> sheetMap
    const a = main.querySelector('a');
    a.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(a.getAttribute('data-ui-object')).toBe('input'); // sheet override by id
    expect(a.getAttribute('data-ui-object-detail')).toBe('Schedule a call'); // still derived
  });

  it('resolves a loose <main> CTA (no block) by its derived page:<id>', async () => {
    const data = [{ id: 'page:pricing', 'wa-link': 'wl-pricing' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    document.body.innerHTML = '<main><p><a class="button" href="/pricing">Pricing</a></p></main>';
    const main = document.querySelector('main');
    initTracking(main);
    await new Promise((r) => { setTimeout(r, 0); });
    const a = main.querySelector('a');
    a.dispatchEvent(new Event('pointerdown', { bubbles: true })); // loose CTA -> page:pricing
    expect(a.getAttribute('data-wa-link')).toBe('wl-pricing');
  });

  // Regression (live-confirmed on stage /accounting/multi-entity): prod rendered the
  // hero CTA href-less (a button), so the sheet keys it by label (hero:take-the-tour);
  // our build renders it as an EXTERNAL link, so trackAs stamps an HREF-based id
  // (hero:navattic-srk05sa) that misses the sheet -> authored object-detail/wa-link
  // never landed. The label fallback resolves the residue across that divergence.
  it('resolves the sheet by <ns>:<slug(label)> when our build gave the CTA an href-based id', async () => {
    const data = [{ id: 'hero:take-the-tour', 'object-detail': 'hero|for_accountants', 'wa-link': 'hero-for-accountants-cta' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    document.body.innerHTML = '<main><div class="hero block"><p class="button-container">'
      + '<a class="button" href="https://intuit.navattic.com/srk05sa">Take the tour</a></p></div></main>';
    const main = document.querySelector('main');
    trackAs('rw2_hero', main.querySelector('.block'), { key: 'hero' });
    initTracking(main);
    await new Promise((r) => { setTimeout(r, 0); });
    const a = main.querySelector('a');
    expect(a.getAttribute('data-track-id')).toBe('hero:navattic-srk05sa'); // precondition: href-based id (misses sheet)
    a.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(a.getAttribute('data-wa-link')).toBe('hero-for-accountants-cta'); // fallback resolved the residue
    expect(a.getAttribute('data-object-detail')).toBe('hero|for_accountants');
  });

  // The fallback must NOT hijack a CTA whose href-based id is genuinely absent from
  // the sheet (different content), i.e. it only fills in when a label row exists.
  it('does not fabricate a row when neither the href-id nor the label-id is in the sheet', async () => {
    const data = [{ id: 'cards:erp', 'wa-link': 'schedule-meeting' }]; // a DIFFERENT card
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    document.body.innerHTML = '<main><div class="cards block"><p class="button-container">'
      + '<a class="button" href="https://quickbooks.intuit.com/r/enterprise/">Explore articles</a></p></div></main>';
    const main = document.querySelector('main');
    trackAs('rw_cards_container', main.querySelector('.block'), { key: 'cards' });
    initTracking(main);
    await new Promise((r) => { setTimeout(r, 0); });
    const a = main.querySelector('a');
    a.dispatchEvent(new Event('pointerdown', { bubbles: true })); // id cards:quickbooks-r-enterprise; label cards:explore-articles
    expect(a.hasAttribute('data-wa-link')).toBe(false); // no matching row -> pure derive, no authored residue
  });
});

describe('Phase 2: coexistence with the pzn/experiment layer', () => {
  beforeEach(() => { document.body.innerHTML = ''; resetTrackingState(); });

  // The injected tracker builds personalization_details / experiment_ids from
  // appVars + the data-pzn-*/data-experiment-* stamps that scripts/experience.js
  // writes on landed treatments. Option B's JIT stamp must leave those untouched
  // so pzn/exp parity is inherited for free.
  it('JIT-stamps identity WITHOUT clobbering data-pzn-*/data-experiment-*', () => {
    document.body.innerHTML = '<main><div class="cta block tracking-demo">'
      + '<a class="button" href="#" data-pzn-placement="ALPHA" data-pzn-id="rec-1"'
      + ' data-experiment-id="386879" data-experiment-version="1" data-treatment-id="840422">Go</a></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    // our identity is stamped
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object-detail')).toBe('Go');
    // the pzn/exp stamps survive -> tracker maps them to personalization_details / experiment_ids
    expect(a.getAttribute('data-pzn-placement')).toBe('ALPHA');
    expect(a.getAttribute('data-pzn-id')).toBe('rec-1');
    expect(a.getAttribute('data-experiment-id')).toBe('386879');
    expect(a.getAttribute('data-experiment-version')).toBe('1');
    expect(a.getAttribute('data-treatment-id')).toBe('840422');
  });
});

describe('Phase 3: video-link detection in the derive', () => {
  beforeEach(() => { document.body.innerHTML = ''; resetTrackingState(); });

  it('derives object=video / ui_object=video_link / action=engaged for a YouTube link', () => {
    document.body.innerHTML = '<main><div class="hero block tracking-1" data-block-name="hero">'
      + '<p class="button-container"><a class="button" href="https://www.youtube.com/watch?v=abc123">Watch product demo</a></p></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-object')).toBe('video');
    expect(a.getAttribute('data-ui-object')).toBe('video_link');
    expect(a.getAttribute('data-action')).toBe('engaged'); // vs generic 'interacted'
    expect(a.getAttribute('data-ui-object-detail')).toBe('Watch product demo');
    expect(a.getAttribute('data-custom-properties')).toContain('link_name|video_link-watch-product-demo');
  });

  it('leaves a non-video styled link as generic content', () => {
    document.body.innerHTML = '<main><div class="hero block tracking-1">'
      + '<p class="button-container"><a class="button" href="/pricing">Pricing</a></p></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-object')).toBe('content');
    expect(a.getAttribute('data-ui-object')).toBe('button');
  });
});

describe('Phase 3: icon-only link detection (link_icon)', () => {
  beforeEach(() => { document.body.innerHTML = ''; resetTrackingState(); });

  it('derives ui_object=link_icon for an icon/logo-only link (no visible text)', () => {
    document.body.innerHTML = '<main><div class="footer-brand block tracking-1">'
      + '<a href="https://turbotax.intuit.com/"><img src="/logo.svg" alt="TurboTax"></a></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-ui-object')).toBe('link_icon');
    expect(a.getAttribute('data-object')).toBe('content');
  });

  it('keeps a link with visible text as link/button even if it contains an icon', () => {
    document.body.innerHTML = '<main><div class="c block tracking-1">'
      + '<a href="#"><span class="icon icon-arrow"></span> Learn more</a></div></main>';
    const a = document.querySelector('a');
    stampInteraction({ target: a });
    expect(a.getAttribute('data-ui-object')).toBe('link'); // has text -> not icon-only
  });
});

describe('partLabel (a slot part is named by its title, not its flowing text)', () => {
  it('prefers a heading / *-title element over the full text content', () => {
    document.body.innerHTML = '<div class="body"><p>Product Update</p>'
      + '<h3 class="card-title">The Real Title</h3><p>Jan 1, 2026</p></div>';
    expect(partLabel(document.querySelector('.body'))).toBe('The Real Title');
  });
  it('falls back to labelFor (an image part reads its own alt) when there is no title', () => {
    document.body.innerHTML = '<img alt="Thumbnail Alt">';
    expect(partLabel(document.querySelector('img'))).toBe('Thumbnail Alt');
  });
});

describe('Phase 5: link_name page-host suffix', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('appends the page host to link_name when a host is supplied (runtime parity)', () => {
    document.body.innerHTML = '<a class="button" href="#">Schedule a call</a>';
    const derived = deriveForCta(document.querySelector('a'), 'cta', 'erp.intuit.com');
    expect(derived['custom-properties'].link_name).toBe('button-schedule-a-call [erp.intuit.com]');
  });

  it('stays host-free when no host is supplied (pure derive / Node harness)', () => {
    document.body.innerHTML = '<a class="button" href="#">Schedule a call</a>';
    const derived = deriveForCta(document.querySelector('a'), 'cta');
    expect(derived['custom-properties'].link_name).toBe('button-schedule-a-call');
  });
});

describe('trackAs — declarative block opt-in from decorate()', () => {
  beforeEach(() => { document.body.innerHTML = ''; resetTrackingState(); });

  it('opts a non-container block in, stamps its trail, and makes its CTA trackable', () => {
    document.body.innerHTML = '<main><div class="hero block"><p class="button-container"><a class="button" href="#">Go</a></p></div></main>';
    const block = document.querySelector('.hero');
    trackAs('hero', block);
    expect(trackingKey(block)).toBe('hero'); // opted in (reuses the tracking- machinery)
    expect(block.getAttribute('data-tracking')).toBe('hero'); // trail segment
    // the delegated handler now JIT-stamps its CTA identity on interaction
    stampInteraction({ target: block.querySelector('a') });
    expect(block.querySelector('a').getAttribute('data-object')).toBe('content');
    expect(block.querySelector('a').getAttribute('data-ui-object-detail')).toBe('Go');
  });

  it('stamps indexed inner-slot trail segments (items with a function value)', () => {
    document.body.innerHTML = '<main><div class="carousel block">'
      + '<div class="carousel-card"><a class="button" href="#">One</a></div>'
      + '<div class="carousel-card"><a class="button" href="#">Two</a></div></div></main>';
    const block = document.querySelector('.carousel');
    trackAs('carousel', block, { items: { '.carousel-card': (i) => `carousel_${i}` } });
    const cards = [...block.querySelectorAll('.carousel-card')];
    expect(block.getAttribute('data-tracking')).toBe('carousel');
    expect(cards[0].getAttribute('data-tracking')).toBe('carousel_0');
    expect(cards[1].getAttribute('data-tracking')).toBe('carousel_1');
  });

  it('stamps fixed inner-slot trail segments (items with string values)', () => {
    document.body.innerHTML = '<main><div class="footer block">'
      + '<div class="cols"><div class="col"><a href="#">Link</a></div></div>'
      + '<div class="brand" data-tracking="authored"></div></div></main>';
    const block = document.querySelector('.footer');
    trackAs('footer', block, {
      key: 'footer',
      items: { '.cols': 'menus', '.col': 'menu_section', '.brand': 'products' },
    });
    expect(block.querySelector('.cols').getAttribute('data-tracking')).toBe('menus');
    expect(block.querySelector('.col').getAttribute('data-tracking')).toBe('menu_section');
    // authored data-tracking wins — the item segment does not overwrite it
    expect(block.querySelector('.brand').getAttribute('data-tracking')).toBe('authored');
  });

  it('passes (index, el) to an items function in that order', () => {
    document.body.innerHTML = '<main><div class="c block">'
      + '<span class="i" data-k="a"></span><span class="i" data-k="b"></span></div></main>';
    trackAs('c', document.querySelector('.c'), { items: { '.i': (i, el) => `${el.dataset.k}_${i}` } });
    const els = [...document.querySelectorAll('.i')];
    expect(els[0].getAttribute('data-tracking')).toBe('a_0'); // index first, el second
    expect(els[1].getAttribute('data-tracking')).toBe('b_1');
  });

  it('alsoTrack: a click on a declared part resolves to the part (its own beacon)', () => {
    document.body.innerHTML = '<main><div class="rb block">'
      + '<a class="rb-card" href="#"><span class="rb-image"><img alt="Card Title"></span>'
      + '<div class="rb-body">Body text</div></a></div></main>';
    const block = document.querySelector('.rb');
    trackAs('qrc_content_card_grid', block, {
      key: 'rb',
      action: 'engaged', // block CTA default — parts must NOT inherit it
      items: { '.rb-card': 'qrc_content_card', '.rb-image': 'image' },
      alsoTrack: { '.rb-image img': 'button' },
    });
    expect(block.querySelector('.rb-image').getAttribute('data-tracking')).toBe('image');
    expect(block.querySelector('img').getAttribute('data-track-as')).toBe('button');
    // clicking the thumbnail derives an image beacon (pure-derive: action=interacted)
    const img = block.querySelector('img');
    stampInteraction({ target: img });
    expect(img.getAttribute('data-object')).toBe('content');
    expect(img.getAttribute('data-ui-object')).toBe('button');
    expect(img.getAttribute('data-ui-object-detail')).toBe('Card Title');
    expect(img.getAttribute('data-action')).toBe('interacted'); // not the block's engaged
    expect(img.getAttribute('data-tracking')).toBe('button'); // sacrificial leaf
    // a click in the body resolves to the card anchor, not a part
    expect(resolveTrackable(block.querySelector('.rb-body')).cta.tagName).toBe('A');
  });

  it('alsoTrack: an image beacon omits link_name (prod does), a content slot keeps it', () => {
    document.body.innerHTML = '<main><div class="rb block">'
      + '<a class="rb-card" href="#"><span class="rb-image"><img alt="Card Title"></span>'
      + '<span class="rb-slot"><div class="rb-body"><h3 class="rb-title">Card Title</h3>'
      + '<p>Product Update</p></div></span></a></div></main>';
    const block = document.querySelector('.rb');
    trackAs('qrc_content_card_grid', block, {
      key: 'rb',
      items: {
        '.rb-card': 'qrc_content_card', '.rb-image': 'image', '.rb-slot': 'qrc_content_card_content',
      },
      alsoTrack: {
        '.rb-image img': 'button', // string => link_name OFF
        '.rb-body': { as: 'button', linkName: true }, // content slot keeps it
      },
    });
    const img = block.querySelector('img');
    const body = block.querySelector('.rb-body');
    expect(img.getAttribute('data-track-link-name')).toBe('off');
    expect(body.hasAttribute('data-track-link-name')).toBe(false);

    // image beacon: no link_name in custom-properties
    stampInteraction({ target: img });
    expect(img.getAttribute('data-custom-properties') || '').not.toMatch(/link_name/);
    expect(computeTrackingPayload(img).ui_access_point)
      .toBe('qrc_content_card_grid|qrc_content_card|image');

    // content-slot beacon: detail = the title (not the flowing body text), trail
    // ends qrc_content_card_content, link_name derived from the title
    stampInteraction({ target: block.querySelector('.rb-title') });
    expect(body.getAttribute('data-ui-object')).toBe('button');
    expect(body.getAttribute('data-ui-object-detail')).toBe('Card Title');
    expect(body.getAttribute('data-custom-properties')).toMatch(/link_name\|button-card-title/);
    expect(computeTrackingPayload(block.querySelector('.rb-title')).ui_access_point)
      .toBe('qrc_content_card_grid|qrc_content_card|qrc_content_card_content');
  });

  it('items + a display:contents button wrapper produce a …|oisp_loadmore|button trail', () => {
    document.body.innerHTML = '<main><div class="bc block">'
      + '<div class="lm"><span class="lm-btn"><button type="button">Load More</button></span></div>'
      + '</div></main>';
    const block = document.querySelector('.bc');
    trackAs('dynamic_category_container', block, {
      key: 'dynamic_category_container',
      linkName: false,
      items: { '.lm': 'oisp_loadmore', '.lm-btn': 'button' },
    });
    const btn = block.querySelector('button');
    stampInteraction({ target: btn });
    expect(btn.getAttribute('data-ui-object')).toBe('button');
    expect(btn.getAttribute('data-ui-object-detail')).toBe('Load More');
    expect(btn.getAttribute('data-custom-properties') || '').not.toMatch(/link_name/); // block linkName off
    expect(computeTrackingPayload(btn).ui_access_point)
      .toBe('dynamic_category_container|oisp_loadmore|button');
  });

  it('respects an authored opt-in + explicit data-tracking (never overwrites)', () => {
    document.body.innerHTML = '<main><div class="hero block tracking-authored" data-tracking="custom"><a class="button" href="#">Go</a></div></main>';
    const block = document.querySelector('.hero');
    trackAs('hero', block);
    expect(block.getAttribute('data-tracking')).toBe('custom'); // explicit trail wins
    expect(trackingKey(block)).toBe('authored'); // existing opt-in key kept
    expect(block.classList.contains('tracking-hero')).toBe(false); // no second opt-in class
  });

  it('returns the block so it can be the decorate() return value', () => {
    document.body.innerHTML = '<main><div class="hero block"></div></main>';
    const block = document.querySelector('.hero');
    expect(trackAs('hero', block)).toBe(block);
  });

  it('decouples the trail (name) from the sheet/opt-in key', () => {
    document.body.innerHTML = '<main><div class="hero block"><a class="button" href="#">Go</a></div></main>';
    const block = document.querySelector('.hero');
    trackAs('rw2_hero', block, { key: 'hero' });
    expect(block.getAttribute('data-tracking')).toBe('rw2_hero'); // trail = prod string
    expect(trackingKey(block)).toBe('hero'); // opt-in + sheet key = clean
    expect(block.classList.contains('tracking-hero')).toBe(true);
  });
});
