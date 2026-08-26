import { describe, it, expect } from 'vitest';
import decorate from '../blocks/testimonial/testimonial.js';

function makeDefault({ heading = '', headingTag = 'h3' } = {}) {
  const block = document.createElement('div');
  block.className = 'testimonial block';
  block.innerHTML = `
    <div>
      <div>
        ${heading ? `<${headingTag}>${heading}</${headingTag}>` : ''}
        <p>"Great product, would recommend."</p>
        <p><strong>Jane Doe</strong></p>
        <p>CFO, Acme Inc</p>
      </div>
      <div><img src="jane.jpg" alt="Jane Doe"></div>
    </div>`;
  return block;
}

describe('testimonial default (compare) variant', () => {
  it('renders quote, name and role with no heading present (baseline, no regression)', () => {
    const block = makeDefault();
    decorate(block);
    const grid = block.querySelector('.cmp-testi-grid');
    expect(grid).not.toBeNull();
    expect(grid.querySelector('.cmp-quote').textContent).toContain('Great product');
    expect(grid.querySelector('.cmp-quote-name').textContent).toBe('Jane Doe');
    expect(grid.querySelector('.cmp-quote-role').textContent).toBe('CFO, Acme Inc');
    expect(block.querySelector('.testimonial-heading')).toBeNull();
  });

  it('promotes a leading h3 heading in the content cell instead of dropping it', () => {
    const block = makeDefault({ heading: 'Intuit Enterprise Suite customers are saying' });
    decorate(block);
    const heading = block.querySelector('.testimonial-heading');
    expect(heading).not.toBeNull();
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Intuit Enterprise Suite customers are saying');
    // heading renders before the grid, and the quote itself is unaffected
    expect(block.firstElementChild).toBe(heading);
    expect(block.querySelector('.cmp-quote').textContent).toContain('Great product');
  });

  it('normalizes an authored h1/h2 heading down to h3 to avoid colliding with page heading hierarchy', () => {
    const block = makeDefault({ heading: 'Customers are saying', headingTag: 'h1' });
    decorate(block);
    const heading = block.querySelector('.testimonial-heading');
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Customers are saying');
  });

  it('does not treat a heading elsewhere in the cell (not the first element) as the block heading', () => {
    const block = document.createElement('div');
    block.className = 'testimonial block';
    block.innerHTML = `
      <div>
        <div>
          <p>"Great product, would recommend."</p>
          <h3>Not a real heading slot</h3>
          <p><strong>Jane Doe</strong></p>
        </div>
      </div>`;
    decorate(block);
    expect(block.querySelector('.testimonial-heading')).toBeNull();
  });
});
