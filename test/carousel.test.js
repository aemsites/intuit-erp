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

function makeSpotlight(n) {
  const block = document.createElement('div');
  block.className = 'carousel testimonial spotlight block';
  block.innerHTML = Array.from({ length: n }, (_, i) => `<div><div><p>Slide ${i}</p></div></div>`).join('');
  return block;
}

describe('carousel spotlight peek guard (1–2 slides must not collide)', () => {
  it('never marks the sole slide as is-prev/is-next with 1 slide', () => {
    const block = makeSpotlight(1);
    decorate(block);
    const slide = block.querySelector('.carousel-slide');
    expect(slide.classList.contains('is-active')).toBe(true);
    expect(slide.classList.contains('is-prev')).toBe(false);
    expect(slide.classList.contains('is-next')).toBe(false);
  });

  it('does not assign is-prev/is-next at all with 2 slides', () => {
    const block = makeSpotlight(2);
    decorate(block);
    const slides = [...block.querySelectorAll('.carousel-slide')];
    expect(slides.some((s) => s.classList.contains('is-prev') || s.classList.contains('is-next'))).toBe(false);
  });

  it('still peeks the neighbours with 3+ slides', () => {
    const block = makeSpotlight(3);
    decorate(block);
    const slides = [...block.querySelectorAll('.carousel-slide')];
    expect(slides.some((s) => s.classList.contains('is-prev'))).toBe(true);
    expect(slides.some((s) => s.classList.contains('is-next'))).toBe(true);
  });
});
