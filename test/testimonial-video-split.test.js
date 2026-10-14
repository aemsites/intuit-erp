import {
  describe, it, expect, vi,
} from 'vitest';
import decorate from '../blocks/testimonial/testimonial.js';
import { openVideoModal } from '../scripts/scripts.js';

vi.mock('../scripts/scripts.js', () => ({ openVideoModal: vi.fn() }));

/**
 * The .video-split row is positional: 1 media (poster + optional caption line),
 * 2 content (heading + body), 3 video URL/id. buildVideoSplit is not exported,
 * so these go through decorate() — which also pins the variant dispatch
 * (video-split must not fall through to .video or the default compare-quote
 * layout).
 */
function block(html, variant = 'video-split') {
  const el = document.createElement('div');
  el.className = `testimonial ${variant} block`;
  el.innerHTML = `<div>${html}</div>`;
  return el;
}

// mirrors /professional-services/ as authored on production
const FULL = `
  <div><picture><img src="/jason.jpg" alt="Jason Corby, Founder and CFO of HFMM Legacy Group"></picture></div>
  <div><h2 id="streamlining">Streamlining for business growth</h2><p>Consolidating reports made it easier to grow.</p></div>
  <div><a href="https://www.youtube.com/embed/Wk8JSGDOvx8?rel=0&autoplay=1">https://www.youtube.com/embed/Wk8JSGDOvx8?rel=0&autoplay=1</a></div>`;

const CONTENT = '<div><h2>Heading</h2><p>Body.</p></div>';

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
    expect(el.querySelector('.split-body').textContent).toBe('Consolidating reports made it easier to grow.');
  });

  it('renders no title when no heading element is authored, and still renders the body', () => {
    const el = block(`
      <div><img src="/j.jpg"></div><div><p>Body.</p></div>
      <div>https://youtu.be/Wk8JSGDOvx8</div>`);
    decorate(el);
    expect(el.querySelector('.split-title')).toBeNull();
    const bodies = el.querySelectorAll('.split-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].textContent).toBe('Body.');
  });

  it('renders no caption when the media cell holds only the picture', () => {
    const el = block(FULL);
    decorate(el);
    expect(el.querySelector('.split-caption')).toBeNull();
    expect(el.textContent).not.toMatch(/Founder and CFO/);
  });

  it('renders a caption from text authored after the picture', () => {
    const el = block(`
      <div><picture><img src="/jason.jpg" alt=""></picture>Jason Corby, Founder and CFO</div>
      ${CONTENT}
      <div>Wk8JSGDOvx8</div>`);
    decorate(el);
    expect(el.querySelector('.split-caption').textContent).toBe('Jason Corby, Founder and CFO');
  });

  it('wires the play button to the authored YouTube id', () => {
    const el = block(FULL);
    decorate(el);
    const play = el.querySelector('.split-play');
    expect(play).not.toBeNull();
    expect(play.type).toBe('button');
    expect(play.getAttribute('aria-label')).toBe('Play full video');
    play.click();
    expect(openVideoModal).toHaveBeenCalledWith(
      'https://www.youtube.com/embed/Wk8JSGDOvx8?autoplay=1&rel=0',
      'Customer story video',
    );
  });

  it('accepts a bare video id, as the .video variant does', () => {
    const el = block(`
      <div><img src="/j.jpg"></div>${CONTENT}
      <div>Wk8JSGDOvx8</div>`);
    decorate(el);
    expect(el.querySelector('.split-play')).not.toBeNull();
  });

  it('warns instead of silently dropping the play button on a non-YouTube URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = block(`
      <div><img src="/j.jpg"></div>${CONTENT}
      <div><a href="https://vimeo.com/123456">v</a></div>`);
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
