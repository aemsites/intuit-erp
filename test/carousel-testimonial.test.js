import { describe, it, expect, beforeEach } from 'vitest';
import decorate from '../blocks/carousel/carousel.js';

// the three shapes authors have actually produced for this block
const FOUR_CELL = `<div>
  <div><picture><img src="a.jpg" alt="Blake"></picture></div>
  <div>“Quote text”</div>
  <div>Blake Rohm, Director of Finance, Lallier</div>
  <div><a href="https://www.youtube.com/watch?v=Wk8JSGDOvx8">Watch video</a></div>
</div>`;

const ONE_CELL_NO_TITLE = `<div><div>
  <p>“Quote text”</p>
  <p><picture><img src="a.jpg" alt="Sharon"></picture></p>
  <p><strong>Sharon Ourian</strong><br>Ourian Investments</p>
</div></div>`;

const ONE_CELL_TITLED = `<div><div>
  <h3>Connected data for better decisions</h3>
  <p>“Quote text”</p>
  <p><picture><img src="a.jpg" alt="Josh"></picture></p>
  <p><strong>Josh Daneshforooz</strong><br>Co-Founder, Lango</p>
</div></div>`;

function make(html, extraClass = '') {
  const block = document.createElement('div');
  block.className = `carousel testimonial block ${extraClass}`.trim();
  block.innerHTML = html;
  return block;
}

describe('carousel.testimonial normalizer', () => {
  beforeEach(() => {
    window.hlx = { codeBasePath: '' };
  });

  it('reads the four-cell shape into media, quote, attribution and CTA', () => {
    const block = make(FOUR_CELL);
    decorate(block);
    const slide = block.querySelector('.carousel-slide');
    expect(slide.querySelector('.testi-media img')).not.toBeNull();
    expect(slide.querySelector('.testi-quote').textContent).toContain('Quote text');
    expect(slide.querySelector('.testi-attr').textContent).toContain('Blake Rohm');
    expect(slide.querySelector('.testi-cta-button')).not.toBeNull();
  });

  it('reads the single-cell shape, where image and text share one cell', () => {
    const block = make(ONE_CELL_NO_TITLE);
    decorate(block);
    const slide = block.querySelector('.carousel-slide');
    expect(slide.querySelector('.testi-media img')).not.toBeNull();
    expect(slide.querySelector('.testi-quote').textContent).toContain('Quote text');
    expect(slide.querySelector('.testi-attr').textContent).toContain('Sharon Ourian');
  });

  it('reads a heading as the title and flags the block', () => {
    const block = make(ONE_CELL_TITLED);
    decorate(block);
    expect(block.classList.contains('has-title')).toBe(true);
    expect(block.querySelector('.testi-title').textContent).toBe('Connected data for better decisions');
    expect(block.querySelector('.testi-quote').textContent).toContain('Quote text');
  });

  it('leaves has-title off when no slide has a heading', () => {
    const block = make(ONE_CELL_NO_TITLE + FOUR_CELL);
    decorate(block);
    expect(block.classList.contains('has-title')).toBe(false);
  });

  it('turns a video CTA into a button that opens a modal, not a link', () => {
    const block = make(FOUR_CELL);
    decorate(block);
    const btn = block.querySelector('.testi-cta-button');
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    const iframe = document.querySelector('.video-modal-overlay iframe');
    expect(iframe.src).toContain('youtube.com/embed/Wk8JSGDOvx8');
    document.querySelector('.video-modal-overlay').remove();
  });

  it('keeps a non-video CTA as a plain link', () => {
    const block = make(`<div>
      <div><picture><img src="a.jpg" alt="x"></picture></div>
      <div>“Quote”</div>
      <div>Name, Company</div>
      <div><a href="/case-study">Read the story</a></div>
    </div>`);
    decorate(block);
    const cta = block.querySelector('.testi-cta-button');
    expect(cta.tagName).toBe('A');
    expect(cta.getAttribute('href')).toBe('/case-study');
  });

  it('renders a slide with no image, no attribution and no CTA', () => {
    const block = make('<div><div><p>“Quote only”</p></div></div>');
    decorate(block);
    const slide = block.querySelector('.carousel-slide');
    expect(slide.querySelector('.testi-quote').textContent).toContain('Quote only');
    expect(slide.querySelector('.testi-attr')).toBeNull();
    expect(slide.querySelector('.testi-cta-button')).toBeNull();
    expect(slide.querySelector('.testi-media').children.length).toBe(0);
  });

  it('keeps a multi-paragraph quote together and treats only the last block as attribution', () => {
    const block = make(`<div><div>
      <p>First half of the quote.</p>
      <p>Second half of the quote.</p>
      <p>Name, Company</p>
    </div></div>`);
    decorate(block);
    const quotes = block.querySelectorAll('.testi-quote');
    expect(quotes.length).toBe(2);
    expect(block.querySelector('.testi-attr').textContent).toBe('Name, Company');
  });

  it('leaves the .feature variant markup alone', () => {
    const block = document.createElement('div');
    block.className = 'carousel feature block';
    block.innerHTML = '<div><div><picture><img src="a.jpg" alt="x"></picture></div><div><p>“Quote” — Name, Role</p></div></div>';
    decorate(block);
    expect(block.querySelector('.testi-body')).toBeNull();
    expect(block.querySelector('.carousel-quote')).not.toBeNull();
  });
});
