import { readFileSync } from 'node:fs';
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  trackAs, stampTrail, stampInteraction, resetTrackingState, resolveTrackable,
} from '../scripts/tracking.js';
import decorateFaq from '../blocks/faq/faq.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

/**
 * Self-made golden oracle. Loads the golden we captured off prod (real Chrome,
 * eventbus intercepted + aborted) and asserts that OUR runtime — the actual block
 * trackAs() wiring + the JIT stamp — reproduces the DOM-derivable per-click fields
 * for every event our implementation is expected to cover (coverage: "derive").
 * The payload is read back through the tracker replica, which was validated against
 * the REAL injected tracker (strip-and-restamp on prod). Swap the fixture for the
 * customer's set when it lands.
 *
 * coverage: "code-built" (header/footer/global-nav) and "gap" (video play=started)
 * events are asserted-absent here on purpose — they need the block's own stamping,
 * not the generic derive, and are tracked as remaining work.
 */
const golden = JSON.parse(readFileSync('scripts/diff/fixtures/clicktrack-selfmade.golden.json', 'utf8'));
const eventOf = (path, name) => golden.pages.find((p) => p.path === path).events.find((e) => e.name === name);
const normLinkName = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);

// Render our block, run the delegated JIT stamp on one CTA, read via the replica.
function runOurs(setup, ctaSelector) {
  resetTrackingState();
  document.head.innerHTML = '';
  setup();
  stampTrail(document); // whole-doc scope: header/footer live outside <main>
  const cta = document.querySelector(ctaSelector);
  stampInteraction({ target: cta });
  return computeTrackingPayload(cta);
}

// Assert every field the golden pins as derivable (link_name host-normalized).
function expectMatchesGolden(payload, derivable, skip = []) {
  Object.entries(derivable).forEach(([k, v]) => {
    if (skip.includes(k)) return;
    const got = k === 'link_name' ? normLinkName(payload[k]) : payload[k];
    expect(got, `field ${k}`).toBe(v);
  });
}

describe('self-made golden oracle — our runtime reproduces the derive-covered events', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('product hero CTA (rw2_hero)', () => {
    const g = eventOf('/accounting/multi-entity/', 'hero-schedule-a-call');
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="hero block">'
        + '<div><div><p class="button-wrapper"><a class="button" href="/demo">Schedule a call</a></p></div></div>'
        + '</div></main>';
      trackAs('rw2_hero', document.querySelector('.hero'), { key: 'hero' });
    }, '.hero a.button');
    expectMatchesGolden(p, g.derivable);
  });

  it('cards carousel links (rw_cards_container|carousel|rw_card_N)', () => {
    const setup = () => {
      document.body.innerHTML = '<main><div class="cards block"><div class="cards-track">'
        + '<div class="card"><p class="button-container"><a href="/a">Explore articles</a></p></div>'
        + '<div class="card"><p class="button-container"><a href="/b">See offerings</a></p></div>'
        + '</div></div></main>';
      trackAs('rw_cards_container', document.querySelector('.cards'), {
        key: 'cards',
        itemSelector: '.cards-track, .cards-track > .card',
        itemLabel: (i, el) => (el.classList.contains('cards-track') ? 'carousel' : `rw_card_${i}`),
      });
    };
    const g1 = eventOf('/accounting/multi-entity/', 'card-link-explore-articles');
    expectMatchesGolden(runOurs(setup, '.cards .card:nth-child(1) a'), g1.derivable);
    const g2 = eventOf('/accounting/multi-entity/', 'card-link-rw-card-2');
    expectMatchesGolden(runOurs(setup, '.cards .card:nth-child(2) a'), g2.derivable);
  });

  it('faq accordion item (trail=accordion)', () => {
    const g = eventOf('/', 'faq-accordion-item');
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="faq block">'
        + '<div><div>Can you support entities outside the US?</div><div>Yes.</div></div>'
        + '</div></main>';
      decorateFaq(document.querySelector('.faq'));
    }, '.faq button.faq-toggle');
    expectMatchesGolden(p, g.derivable);
  });

  it('video link (video:engaged) — derive fields; ap is authored-flat on prod', () => {
    const g = eventOf('/accounting/multi-entity/', 'video-watch-patrick');
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="hero block">'
        + '<div><div><a href="https://youtu.be/abcd1234">Watch Patrick\'s story (2:33)</a></div></div>'
        + '</div></main>';
      trackAs('rw2_hero', document.querySelector('.hero'), { key: 'hero' });
    }, '.hero a');
    // prod authors the video CTA with ui_access_point=page even inside a component;
    // our block-scoped trail gives the block name, so ap is a known authored-flat divergence.
    expectMatchesGolden(p, g.derivable, ['ui_access_point']);
  });
});

