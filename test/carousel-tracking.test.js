import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the carousel's spotlight-testimonial thumbnail chevrons. Prod
// tags the ‹/› controls with the authored id testimonial|thumbnail_{left,right}_chevron (+ a
// matching WA link), not the derived button/glyph. JIT-derived at pointerdown via
// trackAs({ payload }); only the .spotlight testimonial variant's chevrons are tagged.
import {
  initTracking, resetTrackingState, stampInteraction, trackIdOf,
} from '../scripts/tracking.js';
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
    expect(trackIdOf(prev)).toBe('testimonial:previous-slide');
    expect(trackIdOf(next)).toBe('testimonial:next-slide');

    stampInteraction({ target: prev });
    let p = computeTrackingPayload(prev);
    expect(p.object).toBe('content');
    expect(p.object_detail).toBe('testimonial|thumbnail_left_chevron');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('testimonial|thumbnail_left_chevron');
    expect(p.action).toBe('interacted');
    expect(p.ui_action).toBe('clicked');
    expect(p['data-wa-link']).toBe('testimonial-thumbnail-left-chevron');
    // controls report `page` — the rw_testimonial trail rides the slide track, not the block
    expect(p.ui_access_point).toBe('page');

    stampInteraction({ target: next });
    p = computeTrackingPayload(next);
    expect(p.object_detail).toBe('testimonial|thumbnail_right_chevron');
    expect(p.ui_object_detail).toBe('testimonial|thumbnail_right_chevron');
    expect(p['data-wa-link']).toBe('testimonial-thumbnail-right-chevron');
    expect(p.ui_access_point).toBe('page');
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

// A .testimonial carousel IS prod's rw_testimonial component (customer proof): slide CTAs report
// rw_testimonial|rw_testimonial_item and key off testimonial:<id> so the sheet's authored link_name
// resolves. Every other variant stays a generic loose derive (ui_access_point=page on its controls).
function makeCtaCarousel(variant) {
  const block = document.createElement('div');
  block.className = `carousel ${variant} block`;
  block.setAttribute('data-block-name', 'carousel');
  block.innerHTML = `
    <div><div><h3>Customer one</h3><p>Great results.</p><p class="button-container"><a class="button" href="/case-one">View the results</a></p></div></div>
    <div><div><h3>Customer two</h3><p>More results.</p><p class="button-container"><a class="button" href="/case-two">View the results</a></p></div></div>`;
  return block;
}

function setupCta(variant) {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeCtaCarousel(variant);
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('carousel — testimonial variant slide-CTA trail (rw_testimonial)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('a testimonial slide CTA resolves rw_testimonial|rw_testimonial_item + keys off testimonial:<id>', () => {
    const block = setupCta('carousel testimonial');
    const cta = block.querySelector('.carousel-slide a.button');
    expect(cta).not.toBeNull();
    stampInteraction({ target: cta });
    expect(computeTrackingPayload(cta).ui_access_point).toBe('rw_testimonial|rw_testimonial_item');
    // href-based id; the label fallback resolves the sheet's testimonial:view-the-results row
    expect(trackIdOf(cta).startsWith('testimonial:')).toBe(true);
  });

  it('a non-testimonial carousel stays a generic loose derive (no trail -> page)', () => {
    const block = setupCta('carousel');
    const cta = block.querySelector('.carousel-slide a.button');
    expect(cta).not.toBeNull();
    stampInteraction({ target: cta });
    expect(computeTrackingPayload(cta).ui_access_point).toBe('page');
    expect(trackIdOf(cta).startsWith('carousel:')).toBe(true);
  });
});
