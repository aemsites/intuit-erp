import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the outcomes carousel's paging arrows. Prod tags them with a
// `scroll left`/`scroll right` detail + link_name, not the derived button/aria-label. Golden
// confirms `scroll right` (next); `scroll left` (prev) is the symmetric pair. JIT-derived at
// pointerdown via trackAs({ payload }); the outcome stats themselves are not CTAs.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/stat-band/stat-band.js');

function makeStatBand() {
  const block = document.createElement('div');
  block.className = 'stat-band block';
  block.setAttribute('data-block-name', 'stat-band');
  block.innerHTML = ''
    + '<div><div><p><strong>92%</strong></p><p>faster monthly close</p></div></div>'
    + '<div><div><p><strong>3x</strong></p><p>more forecasting speed</p></div></div>'
    + '<div><div><p><strong>40%</strong></p><p>less manual work</p></div></div>'
    + '<div><div><p><strong>5h</strong></p><p>saved per week</p></div></div>'
    + '<div><div><p><strong>2x</strong></p><p>faster reporting</p></div></div>';
  return block;
}

function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeStatBand();
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('stat-band — outcomes carousel arrow tracking (JIT-derived)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('paging arrows report scroll left / scroll right + link_name', () => {
    const block = setup();
    const prev = block.querySelector('.stats-arrow.prev');
    const next = block.querySelector('.stats-arrow.next');
    expect(next).not.toBeNull();

    stampInteraction({ target: next });
    let p = computeTrackingPayload(next);
    expect(p.object).toBe('content');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('scroll right');
    expect(p.action).toBe('interacted');
    expect(p.ui_action).toBe('clicked');
    expect(p.link_name).toBe('button-scroll-right');

    stampInteraction({ target: prev });
    p = computeTrackingPayload(prev);
    expect(p.ui_object_detail).toBe('scroll left');
    expect(p.link_name).toBe('button-scroll-left');
  });
});
