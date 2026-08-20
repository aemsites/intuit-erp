import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  stampTrail, stampInteraction, initTracking, resetTrackingState,
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
      ui_access_point: 'cta_block', // trail, anchor skipped
    });
    // custom-prop expanded to top-level; the runtime appends the page host
    // ("… [<host>]"), so match the base.
    expect(p.link_name.startsWith('button-schedule-a-call')).toBe(true);
    expect(p.custom_properties).toBeUndefined();
  });

  it('both CTAs in the block resolve the cta_block access-point', () => {
    const main = document.querySelector('main');
    stampAll(main);
    const aps = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el).ui_access_point);
    expect(aps).toEqual(['cta_block', 'cta_block']);
  });
});

describe('parity: sheet overlay reproduces authored variants', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = MARKUP; resetTrackingState(); });
  afterEach(() => vi.unstubAllGlobals());

  it('a wa-link row adds the wa-link fields to the first CTA', async () => {
    const data = [{ key: 'demo', cta: '1', 'wa-link': 'ies-nav:main-demo-cta' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    const main = document.querySelector('main');
    initTracking(main); // pre-warms + caches the sheet map
    await new Promise((r) => { setTimeout(r, 0); });
    main.querySelectorAll('a.button').forEach((el) => stampInteraction({ target: el }));
    const [first, second] = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el));
    // CTA 1 -> wa-link, but object defaults to content (no walink path) + top-level data-wa-link
    expect(first.event).toBe('content:engaged');
    expect(first.object).toBe('content');
    expect(first['data-wa-link']).toBe('ies-nav:main-demo-cta');
    expect(first.icom_user_action).toBe('ies-nav:main-demo-cta');
    // CTA 2 -> still the derived full-path payload
    expect(second.object).toBe('content');
    expect(second.ui_object_detail).toBe('Schedule a call');
  });
});
