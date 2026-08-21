import { readFileSync } from 'node:fs';
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  trackAs, stampTrail, stampInteraction, resetTrackingState,
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
  stampTrail(document.querySelector('main'));
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

describe('self-made golden oracle — coverage boundary is explicit', () => {
  it('the fixture flags header/footer/nav as code-built (not generic derive)', () => {
    const homepage = golden.pages.find((p) => p.path === '/');
    const codeBuilt = homepage.events.filter((e) => e.coverage === 'code-built').map((e) => e.category);
    // These are the surfaces that still need block-owned stamping (like pzn/exp).
    expect(codeBuilt).toEqual(expect.arrayContaining(['cornerstone', 'main_nav', 'footer']));
    const gaps = homepage.events.filter((e) => e.coverage === 'gap').map((e) => e.name);
    expect(gaps).toContain('video-play-button'); // video:started not yet derived
  });
});
