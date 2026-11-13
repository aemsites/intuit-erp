import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// hero.js -> fragment.js -> scripts.js self-invokes loadPage() at import time; stub it.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { default: decorate } = await import('../blocks/hero/hero.js');

const ID = 'Lo798Iuj3N4';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;
const EMBED = `https://www.youtube.com/embed/${ID}?autoplay=1&rel=0`;

function mount(className, cell) {
  document.body.innerHTML = `<main><div class="section hero-container"><div class="hero-wrapper">
    <div class="${className}"><div><div>${cell}</div></div></div>
  </div></div></main>`;
  return document.querySelector('.hero');
}

const plain = (href, text = href) => `<p><a href="${href}">${text}</a></p>`;

describe('hero — ies video YouTube tile', () => {
  let compact;

  beforeEach(() => {
    compact = false;
    vi.stubGlobal('matchMedia', vi.fn((query) => ({
      matches: compact && query === '(width < 1024px)',
      addEventListener() {},
      removeEventListener() {},
    })));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders a plain watch link as a click-to-play tile', async () => {
    const block = mount('hero ies video block', `
      <h1>Close faster</h1>
      <p><picture><img src="/media/poster.jpg" alt=""></picture></p>
      ${plain(WATCH)}
    `);
    await decorate(block);

    const tile = block.querySelector('.hero-media-youtube');
    expect(tile).not.toBeNull();
    expect(tile.querySelector('img').getAttribute('src')).toBe('/media/poster.jpg');
    const play = tile.querySelector('button.hero-video-play[type=button]');
    expect(play.getAttribute('aria-label')).toMatch(/^Play video: /);
    expect(play.dataset.trackId).toBe(`hero:youtube-${ID}`);
    expect(tile.querySelector('iframe')).toBeNull();
    expect(tile.querySelector('video')).toBeNull();
    expect(block.querySelector(`.hero-copy a[href="${WATCH}"]`)).toBeNull();
  });

  it('loads the iframe only on click and focuses it', async () => {
    const block = mount('hero ies video block', `<h1>Close faster</h1>${plain(WATCH)}`);
    await decorate(block);

    const tile = block.querySelector('.hero-media-youtube');
    tile.querySelector('.hero-video-play').click();

    const iframes = tile.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
    const [iframe] = iframes;
    expect(iframe.getAttribute('src')).toBe(EMBED);
    expect(iframe.title).not.toBe('');
    expect(iframe.hasAttribute('allowfullscreen')).toBe(true);
    expect(document.activeElement).toBe(iframe);
  });

  it.each([
    ['youtu.be', `https://youtu.be/${ID}`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
  ])('renders a %s link as the tile', async (_, href) => {
    const block = mount('hero ies video block', `<h1>Close faster</h1>${plain(href)}`);
    await decorate(block);

    const play = block.querySelector('.hero-media-youtube .hero-video-play');
    expect(play.dataset.trackId).toBe(`hero:youtube-${ID}`);
  });

  it('falls back to the YouTube thumbnail without an authored poster', async () => {
    const block = mount('hero ies video block', `<h1>Close faster</h1>${plain(WATCH)}`);
    await decorate(block);

    expect(block.querySelector('.hero-media-youtube img').src)
      .toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it.each([false, true])('art-directs the second authored poster below 1024px (compact: %s)', async (isCompact) => {
    compact = isCompact;
    const block = mount('hero ies video block', `
      <h1>Close faster</h1>
      <p><picture><img src="/media/poster-desktop.jpg" alt=""></picture></p>
      <p><picture><img src="/media/poster-mobile.jpg" alt=""></picture></p>
      ${plain(WATCH)}
    `);
    await decorate(block);

    const pictures = block.querySelectorAll('.hero-media-youtube picture');
    expect(pictures).toHaveLength(1);
    const mobile = pictures[0].querySelector('source[media="(width < 1024px)"]');
    expect(mobile.getAttribute('srcset')).toBe('/media/poster-mobile.jpg');
    expect(pictures[0].querySelector('img').getAttribute('src')).toBe('/media/poster-desktop.jpg');
  });

  it('art-directs EDS pictures when the desktop poster shares the link paragraph', async () => {
    const eds = (name, alt) => `<picture>
      <source type="image/webp" srcset="./${name}?width=2000&amp;format=webply" media="(min-width: 600px)">
      <source type="image/webp" srcset="./${name}?width=750&amp;format=webply">
      <source type="image/png" srcset="./${name}?width=2000&amp;format=png" media="(min-width: 600px)">
      <img loading="lazy" alt="${alt}" src="./${name}?width=750&amp;format=png">
    </picture>`;
    const block = mount('hero ies video block', `
      <p>FOR CONSTRUCTIONS</p>
      <h1>Help protect your profits from bid to closeouts</h1>
      <p>Discover the financial platform for profitable construction.</p>
      <p><strong><a href="#schedule">Schedule a call</a></strong> <em><a href="https://erp.intuit.com/accountant/">For accountants</a></em></p>
      <p><a href="https://www.youtube.com/watch?v=C0DPdy98e4c">https://www.youtube.com/watch?v=C0DPdy98e4c</a><br>${eds('media_desktop.avif', 'thumbnail-construction')}</p>
      <p>${eds('media_mobile.png', '')}</p>
    `);
    await decorate(block);

    const tile = block.querySelector('.hero-media-youtube');
    const picture = tile.querySelector('picture');
    const mobile = [...picture.querySelectorAll('source')]
      .filter((s) => s.getAttribute('media')?.startsWith('(width < 1024px)'));
    expect(mobile.map((s) => s.getAttribute('srcset'))).toEqual([
      './media_mobile.png?width=2000&format=webply',
      './media_mobile.png?width=750&format=webply',
      './media_mobile.png?width=2000&format=png',
      './media_mobile.png?width=750&format=png',
    ]);
    expect(picture.querySelector('source').getAttribute('media'))
      .toBe('(width < 1024px) and (min-width: 600px)');
    expect(picture.querySelectorAll('img')).toHaveLength(1);
    expect(picture.querySelector('img').getAttribute('src')).toContain('media_desktop.avif');
    expect(picture.querySelector('img').loading).toBe('eager');
    expect(block.querySelector('.hero-copy img, .hero-copy br')).toBeNull();
  });

  it('titles the iframe from the link text, else the headline', async () => {
    let block = mount('hero ies video block', `<h1>Close faster</h1>${plain(WATCH, 'Product tour')}`);
    await decorate(block);
    block.querySelector('.hero-video-play').click();
    expect(block.querySelector('iframe').title).toBe('Product tour');

    block = mount('hero ies video block', `
      <h1>Close faster</h1>
      <p><picture><img src="/media/poster.jpg" alt=""></picture></p>
      ${plain(WATCH)}
    `);
    await decorate(block);
    block.querySelector('.hero-video-play').click();
    expect(block.querySelector('iframe').title).toBe('Close faster video');
  });

  it('keeps a bold YouTube CTA as a modal button beside the plain-link tile', async () => {
    const block = mount('hero ies video block', `
      <h1>Close faster</h1>
      <p><strong><a href="https://youtu.be/abcdef123">Watch product demo</a></strong></p>
      ${plain(WATCH)}
    `);
    await decorate(block);

    const cta = block.querySelector('.hero-actions button.icon-video');
    expect(cta.textContent).toBe('Watch product demo');
    expect(cta.dataset.trackId).toBe('hero:youtube-abcdef123');
    expect(block.querySelector('.hero-media-youtube .hero-video-play').dataset.trackId)
      .toBe(`hero:youtube-${ID}`);
  });

  it('leaves the homepage markup (italic YouTube CTA + mp4) unchanged', async () => {
    const block = mount('hero ies video arcs homepage block', `
      <h1>Grow beyond</h1>
      <p><picture><img src="/media/poster.jpg" alt=""></picture></p>
      <p><em><a href="${WATCH}">Watch product demo</a></em></p>
      <p><a href="/media/teaser.mp4">/media/teaser.mp4</a></p>
    `);
    await decorate(block);

    expect(block.querySelector('.hero-media-video video')).not.toBeNull();
    expect(block.querySelector('.hero-media-youtube')).toBeNull();
    expect(block.querySelector('.hero-actions button.icon-video')).not.toBeNull();
  });

  it('lets an mp4 win over a plain YouTube link', async () => {
    const block = mount('hero ies video block', `
      <h1>Close faster</h1>
      <p><a href="/media/teaser.mp4">/media/teaser.mp4</a></p>
      ${plain(WATCH)}
    `);
    await decorate(block);

    expect(block.querySelector('.hero-media-video video')).not.toBeNull();
    expect(block.querySelector('.hero-media-youtube')).toBeNull();
  });

  it('does not affect heroes without the video variant', async () => {
    const block = mount('hero ies block', `<h1>Close faster</h1>${plain(WATCH)}`);
    await decorate(block);

    expect(block.querySelector('.hero-media-youtube')).toBeNull();
  });
});
