import { describe, it, expect } from 'vitest';
import decorate from '../blocks/logo-grid/logo-grid.js';

describe('logo-grid', () => {
  it('renders one list item per logo row', () => {
    const block = document.createElement('div');
    block.className = 'logo-grid block';
    block.innerHTML = '<div><div><img src="aprio.png" alt="Aprio"></div></div><div><div><img src="rehmann.png" alt="Rehmann"></div></div>';
    decorate(block);
    expect(block.querySelectorAll('ul.logo-grid-list > li').length).toBe(2);
    expect(block.querySelector('li img').getAttribute('alt')).toBe('Aprio');
  });

  it('preserves picture elements in list items', () => {
    const block = document.createElement('div');
    block.className = 'logo-grid block';
    block.innerHTML = '<div><div><picture><img src="aprio.png" alt="Aprio"></picture></div></div><div><div><a href="#">And many more</a></div></div>';
    decorate(block);
    expect(block.querySelectorAll('ul.logo-grid-list > li').length).toBe(2);
    expect(block.querySelector('li picture')).not.toBeNull();
    expect(block.querySelector('li picture img').getAttribute('alt')).toBe('Aprio');
    expect(block.querySelectorAll('li')[1].querySelector('a').textContent).toBe('And many more');
  });
});
