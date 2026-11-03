import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// hero.js -> fragment.js -> scripts.js self-invokes loadPage() at import time; stub it.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { default: decorate } = await import('../blocks/hero/hero.js');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const VIDEO_BG_CELL = `
  <p>DATA REPORT</p>
  <h1>See where your business stands</h1>
  <p>Real-time reporting across every entity.</p>
  <p><picture><img src="/media/poster-desktop.jpg" alt=""></picture></p>
  <p><picture><img src="/media/poster-mobile.jpg" alt=""></picture></p>
  <p><a href="/media/bg-desktop.mp4">/media/bg-desktop.mp4</a> <a href="/media/bg-mobile.mp4">/media/bg-mobile.mp4</a></p>
  <p><strong><a href="/demo">Get a demo</a></strong> <em><a href="#schedule">Schedule a call</a></em></p>
`;

function mount(className, cell) {
  document.body.innerHTML = `<main><div class="section hero-container"><div class="hero-wrapper">
    <div class="${className}"><div><div>${cell}</div></div></div>
  </div></div></main>`;
  return document.querySelector('.hero');
}

describe('hero — video-bg variant', () => {
  let compact;
  let reduceMotion;
  let playResult;
  let played;
  let paused;

  beforeEach(() => {
    compact = false;
    reduceMotion = false;
    playResult = 'resolve';
    played = [];
    paused = [];

    vi.stubGlobal('matchMedia', vi.fn((query) => ({
      matches: (reduceMotion && query.includes('prefers-reduced-motion'))
        || (compact && query === '(width < 1024px)'),
      addEventListener() {},
      removeEventListener() {},
    })));

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
      played.push(this.getAttribute('src'));
      if (playResult === 'reject') {
        return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      }
      Object.defineProperty(this, 'paused', { value: false, configurable: true });
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
      paused.push(this.getAttribute('src'));
      Object.defineProperty(this, 'paused', { value: true, configurable: true });
      this.dispatchEvent(new Event('pause'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders a full-bleed background video behind the copy instead of a media tile', async () => {
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    const bg = block.querySelector('.hero-bg');
    expect(bg).not.toBeNull();
    expect(bg.getAttribute('aria-hidden')).toBe('true');
    expect(bg.querySelector('video.hero-bg-video')).not.toBeNull();
    expect(bg.querySelectorAll('.hero-bg-fallback')).toHaveLength(1);

    expect(block.querySelector('.hero-media')).toBeNull();
    expect(block.querySelector('.hero-media-video')).toBeNull();
    expect(block.querySelector('.hero-video')).toBeNull();
    expect(block.querySelector('.hero-video-play')).toBeNull();

    const copy = block.querySelector('.hero-copy');
    expect(copy.querySelector('h1').textContent).toBe('See where your business stands');
    expect(copy.querySelector('.hero-eyebrow').textContent).toBe('DATA REPORT');
    expect(copy.querySelector('.hero-lede')).not.toBeNull();
    expect(copy.querySelector('a[href$=".mp4"]')).toBeNull();
    expect(copy.querySelector('img, picture')).toBeNull();
    const actions = copy.querySelector('.hero-actions');
    expect(actions.querySelector('a[href="/demo"]')).not.toBeNull();
    expect(actions.querySelector('a[href="#schedule"]')).not.toBeNull();

    const toggle = block.querySelector('.hero-bg-toggle');
    expect(toggle).not.toBeNull();
    expect(bg.contains(toggle)).toBe(false);
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    expect(actions.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('autoplays muted, inline and looping, with no teaser timeout or play overlay', async () => {
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    const video = block.querySelector('video.hero-bg-video');
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.getAttribute('src')).toBe('/media/bg-desktop.mp4');
    expect(played).toEqual(['/media/bg-desktop.mp4']);

    Object.defineProperty(video, 'currentTime', { value: 6, configurable: true });
    video.dispatchEvent(new Event('timeupdate'));
    expect(paused).toEqual([]);
    expect(block.querySelector('.hero-video-play')).toBeNull();
    expect(block.querySelector('.hero-bg').classList.contains('is-fallback')).toBe(false);
  });

  it('uses the second video and fallback image below 1024px', async () => {
    compact = true;
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    expect(block.querySelector('video.hero-bg-video').getAttribute('src')).toBe('/media/bg-mobile.mp4');
    const fallbacks = block.querySelectorAll('.hero-bg img');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].getAttribute('src')).toBe('/media/poster-mobile.jpg');
  });

  it('shows only the static fallback under prefers-reduced-motion', async () => {
    reduceMotion = true;
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    expect(block.querySelector('video')).toBeNull();
    expect(played).toEqual([]);
    expect(block.querySelector('.hero-bg-toggle')).toBeNull();
    const bg = block.querySelector('.hero-bg');
    expect(bg.classList.contains('is-fallback')).toBe(true);
    expect(bg.querySelector('.hero-bg-fallback img').getAttribute('src')).toBe('/media/poster-desktop.jpg');
    expect(block.querySelector('h1')).not.toBeNull();
    expect(block.querySelectorAll('.hero-actions a')).toHaveLength(2);
  });

  it('shows the static fallback when no video is authored', async () => {
    const block = mount('hero video-bg block', VIDEO_BG_CELL.replace(/<p><a href="\/media\/bg[^\n]*\n/, ''));
    await decorate(block);
    await flush();

    expect(block.querySelector('video')).toBeNull();
    expect(block.querySelector('.hero-bg-toggle')).toBeNull();
    expect(block.querySelector('.hero-bg').classList.contains('is-fallback')).toBe(true);
    expect(block.querySelector('.hero-bg-fallback')).not.toBeNull();
  });

  it('falls back to the poster when autoplay is blocked and lets the user start playback', async () => {
    playResult = 'reject';
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    const bg = block.querySelector('.hero-bg');
    const toggle = block.querySelector('.hero-bg-toggle');
    expect(bg.classList.contains('is-fallback')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Play background video');
    expect(toggle.dataset.state).toBe('paused');
    expect(block.querySelectorAll('.hero-actions a')).toHaveLength(2);

    playResult = 'resolve';
    toggle.click();
    await flush();
    expect(played).toHaveLength(2);
    expect(bg.classList.contains('is-fallback')).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Pause background video');
    expect(toggle.dataset.state).toBe('playing');
  });

  it('drops the video and its control when the video fails to load', async () => {
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    block.querySelector('video').dispatchEvent(new Event('error'));

    const bg = block.querySelector('.hero-bg');
    expect(bg.classList.contains('is-fallback')).toBe(true);
    expect(block.querySelector('video')).toBeNull();
    expect(block.querySelector('.hero-bg-toggle')).toBeNull();
    expect(bg.querySelector('.hero-bg-fallback')).not.toBeNull();
    expect(block.querySelectorAll('.hero-actions a')).toHaveLength(2);
  });

  it('pauses and resumes from an accessible toggle button', async () => {
    const block = mount('hero video-bg block', VIDEO_BG_CELL);
    await decorate(block);
    await flush();

    const toggle = block.querySelector('.hero-bg-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-label')).toBe('Pause background video');
    expect(toggle.dataset.state).toBe('playing');

    toggle.click();
    expect(paused).toEqual(['/media/bg-desktop.mp4']);
    expect(toggle.getAttribute('aria-label')).toBe('Play background video');
    expect(toggle.dataset.state).toBe('paused');

    toggle.click();
    await flush();
    expect(played).toHaveLength(2);
    expect(toggle.getAttribute('aria-label')).toBe('Pause background video');
    expect(toggle.dataset.state).toBe('playing');
  });

  it('leaves the ies video teaser tile unchanged', async () => {
    const block = mount('hero ies video block', `
      <h1>Teaser</h1>
      <p><picture><img src="/media/poster.jpg" alt=""></picture></p>
      <p><a href="/media/teaser.mp4">/media/teaser.mp4</a></p>
    `);
    await decorate(block);
    await flush();

    expect(block.querySelector('.hero-media-video video')).not.toBeNull();
    expect(block.querySelector('.hero-video-play')).not.toBeNull();
    expect(block.querySelector('.hero-bg')).toBeNull();
    expect(block.querySelector('.hero-bg-toggle')).toBeNull();
  });

  it('leaves the centered hero video unchanged', async () => {
    const block = mount('hero centered block', `
      <h1>AI agents</h1>
      <p><a href="/media/agents.mp4">/media/agents.mp4</a></p>
    `);
    await decorate(block);
    await flush();

    const figure = block.querySelector('.hero-video');
    expect(figure.querySelector('video').loop).toBe(true);
    expect(figure.querySelector('.hero-video-toggle')).not.toBeNull();
    expect(block.querySelector('.hero-bg')).toBeNull();
  });
});
