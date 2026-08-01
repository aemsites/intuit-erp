import { describe, it, expect } from 'vitest';
import decorate from '../blocks/carousel/carousel.js';

function make(n) {
  const block = document.createElement('div');
  block.className = 'carousel block';
  block.innerHTML = Array.from({ length: n }, (_, i) => `<div><div><p>Slide ${i}</p></div></div>`).join('');
  return block;
}

describe('carousel', () => {
  it('creates a track with all slides, dots, and prev/next controls', () => {
    const block = make(3);
    decorate(block);
    expect(block.querySelectorAll('.carousel-slide').length).toBe(3);
    expect(block.querySelectorAll('.carousel-dots button').length).toBe(3);
    expect(block.querySelector('.carousel-prev')).not.toBeNull();
    expect(block.querySelector('.carousel-next')).not.toBeNull();
  });
  it('advances active slide on next', () => {
    const block = make(3);
    decorate(block);
    block.querySelector('.carousel-next').click();
    const slides = block.querySelectorAll('.carousel-slide');
    expect(slides[1].classList.contains('is-active')).toBe(true);
  });
  it('does not advance past the last slide', () => {
    const block = make(2);
    decorate(block);
    block.querySelector('.carousel-next').click();
    block.querySelector('.carousel-next').click();
    const slides = block.querySelectorAll('.carousel-slide');
    expect(slides[1].classList.contains('is-active')).toBe(true);
  });
});
