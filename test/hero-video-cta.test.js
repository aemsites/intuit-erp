import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

// hero.js -> fragment.js -> scripts.js, and scripts.js self-invokes loadPage() at
// import time against the real `document` — stub it so importing hero.js in
// isolation doesn't kick off the whole page-decoration pipeline.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { default: decorate } = await import('../blocks/hero/hero.js');

function makeHeroBlock() {
  const block = document.createElement('div');
  block.className = 'hero block';
  block.innerHTML = `
    <div><div>
      <p>THE AI-NATIVE ERP</p>
      <h1>Enterprise-grade finance built to scale</h1>
      <p>Close in days, consolidate in minutes without the legacy ERP overhead.</p>
      <p><strong><a href="https://www.youtube.com/watch?v=Lo798Iuj3N4">Watch product demo</a></strong> <em><a href="#schedule">Schedule a call</a></em></p>
    </div></div>
  `;
  return block;
}

describe('hero — video CTA', () => {
  afterEach(() => {
    document.querySelector('.video-modal-overlay')?.remove();
  });

  it('blocks navigation and opens the video lightbox when the YouTube CTA is clicked', async () => {
    const block = makeHeroBlock();
    await decorate(block);

    const link = block.querySelector('a[href*="youtube.com/watch"]');
    expect(link).not.toBeNull();
    expect(link.classList.contains('icon-video')).toBe(true);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const overlay = document.querySelector('.video-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('iframe').src).toBe('https://www.youtube.com/embed/Lo798Iuj3N4?autoplay=1&rel=0');
  });

  it('leaves the non-video CTA alone', async () => {
    const block = makeHeroBlock();
    await decorate(block);

    const scheduleLink = block.querySelector('a[href="#schedule"]');
    expect(scheduleLink).not.toBeNull();
    expect(scheduleLink.classList.contains('icon-video')).toBe(false);
  });
});
