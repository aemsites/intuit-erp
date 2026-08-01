import { describe, it, expect } from 'vitest';
import decorate, { activate } from '../blocks/vertical-scroll-carousel/vertical-scroll-carousel.js';

function make() {
  const block = document.createElement('div');
  block.className = 'vertical-scroll-carousel block';
  block.innerHTML = `
    <div><div><img src="1.png" alt=""></div><div>Single source of truth</div><div>Body one.</div></div>
    <div><div><img src="2.png" alt=""></div><div>Client reporting</div><div>Body two.</div></div>`;
  return block;
}

describe('vertical-scroll-carousel', () => {
  it('renders one .vsc-item per row', () => {
    const block = make();
    decorate(block);
    expect(block.querySelectorAll('.vsc-item').length).toBe(2);
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
    const video = block.querySelector('.vsc-item video');
    expect(video).not.toBeNull();
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.src).toBe('https://example.com/clip.mp4');
  });
});
