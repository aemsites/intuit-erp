import {
  describe, it, expect, beforeEach,
} from 'vitest';

const { default: decorate } = await import('../blocks/feature-grid/feature-grid.js');

// feature-grid authored shape: one row per card = [media cell, content cell]
// (see feature-grid.js JSDoc). `heading` is the authored title markup.
function makeFeatureGrid(heading) {
  const block = document.createElement('div');
  block.className = 'feature-grid block';
  block.innerHTML = `
    <div>
      <div><img src="/close.png" alt="Close management"></div>
      <div>
        <p><em>CLOSE MANAGEMENT</em></p>
        ${heading}
        <p>Close in days, not weeks.</p>
        <p><a href="/accounting">Find out more</a></p>
      </div>
    </div>`;
  document.body.append(block);
  return block;
}

describe('feature-grid — authored heading', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('preserves an authored h2 in preview and expanded states', () => {
    const block = makeFeatureGrid('<h2 id="close-in-days" class="custom">Close in <em>days</em></h2>');
    decorate(block);

    const preview = block.querySelector('.feature-preview .feature-title');
    expect(preview.tagName).toBe('H2');
    expect(preview.id).toBe('close-in-days');
    expect(preview.classList.contains('custom')).toBe(true);
    expect(preview.classList.contains('feature-title')).toBe(true);
    expect(preview.querySelector('em')?.textContent).toBe('days');

    const expanded = block.querySelector('.feature-expanded .feature-title');
    expect(expanded.tagName).toBe('H2');
    expect(expanded.hasAttribute('id')).toBe(false);
    expect(expanded.classList.contains('custom')).toBe(true);
    expect(expanded.querySelector('em')?.textContent).toBe('days');
  });

  it('keeps an authored h3 as h3', () => {
    const block = makeFeatureGrid('<h3 id="t">Title</h3>');
    decorate(block);

    const titles = [...block.querySelectorAll('.feature-title')];
    expect(titles).toHaveLength(2);
    titles.forEach((t) => expect(t.tagName).toBe('H3'));
  });

  it('does not hardcode h3 for other heading levels', () => {
    const block = makeFeatureGrid('<h4 id="four">Four</h4>');
    decorate(block);

    expect(block.querySelectorAll('h4.feature-title')).toHaveLength(2);
    expect(block.querySelectorAll('h3')).toHaveLength(0);
  });

  it('does not duplicate heading ids', () => {
    const block = makeFeatureGrid('<h2 id="close-in-days">Close in days</h2>');
    decorate(block);

    expect(document.querySelectorAll('#close-in-days')).toHaveLength(1);
  });

  it('renders no title when no heading is authored', () => {
    const block = makeFeatureGrid('');
    decorate(block);

    expect(block.querySelectorAll('.feature-title')).toHaveLength(0);
  });

  it('renders no title when the authored heading is empty', () => {
    const block = makeFeatureGrid('<h3 id="empty"> </h3>');
    decorate(block);

    expect(block.querySelectorAll('.feature-title')).toHaveLength(0);
  });
});
