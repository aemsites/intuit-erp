import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveForCta, trackingKey, trackAs, stampTrail, stampInteraction, resetTrackingState,
} from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';
import decorateFaq from '../blocks/faq/faq.js';
import decorateCards from '../blocks/cards/cards.js';

// Derive matrix — realistic CTA shapes observed across the reverse-engineered
// reference pages (homepage, /pricing/, /accounting/multi-entity/, a /blog/
// article). Synthetic inputs (no scraped campaign codes); asserts the
// DOM-derivable fields only (wa-link/object_detail residue is the sheet's job).
describe('derive matrix — reference-page CTA shapes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const el = (html) => { document.body.innerHTML = `<div>${html}</div>`; return document.body.querySelector('a, button'); };
  const cases = [
    { name: 'styled CTA (hero "Schedule a call")', html: '<a class="button" href="/demo">Schedule a call</a>', object: 'content', kind: 'button', action: 'interacted' },
    { name: 'plain anchor (blog secondary-nav link)', html: '<a href="/resources">Resource center</a>', object: 'content', kind: 'link', action: 'interacted' },
    { name: 'YouTube video link ("Watch product demo")', html: '<a class="button" href="https://www.youtube.com/watch?v=abc123">Watch product demo</a>', object: 'video', kind: 'video_link', action: 'engaged' },
    { name: 'youtu.be short video link', html: '<a href="https://youtu.be/abcdef">Watch story</a>', object: 'video', kind: 'video_link', action: 'engaged' },
    { name: 'Vimeo video link', html: '<a href="https://vimeo.com/123456789">Watch case study</a>', object: 'video', kind: 'video_link', action: 'engaged' },
    { name: 'icon-only logo link (footer brand)', html: '<a href="https://turbotax.intuit.com/"><img src="/tt.svg" alt="TurboTax"></a>', object: 'content', kind: 'link_icon', action: 'interacted' },
    { name: 'icon-only button (social/close)', html: '<button aria-label="Close"><svg viewBox="0 0 10 10"></svg></button>', object: 'content', kind: 'link_icon', action: 'interacted' },
  ];

  cases.forEach(({
    name, html, object, kind, action,
  }) => {
    it(name, () => {
      const d = deriveForCta(el(html), 'demo');
      expect(d.object).toBe(object);
      expect(d['ui-object']).toBe(kind);
      expect(d.action).toBe(action);
    });
  });

  it('link_name uses the ui_object kind as its prefix', () => {
    const video = deriveForCta(el('<a href="https://youtu.be/x123456">Watch product demo</a>'), 'demo');
    expect(video['custom-properties'].link_name).toBe('video_link-watch-product-demo');
    const cta = deriveForCta(el('<a class="button" href="/x">Schedule a call</a>'), 'demo');
    expect(cta['custom-properties'].link_name).toBe('button-schedule-a-call');
  });
});

// Block-annotation smoke tests — lock the trackAs wiring in real block decorates.
describe('block annotations stamp the right trail + opt-in key', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

  it('faq -> trail "accordion", opt-in key "faq"', () => {
    document.body.innerHTML = '<main><div class="faq block">'
      + '<div><div>Can you support entities outside the US?</div><div>Yes.</div></div>'
      + '<div><div>Can I keep my data?</div><div>Yes.</div></div></div></main>';
    const block = document.querySelector('.faq');
    decorateFaq(block);
    expect(block.getAttribute('data-tracking')).toBe('accordion');
    expect(trackingKey(block)).toBe('faq');
  });

  it('cards -> trail "rw_cards_container", opt-in key "cards"', () => {
    document.body.innerHTML = '<main><div class="cards block">'
      + '<div><div><p>Card one</p></div></div>'
      + '<div><div><p>Card two</p></div></div></div></main>';
    const block = document.querySelector('.cards');
    decorateCards(block);
    expect(block.getAttribute('data-tracking')).toBe('rw_cards_container');
    expect(trackingKey(block)).toBe('cards');
  });
});

// Ground truth locked from LIVE prod beacons captured off erp.intuit.com +
// /accounting/multi-entity/ on 2026-08-20 (real Chrome, eventbus intercepted +
// dropped — nothing delivered). Each case runs the REAL runtime end-to-end
// (trackAs trail + stampInteraction JIT-stamp) and reads the CTA back through the
// tracker replica, asserting the exact per-click fields the injected tracker
// emitted. Authored residue (object_detail, wa-link, and prod's action=engaged on
// card links) is the sheet's job and is intentionally NOT derived here.
describe('prod-captured parity (erp.intuit.com 2026-08-20)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });
  const stampAndRead = (cta) => {
    stampTrail(document.querySelector('main'));
    stampInteraction({ target: cta });
    return computeTrackingPayload(cta);
  };

  it('hero CTA -> content:interacted, trail rw2_hero (verbatim capture)', () => {
    document.body.innerHTML = '<main><div class="hero block">'
      + '<div><div><p class="button-wrapper"><a class="button" href="/demo">Schedule a call</a></p></div></div>'
      + '</div></main>';
    const block = document.querySelector('.hero');
    trackAs('rw2_hero', block, { key: 'hero' });
    const p = stampAndRead(block.querySelector('a.button'));
    expect(p).toMatchObject({
      event: 'content:interacted',
      object: 'content',
      action: 'interacted',
      ui_object: 'button',
      ui_object_detail: 'Schedule a call',
      ui_action: 'clicked',
      ui_access_point: 'rw2_hero',
    });
    expect(p.link_name.startsWith('button-schedule-a-call')).toBe(true);
  });

  it('card link -> content trail rw_cards_container|carousel|rw_card_1 (the E2E-validated case)', () => {
    // Mirrors the definitive prod test: a plain link inside rw_card_1; the real
    // tracker computed ui_access_point from the data-tracking chain (leaf sacrificial).
    document.body.innerHTML = '<main><div class="cards block"><div class="cards-track">'
      + '<div class="card"><p class="button-container"><a href="/articles">Explore articles</a></p></div>'
      + '<div class="card"><p class="button-container"><a href="/offerings">See offerings</a></p></div>'
      + '</div></div></main>';
    const block = document.querySelector('.cards');
    trackAs('rw_cards_container', block, {
      key: 'cards',
      itemSelector: '.cards-track, .cards-track > .card',
      itemLabel: (i, el) => (el.classList.contains('cards-track') ? 'carousel' : `rw_card_${i}`),
    });
    const p = stampAndRead(block.querySelector('.card a'));
    expect(p).toMatchObject({
      event: 'content:interacted', // prod authored action=engaged here -> sheet residue
      object: 'content',
      ui_object: 'link', // plain anchor, not a styled button
      ui_object_detail: 'Explore articles',
      ui_access_point: 'rw_cards_container|carousel|rw_card_1',
    });
    expect(p.link_name.startsWith('link-explore-articles')).toBe(true);
  });

  it('video link -> video:engaged, object=video, ui_object=video_link (capture)', () => {
    document.body.innerHTML = '<main><div class="hero block">'
      + '<div><div><a href="https://youtu.be/abc12345">Watch product demo</a></div></div>'
      + '</div></main>';
    const block = document.querySelector('.hero');
    trackAs('rw2_hero', block, { key: 'hero' });
    const p = stampAndRead(block.querySelector('a'));
    expect(p).toMatchObject({
      event: 'video:engaged',
      object: 'video',
      action: 'engaged',
      ui_object: 'video_link',
      ui_object_detail: 'Watch product demo',
    });
  });
});