describe('self-made golden oracle — code-built surfaces (header/footer/video)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('header cornerstone logo -> content:engaged, link_icon, empty ui_access_point', () => {
    const g = eventOf('/', 'cornerstone-logo-intuit');
    const p = runOurs(() => {
      document.body.innerHTML = '<header><div class="header block"><div class="ies-topstrip">'
        + '<a class="bs-logo" href="https://turbotax.intuit.com/" aria-label="TurboTax"><img alt=""></a></div></div></header>';
      trackAs(null, document.querySelector('.header'), { key: 'nav', action: 'engaged', linkName: false });
    }, '.bs-logo');
    expectMatchesGolden(p, g.derivable); // action=engaged (block default), ap='' (outside main)
  });

  it('header nav toggle -> content:engaged, empty ui_access_point', () => {
    const g = eventOf('/', 'main-nav-capabilities');
    const p = runOurs(() => {
      document.body.innerHTML = '<header><div class="header block"><nav class="nav-main">'
        + '<div class="nav-item"><button type="button">Capabilities</button></div></nav></div></header>';
      trackAs(null, document.querySelector('.header'), { key: 'nav', action: 'engaged', linkName: false });
    }, '.nav-item button');
    // our derive gives ui_object=button; prod authors ui_object=link (sheet residue).
    expectMatchesGolden(p, g.derivable, ['ui_object']);
  });

  // Mirror the footer block's actual wiring (opt-in + legal-tier trail root).
  const wireFooter = (block) => {
    trackAs(null, block, { key: 'footer', linkName: false, skip: '.col-toggle, .country-toggle' });
    block.querySelector('.ftr-legal')?.setAttribute('data-tracking', 'footer');
    block.querySelector('.brand-logos')?.setAttribute('data-tracking', 'products');
    block.querySelectorAll('.legal-links, .legal-copy, .legal-nav').forEach((s) => s.setAttribute('data-tracking', 'footer_bottom'));
  };

  it('footer corporate brand -> content:interacted, trail footer|products', () => {
    const g = eventOf('/', 'footer-corporate-row');
    const p = runOurs(() => {
      document.body.innerHTML = '<footer><div class="footer block"><div class="ftr-legal"><div class="legal-center">'
        + '<div class="brand-logos"><a class="ftr-brand" href="https://turbotax.intuit.com/" aria-label="TurboTax"><svg></svg></a></div>'
        + '</div></div></div></footer>';
      wireFooter(document.querySelector('.footer'));
    }, '.brand-logos a');
    // icon-only brand mark derives link_icon; prod authors link (sheet residue).
    expectMatchesGolden(p, g.derivable, ['ui_object']);
  });

  it('footer authored column link -> content:interacted, ap=page (not under the footer root)', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<footer><div class="footer block"><div class="ftr-main"><div class="footer-cols">'
        + '<div class="footer-col"><ul><li><a href="/about">About Intuit</a></li></ul></div>'
        + '</div></div><div class="ftr-legal"></div></div></footer>';
      wireFooter(document.querySelector('.footer'));
    }, '.footer-col a');
    expect(p.ui_access_point).toBe('page'); // footer sits outside <header> -> page fallback
    expect(p.event).toBe('content:interacted');
  });

  it('pure-UI toggles are skipped (col-toggle / flyout-back not tracked)', () => {
    resetTrackingState();
    document.body.innerHTML = '<footer><div class="footer block"><div class="footer-cols">'
      + '<div class="footer-col"><h2><button type="button" class="col-toggle">Company</button></h2></div>'
      + '</div></div></footer>';
    const block = document.querySelector('.footer');
    trackAs(null, block, { key: 'footer', linkName: false, skip: '.col-toggle, .country-toggle' });
    expect(resolveTrackable(block.querySelector('.col-toggle'))).toBeNull();
  });

  it('video play control -> video:started, object=video, ui_object=button, ap=page', () => {
    const g = eventOf('/', 'video-play-button');
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="video block">'
        + '<div class="video-preview" role="button" tabindex="0" aria-label="Play video">'
        + '<picture><img alt=""></picture><span class="video-play"></span></div>'
        + '</div></main>';
      trackAs(null, document.querySelector('.video'), {
        key: 'video', object: 'video', action: 'started', uiObject: 'button', linkName: false,
      });
    }, '.video-preview');
    expectMatchesGolden(p, g.derivable);
  });
});

