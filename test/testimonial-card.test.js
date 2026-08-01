import { describe, it, expect } from 'vitest';
import decorate from '../blocks/testimonial/testimonial.js';

function makeCard(rows = 1) {
  const block = document.createElement('div');
  block.className = 'testimonial card block';
  const row = `
    <div>
      <div><img src="https://erp.intuit.com/a.jpg" alt="Jasmine Pyles"></div>
      <div>“Accounting AI flagged a $6,000 discrepancy.”</div>
      <div>Jasmine Pyles</div>
      <div>VP of Finance, Tampa Bay EDC</div>
    </div>`;
  block.innerHTML = row.repeat(rows);
  return block;
}

describe('testimonial card variant', () => {
  it('renders a figure with photo, quote, name and title', () => {
    const block = makeCard();
    decorate(block);
    const fig = block.querySelector('figure.testimonial-card');
    expect(fig).not.toBeNull();
    expect(fig.querySelector('img.testimonial-photo').getAttribute('alt')).toBe('Jasmine Pyles');
    expect(fig.querySelector('blockquote').textContent).toContain('$6,000');
    expect(fig.querySelector('figcaption').textContent).toContain('Jasmine Pyles');
    expect(fig.querySelector('figcaption').textContent).toContain('VP of Finance, Tampa Bay EDC');
  });

  it('renders one figure per authored row', () => {
    const block = makeCard(3);
    decorate(block);
    expect(block.querySelectorAll('figure.testimonial-card').length).toBe(3);
  });

  it('handles missing cells gracefully (no photo, no title)', () => {
    const block = document.createElement('div');
    block.className = 'testimonial card block';
    block.innerHTML = `
      <div>
        <div></div>
        <div>Great product.</div>
        <div>Anonymous</div>
      </div>`;
    decorate(block);
    const fig = block.querySelector('figure.testimonial-card');
    expect(fig).not.toBeNull();
    expect(fig.querySelector('img.testimonial-photo')).toBeNull();
    expect(fig.querySelector('blockquote').textContent).toContain('Great product.');
    expect(fig.querySelector('figcaption').textContent).toContain('Anonymous');
  });

  it('does not affect the default (non-card) rendering path', () => {
    const block = document.createElement('div');
    block.className = 'testimonial block';
    block.innerHTML = `
      <div>
        <div><img src="mark.svg" alt=""></div>
        <div>Great quote.</div>
        <div>Jane Doe</div>
        <div>CFO</div>
        <div><img src="jane.jpg" alt="Jane Doe"></div>
      </div>`;
    decorate(block);
    expect(block.querySelector('.cmp-testi-grid')).not.toBeNull();
    expect(block.querySelector('figure.testimonial-card')).toBeNull();
  });
});
