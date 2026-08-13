import { describe, it, expect, vi } from 'vitest';
import decorate from '../blocks/testimonial/testimonial.js';

/**
 * The .video-split row is positional: 1 poster, 2 video URL, 3 heading, 4 body.
 * buildVideoSplit is not exported, so these go through decorate() — which also
 * pins the variant dispatch (video-split must not fall through to .video or the
 * default compare-quote layout).
 */
function block(html, variant = 'video-split') {
  const el = document.createElement('div');
  el.className = `testimonial ${variant} block`;
  el.innerHTML = `<div>${html}</div>`;
  return el;
}

const FULL = `
  <div><picture><img src="/jason.jpg" alt="Jason Corby"></picture>Jason Corby, Founder and CFO</div>
  <div><a href="https://www.youtube.com/embed/Wk8JSGDOvx8?rel=0">https://www.youtube.com/embed/Wk8JSGDOvx8?rel=0</a></div>
  <div><h2 id="streamlining">Streamlining for business growth</h2></div>
  <div>Consolidating reports made it easier to grow.</div>`;

describe('testimonial .video-split', () => {
  it('builds a two-column grid with copy before media', () => {
    const el = block(FULL);
    decorate(el);
    const grid = el.querySelector('.split-grid');
    expect(grid).not.toBeNull();
    expect([...grid.children].map((c) => c.className)).toEqual(['split-copy', 'split-media']);
  });

  it('takes the heading text from an authored heading element', () => {
    const el = block(FULL);
    decorate(el);
    const title = el.querySelector('.split-title');
    expect(title.tagName).toBe('H2');
    expect(title.textContent).toBe('Streamlining for business growth');
  });

  it('falls back to the cell text when no heading element is authored', () => {
    const el = block(`
      <div><img src="/j.jpg"></div><div>https://youtu.be/Wk8JSGDOvx8</div>
      <div>Plain text heading</div><div>Body.</div>`);
    decorate(el);
    expect(el.querySelector('.split-title').textContent).toBe('Plain text heading');
  });

  it('does not render the attribution — upstream omits it from this band', () => {
    const el = block(FULL);
    decorate(el);
    expect(el.textContent).not.toMatch(/Founder and CFO/);
  });

  it('wires the play button to the authored YouTube id', () => {
    const el = block(FULL);
    decorate(el);
    const play = el.querySelector('.split-play');
    expect(play).not.toBeNull();
    expect(play.type).toBe('button');
    expect(play.getAttribute('aria-label')).toBe('Play full video');
  });

  it('accepts a bare video id, as the .video variant does', () => {
    const el = block(`
      <div><img src="/j.jpg"></div><div>Wk8JSGDOvx8</div>
      <div>Heading</div><div>Body.</div>`);
    decorate(el);
    expect(el.querySelector('.split-play')).not.toBeNull();
  });

  it('warns instead of silently dropping the play button on a non-YouTube URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = block(`
      <div><img src="/j.jpg"></div><div><a href="https://vimeo.com/123456">v</a></div>
      <div>Heading</div><div>Body.</div>`);
    decorate(el);
    expect(el.querySelector('.split-play')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('video-split'), 'https://vimeo.com/123456');
    warn.mockRestore();
  });

  it('degrades without throwing when cells are missing', () => {
    expect(() => decorate(block('<div><img src="/j.jpg"></div>'))).not.toThrow();
    expect(() => decorate(block(''))).not.toThrow();
  });

  it('does not fall through to the .video or compare-quote layouts', () => {
    const el = block(FULL);
    decorate(el);
    expect(el.querySelector('.video-frame')).toBeNull();
    expect(el.querySelector('.cmp-testi-grid')).toBeNull();
  });
});
