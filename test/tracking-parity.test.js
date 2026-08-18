import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { decorateTracking, applyTrackingSheet } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

/**
 * End-to-end parity: run the REAL runtime (decorateTracking + applyTrackingSheet)
 * on cta_block markup, then read each CTA back through the tracker replica (the
 * same code the tracker runs) and assert the payload matches what prod emits for
 * the documented `cta_block` "Schedule a call" CTAs. This closes the loop:
 * runtime stamps -> tracker reads -> prod-equivalent payload.
 *
 * EDS emits `a.button` for both CTAs (prod's #2 is a <button>, #3 an <a>; the
 * only prod difference is link_href, an artifact of tag choice — see
 * CLICK-TRACKING.md worked examples).
 */
const MARKUP = `<main>
  <div class="section">
    <div class="cta block tracking-demo" data-block-name="cta">
      <div><div><p class="button-wrapper"><a class="button" href="/demo1">Schedule a call</a></p></div></div>
      <div><div><p class="button-wrapper"><a class="button" href="/demo2">Schedule a call</a></p></div></div>
    </div>
  </div>
</main>`;

describe('parity: runtime reproduces the prod cta_block payload', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = MARKUP; });

  it('derived baseline alone matches prod core fields', () => {
    const main = document.querySelector('main');
    decorateTracking(main);
    const p = computeTrackingPayload(main.querySelector('a.button'));
    expect(p).toMatchObject({
      object: 'content',
      ui_object: 'button',
      ui_object_detail: 'Schedule a call',
      ui_action: 'clicked',
      action: 'interacted',
      ui_access_point: 'cta_block', // trail, anchor skipped
    });
    expect(p.custom_properties).toEqual({ link_name: 'button-schedule-a-call' });
  });

  it('both CTAs in the block resolve the cta_block access-point', () => {
    const main = document.querySelector('main');
    decorateTracking(main);
    const aps = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el).ui_access_point);
    expect(aps).toEqual(['cta_block', 'cta_block']);
  });
});

describe('parity: sheet overlay reproduces authored variants', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = MARKUP; });
  afterEach(() => vi.unstubAllGlobals());

  it('a wa-link row flips the first CTA to the prod wa-link payload', async () => {
    const data = [{ key: 'demo', cta: '1', 'wa-link': 'ies-nav:main-demo-cta' }];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })));
    const main = document.querySelector('main');
    decorateTracking(main);
    await applyTrackingSheet(main);
    const [first, second] = [...main.querySelectorAll('a.button')].map((el) => computeTrackingPayload(el));
    // CTA 1 -> wa-link path (prod nav CTA #1)
    expect(first.object).toBe('walink');
    expect(first.custom_properties).toEqual({ 'data-wa-link': 'ies-nav:main-demo-cta' });
    // CTA 2 -> still the derived full-path payload
    expect(second.object).toBe('content');
    expect(second.ui_object_detail).toBe('Schedule a call');
  });
});
