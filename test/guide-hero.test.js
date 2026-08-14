import { describe, it, expect } from 'vitest';
import decorate from '../blocks/guide-hero/guide-hero.js';

// Mirrors what buildGuideHeroAutoBlock (scripts.js) hands over: one row, one
// cell, holding section 1's authored flow verbatim.
const blockWith = (inner) => {
  const block = document.createElement('div');
  block.className = 'guide-hero';
  block.innerHTML = `<div><div>${inner}</div></div>`;
  return block;
};

describe('guide-hero decorate', () => {
  it('splits the authored flow into a media half and a copy half, media first', () => {
    const block = blockWith(`
      <h1>Construction accounting: Using an ERP</h1>
      <p>See how large construction firms can modernize operations.</p>
      <p><picture><img src="hero.jpg" alt="A person in a suit"></picture></p>
    `);

    decorate(block);

    expect([...block.children].map((c) => c.className))
      .toEqual(['guide-hero-media', 'guide-hero-copy']);
    expect(block.querySelector('.guide-hero-media picture img')).toBeTruthy();
    expect(block.querySelector('.guide-hero-copy h1').textContent)
      .toBe('Construction accounting: Using an ERP');
    expect(block.querySelector('.guide-hero-copy p').textContent)
      .toContain('modernize operations');
    // the image must not be left behind in the copy column
    expect(block.querySelector('.guide-hero-copy picture, .guide-hero-copy img')).toBeNull();
  });

  it('removes the emptied paragraph that wrapped the image', () => {
    const block = blockWith('<h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    // only the headline remains in the copy column — no leftover empty <p>,
    // which would still carry the global paragraph margin
    expect(block.querySelectorAll('.guide-hero-copy p').length).toBe(0);
    expect(block.querySelector('.guide-hero-copy h1')).toBeTruthy();
  });

  it('keeps a lede paragraph that shares its cell with the image', () => {
    const block = blockWith('<h1>Headline</h1><p>Lede copy.<picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    expect(block.querySelector('.guide-hero-media img')).toBeTruthy();
    expect(block.querySelector('.guide-hero-copy p').textContent).toBe('Lede copy.');
  });

  it('loads the hero image eagerly — it is the LCP element on these pages', () => {
    const block = blockWith('<h1>Headline</h1><p><picture><img src="hero.jpg" loading="lazy"></picture></p>');
    decorate(block);
    expect(block.querySelector('.guide-hero-media img').getAttribute('loading')).toBe('eager');
  });

  it('carries an authored CTA into the copy column', () => {
    // decorateButtons turns <em><a> into a.button.secondary later; the block only
    // has to keep the paragraph on the copy side
    const block = blockWith('<h1>Headline</h1><p><em><a href="#download">Get the free white paper</a></em></p><p><picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    const cta = block.querySelector('.guide-hero-copy a[href="#download"]');
    expect(cta).toBeTruthy();
    expect(cta.textContent).toBe('Get the free white paper');
  });

  it('still builds a copy half when no image is present', () => {
    // the autoblock will not create the block in this case, but the block must
    // not throw if it is ever authored by hand
    const block = blockWith('<h1>Headline only</h1>');
    decorate(block);
    expect(block.querySelector('.guide-hero-copy h1')).toBeTruthy();
    expect(block.querySelector('.guide-hero-media').children.length).toBe(0);
  });
});
