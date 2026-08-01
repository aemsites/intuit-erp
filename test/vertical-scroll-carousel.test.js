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
});
