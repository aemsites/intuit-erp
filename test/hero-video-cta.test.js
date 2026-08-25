import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
// The delegated runtime that JIT-stamps the tracking data-*, plus the replica that
// reads back the payload the injected prod tracker WOULD send (the replica is
// validated against the real tracker on prod — see tracker-replica.mjs). Neither
// imports scripts.js, so they're safe to load statically alongside the mock below.
import { initTracking, resetTrackingState } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

// hero.js -> fragment.js -> scripts.js, and scripts.js self-invokes loadPage() at
// import time against the real `document` — stub it so importing hero.js in
// isolation doesn't kick off the whole page-decoration pipeline.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { default: decorate } = await import('../blocks/hero/hero.js');

// The pinned prod capture (real Chrome, eventbus /t intercepted+aborted). The
// homepage hero "Watch product demo" CTA is the parity target for this block.
const golden = JSON.parse(readFileSync('scripts/diff/fixtures/clicktrack-homepage.golden.json', 'utf8'));
const goldenVideoCta = golden.pages
  .find((p) => p.path === '/').events
  .find((e) => e.name === 'video-watch-product-demo').expected;
// link_name carries a runtime ` [host]` suffix (erp.intuit.com on prod, the jsdom
// host here); compare host-free, the way the parity gate does.
const stripHost = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);

function makeHeroBlock() {
  const block = document.createElement('div');
  block.className = 'hero block';
  block.innerHTML = `
    <div><div>
      <p>THE AI-NATIVE ERP</p>
      <h1>Enterprise-grade finance built to scale</h1>
      <p>Close in days, consolidate in minutes without the legacy ERP overhead.</p>
      <p><strong><a href="https://www.youtube.com/watch?v=Lo798Iuj3N4">Watch product demo</a></strong> <em><a href="#schedule">Schedule a call</a></em></p>
    </div></div>
  `;
  return block;
}

describe('hero — video CTA', () => {
  afterEach(() => {
    document.querySelector('.video-modal-overlay')?.remove();
  });

  it('blocks navigation and opens the video lightbox when the YouTube CTA is clicked', async () => {
    const block = makeHeroBlock();
    await decorate(block);

    const link = block.querySelector('a[data-track-id="hero:youtube-Lo798Iuj3N4"]');
    expect(link).not.toBeNull();
    expect(link.classList.contains('icon-video')).toBe(true);
    // href stays real until the moment of interaction, so scripts/tracking.js's
    // pointerdown/keydown-time read (which happens before any click) still
    // classifies this as a video link.
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=Lo798Iuj3N4');

    link.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // neutralized synchronously on pointerdown, strictly before 'click' — a 3rd-party
    // outbound-click martech handler keyed on a[href*="youtube.com"] sees nothing.
    expect(link.getAttribute('href')).toBe('#');

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const overlay = document.querySelector('.video-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('iframe').src).toBe('https://www.youtube.com/embed/Lo798Iuj3N4?autoplay=1&rel=0');

    // restored shortly after so a later interaction is classified correctly too
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=Lo798Iuj3N4');
  });

  it('leaves the non-video CTA alone', async () => {
    const block = makeHeroBlock();
    await decorate(block);

    const scheduleLink = block.querySelector('a[href="#schedule"]');
    expect(scheduleLink).not.toBeNull();
    expect(scheduleLink.classList.contains('icon-video')).toBe(false);
  });
});

// Runs the real hero.js decorate() + delegated runtime and diffs the emitted beacon
// against the homepage golden (the derive-only checks elsewhere hand-build the DOM,
// so they can't catch a regression in the real block wiring).
describe('hero — video CTA click-tracking parity (homepage "Watch product demo")', () => {
  beforeEach(() => {
    resetTrackingState();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // no /tracking.json in the test -> pure derive (this CTA is derive-covered)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
  });
  afterEach(() => {
    document.querySelector('.video-modal-overlay')?.remove();
    vi.unstubAllGlobals();
  });

  // Real hero + delegated runtime in a <main> — the production wiring.
  async function mountHero() {
    const main = document.createElement('main');
    const block = makeHeroBlock();
    main.append(block);
    document.body.append(main);
    await decorate(block);
    initTracking(main);
    return block.querySelector('a.icon-video');
  }

  it('emits the prod video:engaged beacon on a real delegated interaction', async () => {
    const link = await mountHero();
    expect(link, 'the YouTube CTA is decorated as a video link').not.toBeNull();
    // stable, source-based sheet key from the video id
    expect(link.getAttribute('data-track-id')).toBe('hero:youtube-Lo798Iuj3N4');

    // capture-phase handler stamps off the still-real href, before hero.js neutralizes it
    link.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const payload = computeTrackingPayload(link); // what the injected tracker would send

    // every DOM-derivable per-click field matches prod; link_name compared host-free
    ['event', 'object', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point'].forEach((f) => {
      expect(payload[f], `field ${f}`).toBe(goldenVideoCta[f]);
    });
    expect(stripHost(payload.link_name)).toBe(stripHost(goldenVideoCta.link_name));

    // page-flat: a video link has no sacrificial anchor, so the rw2_hero trail is consumed
    expect(goldenVideoCta.ui_access_point).toBe('page');
    expect(payload.ui_access_point).toBe('page');
  });

  it('keeps the video classification through href neutralization (ordering holds with the runtime live)', async () => {
    const link = await mountHero();
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=Lo798Iuj3N4');

    link.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // inert before any click handler (incl. a 3rd-party outbound hijacker) reads it
    expect(link.getAttribute('href')).toBe('#');
    // but the derive already ran on the real href -> still classified as a video link
    expect(link.getAttribute('data-object')).toBe('video');
    expect(link.getAttribute('data-ui-object')).toBe('video_link');
    expect(link.getAttribute('data-action')).toBe('engaged');

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector('.video-modal-overlay')).not.toBeNull();

    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=Lo798Iuj3N4');
  });
});
