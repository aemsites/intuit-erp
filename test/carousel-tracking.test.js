import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the carousel's spotlight-testimonial thumbnail chevrons. Prod
// tags the ‹/› controls with the authored id testimonial|thumbnail_{left,right}_chevron (+ a
// matching WA link), not the derived button/glyph. JIT-derived at pointerdown via
// trackAs({ payload }); only the .spotlight testimonial variant's chevrons are tagged.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/carousel/carousel.js');

function makeCarousel(variant) {
  const block = document.createElement('div');
  block.className = `carousel ${variant} block`;
  block.setAttribute('data-block-name', 'carousel');
  block.innerHTML = ''
    + '<div><div><picture><img src="/p1.png" alt="p1"></picture></div><div><p>“Quote one.” — Alice, CFO, Acme</p></div></div>'
    + '<div><div><picture><img src="/p2.png" alt="p2"></picture></div><div><p>“Quote two.” — Bob, CEO, Globex</p></div></div>'
    + '<div><div><picture><img src="/p3.png" alt="p3"></picture></div><div><p>“Quote three.” — Cara, COO, Initech</p></div></div>';
  return block;
}

function setup(variant) {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeCarousel(variant);
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('carousel — spotlight testimonial chevron tracking (JIT-derived)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('spotlight chevrons report testimonial|thumbnail_{left,right}_chevron + WA link', () => {
    const block = setup('testimonial spotlight');
    const prev = block.querySelector('.carousel-prev');
    const next = block.querySelector('.carousel-next');
    expect(prev).not.toBeNull();

    stampInteraction({ target: prev });
    let p = computeTrackingPayload(prev);
    expect(p.object).toBe('content');
    expect(p.object_detail).toBe('testimonial|thumbnail_left_chevron');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('testimonial|thumbnail_left_chevron');
    expect(p.action).toBe('interacted');
    expect(p.ui_action).toBe('clicked');
    expect(p['data-wa-link']).toBe('testimonial-thumbnail-left-chevron');

    stampInteraction({ target: next });
    p = computeTrackingPayload(next);
    expect(p.object_detail).toBe('testimonial|thumbnail_right_chevron');
    expect(p.ui_object_detail).toBe('testimonial|thumbnail_right_chevron');
    expect(p['data-wa-link']).toBe('testimonial-thumbnail-right-chevron');
  });

  it('non-spotlight carousel controls stay generic derives (deriver is spotlight-scoped)', () => {
    const block = setup('testimonial'); // no .spotlight
    const prev = block.querySelector('.carousel-prev');
    expect(prev).not.toBeNull();
    stampInteraction({ target: prev });
    expect(prev.getAttribute('data-object-detail')).toBeNull();
    expect(prev.getAttribute('data-wa-link')).toBeNull();
  });
});
