import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  stampTrail, stampInteraction, initTracking, resetTrackingState, trackAs,
} from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

/**
 * End-to-end parity: run the REAL Option B runtime (stampTrail structural trail +
 * stampInteraction JIT-stamp) on cta_block markup, then read each CTA back
 * through the tracker replica and assert the resulting payload. This closes the
 * loop: JIT stamp -> tracker reads -> prod-equivalent payload for the documented
 * `cta_block` "Schedule a call" CTAs.
 *
 * NOTE: the replica still models the reverse-engineered tracker; the live
 * 2026-08-20 re-verification (see fixtures/backend-contract.json) found the real
 * tracker's wa-link/default/event-name behaviour has drifted. The Phase-6 oracle
 * diffs LIVE captures on both sides, so parity against prod is enforced there;
 * this suite guards the runtime->replica loop.
 */
const MARKUP = `<main>
  <div class="section">
    <div class="cta block tracking-demo" data-block-name="cta">
      <div><div><p class="button-wrapper"><a class="button" href="/demo1">Schedule a call</a></p></div></div>
      <div><div><p class="button-wrapper"><a class="button" href="/demo2">Schedule a call</a></p></div></div>
    </div>
  </div>
</main>`;

// Simulate the delegated runtime firing on every CTA in the block.
function stampAll(main) {
  stampTrail(main);
  main.querySelectorAll('a[href], button').forEach((el) => stampInteraction({ target: el }));
}

describe('parity: runtime reproduces the prod cta_block payload', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = MARKUP; resetTrackingState(); });

  it('derived baseline alone matches prod core fields', () => {
    const main = document.querySelector('main');
    stampAll(main);
    const p = computeTrackingPayload(main.querySelector('a.button'));
    expect(p).toMatchObject({
      event: 'content:interacted',
      object: 'content',
      ui_object: 'button',
      ui_object_detail: 'Schedule a call',
      ui_action: 'clicked',
      action: 'interacted',
      ui_access_point: 'cta', // trail = block name (default), anchor skipped
    });
    // custom-prop expanded to top-level; the runtime appends the page host
    // ("… [<host>]"), so match the base.
    expect(p.link_name.startsWith('button-schedule-a-call')).toBe(true);
    expect(p.custom_properties).toBeUndefined();
  });

  it('both CTAs in the block resolve the block-name access-point', () => {
    const main = document.querySelector('main');
    stampAll(main);
    const aps = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el).ui_access_point);
    expect(aps).toEqual(['cta', 'cta']);
  });
});

describe('parity: sheet overlay reproduces authored variants', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = MARKUP; resetTrackingState(); });
  afterEach(() => vi.unstubAllGlobals());

  it('a wa-link row (unique key demo-1) adds the wa-link fields to the first CTA', async () => {
    const data = [{ key: 'demo-1', 'wa-link': 'ies-nav:main-demo-cta' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    const main = document.querySelector('main');
    initTracking(main); // pre-warms + caches the sheet map
    await new Promise((r) => { setTimeout(r, 0); });
    main.querySelectorAll('a.button').forEach((el) => stampInteraction({ target: el }));
    const [first, second] = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el));
    // CTA 1 -> wa-link added; object=content + the DERIVED action (interacted) —
    // no walink short-circuit, so object-detail/action are kept. (nav CTAs that
    // need action=engaged get it from the sheet or the code-built header.)
    expect(first.event).toBe('content:interacted');
    expect(first.object).toBe('content');
    expect(first.action).toBe('interacted');
    expect(first['data-wa-link']).toBe('ies-nav:main-demo-cta');
    expect(first.icom_user_action).toBe('ies-nav:main-demo-cta');
    // CTA 2 -> still the derived full-path payload
    expect(second.object).toBe('content');
    expect(second.ui_object_detail).toBe('Schedule a call');
  });
});

describe('parity: trackAs multi-level trail (rw_cards_container|carousel|rw_card_N)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('resolves the full 3-level trail via a broad items selector + branching value fn', () => {
    document.body.innerHTML = '<main><div class="cards block">'
      + '<div class="cards-track">'
      + '<div class="card"><p class="button-container"><a class="button" href="#">One</a></p></div>'
      + '<div class="card"><p class="button-container"><a class="button" href="#">Two</a></p></div>'
      + '</div></div></main>';
    const block = document.querySelector('.cards');
    trackAs('rw_cards_container', block, {
      items: {
        '.cards-track, .cards-track > .card':
          (i, el) => (el.classList.contains('cards-track') ? 'carousel' : `rw_card_${i}`),
      },
    });
    expect(block.getAttribute('data-tracking')).toBe('rw_cards_container');
    expect(block.querySelector('.cards-track').getAttribute('data-tracking')).toBe('carousel');
    const cards = [...block.querySelectorAll('.card')];
    expect(cards[0].getAttribute('data-tracking')).toBe('rw_card_1'); // wrapper is i=0, cards 1-based
    expect(cards[1].getAttribute('data-tracking')).toBe('rw_card_2');
    // JIT-stamp a CTA inside card 1; the computed trail includes all three levels (anchor skipped)
    stampInteraction({ target: cards[0].querySelector('a') });
    expect(computeTrackingPayload(cards[0].querySelector('a')).ui_access_point)
      .toBe('rw_cards_container|carousel|rw_card_1');
  });
});