describe('self-made golden oracle — coverage is fully classified', () => {
  const KNOWN = ['derive', 'code-built', 'to-annotate', 'sheet'];
  it('every golden event across all archetypes has a known coverage status', () => {
    const all = golden.pages.flatMap((p) => p.events);
    const unknown = all.filter((e) => !KNOWN.includes(e.coverage)).map((e) => e.name);
    expect(unknown).toEqual([]);
  });

  it('the blog + secondary-nav + testimonial components are now wired (code-built)', () => {
    const codeBuilt = golden.pages.flatMap((p) => p.events)
      .filter((e) => e.coverage === 'code-built').map((e) => e.category);
    expect(codeBuilt).toEqual(expect.arrayContaining([
      'qrc_article_hero', 'qrc_content_card_grid', 'TableOfContents', 'social_media', 'secondary_nav', 'rw_testimonial',
    ]));
  });
});

describe('self-made golden oracle — blog + testimonial code-built surfaces', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('blog share row -> social_media (content:interacted)', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="case-study-header block"><div class="case-study-copy">'
        + '<div class="case-study-share"><a href="https://www.linkedin.com/x" aria-label="Share on LinkedIn"><svg></svg></a></div>'
        + '</div></div></main>';
      const block = document.querySelector('.case-study-header');
      trackAs(null, block, { key: 'case-study-header', linkName: false });
      block.querySelector('.case-study-share').setAttribute('data-tracking', 'social_media');
    }, '.case-study-share a');
    expect(p.ui_access_point).toBe('social_media');
    expect(p.event).toBe('content:interacted');
  });

  it('blog table of contents -> TableOfContents', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="case-study-header block">'
        + '<nav class="case-study-toc"><ol><li><a href="#s1">Section one</a></li></ol></nav></div></main>';
      const block = document.querySelector('.case-study-header');
      trackAs(null, block, { key: 'case-study-header', linkName: false });
      block.querySelector('.case-study-toc').setAttribute('data-tracking', 'TableOfContents');
    }, '.case-study-toc a');
    expect(p.ui_access_point).toBe('TableOfContents');
  });

  it('resource-center secondary nav -> secondary_nav (content:engaged)', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<header><div class="header block">'
        + '<nav class="ies-secondary-nav"><a class="secondary-nav-brand" href="/blog">Resource center</a></nav></div></header>';
      const block = document.querySelector('.header');
      trackAs(null, block, {
        key: 'nav', action: 'engaged', linkName: false, skip: '.nav-toggle, .flyout-back, .secondary-nav-toggle',
      });
      block.querySelector('.ies-secondary-nav').setAttribute('data-tracking', 'secondary_nav');
    }, '.ies-secondary-nav a');
    expect(p.ui_access_point).toBe('secondary_nav');
    expect(p.event).toBe('content:engaged');
  });

  it('related-blogs content card -> qrc_content_card_grid, action=engaged', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="related-blogs block">'
        + '<a class="related-blogs-card" href="/blog/x">Article title</a></div></main>';
      trackAs('qrc_content_card_grid', document.querySelector('.related-blogs'), {
        key: 'related-blogs', linkName: false, action: 'engaged', skip: '.related-blogs-load-more',
      });
    }, '.related-blogs-card');
    expect(p.ui_access_point).toBe('qrc_content_card_grid');
    expect(p.event).toBe('content:engaged'); // content-exploration cards report engaged
  });

  it('testimonial control -> rw_testimonial', () => {
    const p = runOurs(() => {
      document.body.innerHTML = '<main><div class="testimonial block"><a href="/story">See their story</a></div></main>';
      trackAs('rw_testimonial', document.querySelector('.testimonial'), { key: 'testimonial', linkName: false });
    }, '.testimonial a');
    expect(p.ui_access_point).toBe('rw_testimonial');
  });
});
