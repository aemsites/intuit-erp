import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorate, { activate } from '../blocks/vertical-scroll-carousel/vertical-scroll-carousel.js';

/**
 * The block reads matchMedia('(min-width: 900px)') to decide whether the media
 * share one stage (desktop, only the active video plays) or render inline per
 * item (mobile, all play). jsdom has no matchMedia, so fake a width.
 */
function setViewport(width) {
  window.matchMedia = (query) => {
    const min = /width\s*:\s*(\d+)px/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  };
}

function make() {
  const block = document.createElement('div');
  block.className = 'vertical-scroll-carousel block';
  block.innerHTML = `
    <div><div><img src="1.png" alt=""></div><div>Single source of truth</div><div>Body one.</div></div>
    <div><div><img src="2.png" alt=""></div><div>Client reporting</div><div>Body two.</div></div>`;
  return block;
}

describe('vertical-scroll-carousel', () => {
  beforeEach(() => setViewport(1440));

  it('renders one .vsc-item per row inside a tablist', () => {
    const block = make();
    decorate(block);
    const list = block.querySelector('.vsc-list');
    expect(list.getAttribute('role')).toBe('tablist');
    expect(block.querySelectorAll('.vsc-item').length).toBe(2);
  });
  it('renders each heading as a clickable tab button', () => {
    const block = make();
    decorate(block);
    const headings = [...block.querySelectorAll('.vsc-heading')];
    expect(headings.length).toBe(2);
    headings.forEach((h) => {
      expect(h.tagName).toBe('BUTTON');
      expect(h.getAttribute('role')).toBe('tab');
    });
  });
  it('renders every item body (CSS collapses the inactive ones)', () => {
    const block = make();
    decorate(block);
    const bodies = [...block.querySelectorAll('.vsc-body')];
    expect(bodies.length).toBe(2);
    expect(bodies[0].textContent).toBe('Body one.');
    expect(bodies[1].textContent).toBe('Body two.');
  });
  it('exposes the accordion state via aria-expanded on each heading', () => {
    const block = make();
    decorate(block);
    const headings = [...block.querySelectorAll('.vsc-heading')];
    expect(headings.map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    headings[1].click();
    expect(headings.map((h) => h.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  });
  it('pairs each item with its media via --vsc-i so mobile CSS can interleave', () => {
    const block = make();
    decorate(block);
    const items = [...block.querySelectorAll('.vsc-item')];
    const medias = [...block.querySelectorAll('.vsc-media')];
    expect(items.map((i) => i.style.getPropertyValue('--vsc-i'))).toEqual(['0', '1']);
    expect(medias.map((m) => m.style.getPropertyValue('--vsc-i'))).toEqual(['0', '1']);
  });
  it('clicking anywhere on the card activates it, not just the heading', () => {
    const block = make();
    decorate(block);
    const items = [...block.querySelectorAll('.vsc-item')];
    items[1].querySelector('.vsc-body').click();
    expect(items[1].classList.contains('is-active')).toBe(true);
    expect(items[0].classList.contains('is-active')).toBe(false);
  });
  it('renders a single shared .vsc-stage with one .vsc-media per row', () => {
    const block = make();
    decorate(block);
    expect(block.querySelectorAll('.vsc-stage').length).toBe(1);
    expect(block.querySelectorAll('.vsc-stage .vsc-media').length).toBe(2);
    // media lives in the shared stage, not inside the copy items
    expect(block.querySelectorAll('.vsc-item .vsc-media').length).toBe(0);
  });
  it('activates the first tab and its media by default', () => {
    const block = make();
    decorate(block);
    const items = [...block.querySelectorAll('.vsc-item')];
    const medias = [...block.querySelectorAll('.vsc-media')];
    const headings = [...block.querySelectorAll('.vsc-heading')];
    expect(items[0].classList.contains('is-active')).toBe(true);
    expect(medias[0].classList.contains('is-active')).toBe(true);
    expect(medias[1].classList.contains('is-active')).toBe(false);
    expect(headings[0].getAttribute('aria-selected')).toBe('true');
    expect(headings[1].getAttribute('aria-selected')).toBe('false');
  });
  it('clicking a tab activates that tab and swaps the media', () => {
    const block = make();
    decorate(block);
    const items = [...block.querySelectorAll('.vsc-item')];
    const medias = [...block.querySelectorAll('.vsc-media')];
    const headings = [...block.querySelectorAll('.vsc-heading')];

    headings[1].click();

    expect(items[1].classList.contains('is-active')).toBe(true);
    expect(items[0].classList.contains('is-active')).toBe(false);
    expect(medias[1].classList.contains('is-active')).toBe(true);
    expect(medias[0].classList.contains('is-active')).toBe(false);
    expect(headings[1].getAttribute('aria-selected')).toBe('true');
  });
  it('activate() marks only the given index active', () => {
    const block = make();
    decorate(block);
    const items = [...block.querySelectorAll('.vsc-item')];
    activate(items, 1);
    expect(items[0].classList.contains('is-active')).toBe(false);
    expect(items[1].classList.contains('is-active')).toBe(true);
  });
  it('a video-file link cell0 (no img/picture) renders an autoplay/muted/loop video', () => {
    const block = document.createElement('div');
    block.className = 'vertical-scroll-carousel block';
    block.innerHTML = `
      <div><div><a href="https://example.com/clip.mp4">Watch</a></div><div>Change orders, no paper trail</div><div>Body.</div></div>`;
    decorate(block);
    const video = block.querySelector('.vsc-stage video');
    expect(video).not.toBeNull();
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.src).toBe('https://example.com/clip.mp4');
  });
});
