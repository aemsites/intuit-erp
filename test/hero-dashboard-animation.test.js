import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { enhanceDashboardAnimation } = await import('../blocks/hero/hero.js');

class IntersectionObserverMock {
  static instances = [];

  constructor(callback, options = {}) {
    this.callback = callback;
    this.options = options;
    this.disconnect = vi.fn();
    this.observe = vi.fn();
    IntersectionObserverMock.instances.push(this);
  }

  intersect({ ratio = 1 } = {}) {
    this.callback([{ isIntersecting: true, intersectionRatio: ratio }]);
  }
}

const flushPromises = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('hero — dashboard animation scheduling', () => {
  let idleCallbacks;
  let isMobile;
  let media;
  let picture;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    window.hlx = { codeBasePath: '' };
    IntersectionObserverMock.instances = [];
    idleCallbacks = [];
    isMobile = false;

    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    }));
    vi.stubGlobal('matchMedia', vi.fn((query) => ({
      matches: isMobile && query === '(width < 768px)',
    })));

    media = document.createElement('div');
    media.className = 'hero-media';
    picture = document.createElement('picture');
    const image = document.createElement('img');
    image.decode = vi.fn(() => Promise.resolve());
    picture.append(image);
    media.append(picture);
    document.body.append(media);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.hlx;
  });

  it('defers resource warm-up and initialization until idle once visible', async () => {
    const animationData = { layers: [] };
    const response = { ok: true, json: vi.fn(() => Promise.resolve(animationData)) };
    const fetchAnimation = vi.fn(() => Promise.resolve(response));
    let onDomLoaded;
    const animation = {
      addEventListener: vi.fn((name, callback) => {
        if (name === 'DOMLoaded') onDomLoaded = callback;
      }),
      play: vi.fn(),
    };
    const loadAnimation = vi.fn(() => animation);
    const loadPlayer = vi.fn(() => Promise.resolve({ default: { loadAnimation } }));

    enhanceDashboardAnimation(media, picture, { fetchAnimation, loadPlayer });

    expect(IntersectionObserverMock.instances).toHaveLength(2);
    const warmObserver = IntersectionObserverMock.instances
      .find(({ options }) => options.rootMargin === '500px 0px');
    const visibleObserver = IntersectionObserverMock.instances
      .find(({ options }) => options.threshold === 0.1);

    expect(fetchAnimation).not.toHaveBeenCalled();
    expect(loadPlayer).not.toHaveBeenCalled();

    warmObserver.intersect();
    expect(idleCallbacks).toHaveLength(1);
    expect(window.requestIdleCallback).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(fetchAnimation).not.toHaveBeenCalled();
    const modulePreload = document.head.querySelector(
      'link[rel="modulepreload"][href="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm"]',
    );
    expect(modulePreload).toBeNull();
    expect(loadPlayer).not.toHaveBeenCalled();

    visibleObserver.intersect({ ratio: 0.25 });
    await flushPromises();
    expect(idleCallbacks).toHaveLength(2);
    expect(fetchAnimation).not.toHaveBeenCalled();
    expect(loadPlayer).not.toHaveBeenCalled();

    idleCallbacks[0]();
    await flushPromises();
    expect(fetchAnimation).toHaveBeenCalledWith('/blocks/hero/dashboard-animation.json');
    const idleModulePreload = document.head.querySelector(
      'link[rel="modulepreload"][href="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm"]',
    );
    expect(idleModulePreload).not.toBeNull();
    expect(idleModulePreload.nonce).toBe('aem');
    expect(loadPlayer).not.toHaveBeenCalled();

    idleCallbacks[1]();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(loadPlayer).toHaveBeenCalledOnce();
    expect(response.json).toHaveBeenCalledOnce();
    expect(loadAnimation).toHaveBeenCalledWith(expect.objectContaining({
      container: media.querySelector('.hero-dashboard-lottie'),
      autoplay: false,
      animationData,
    }));
    expect(picture.classList.contains('hero-dashboard-fallback')).toBe(false);

    onDomLoaded();
    expect(picture.classList.contains('hero-dashboard-fallback')).toBe(true);
    expect(animation.play).toHaveBeenCalledOnce();
  });

  it('waits until the dashboard is at least 80% visible on mobile', async () => {
    isMobile = true;
    const fetchAnimation = vi.fn();
    const loadPlayer = vi.fn();

    enhanceDashboardAnimation(media, picture, { fetchAnimation, loadPlayer });

    const visibleObserver = IntersectionObserverMock.instances
      .find(({ options }) => options.threshold === 0.8);

    expect(visibleObserver).toBeDefined();
    visibleObserver.intersect({ ratio: 0.79 });
    await flushPromises();
    expect(idleCallbacks).toHaveLength(0);
    expect(visibleObserver.disconnect).not.toHaveBeenCalled();

    visibleObserver.intersect({ ratio: 0.8 });
    await flushPromises();
    expect(idleCallbacks).toHaveLength(1);
    expect(visibleObserver.disconnect).toHaveBeenCalledOnce();
    expect(fetchAnimation).not.toHaveBeenCalled();
    expect(loadPlayer).not.toHaveBeenCalled();
  });

  // hero.js's decorate() calls enhanceDashboardAnimation(media, mediaEl) BEFORE
  // block.replaceChildren(grid) attaches `grid` (and therefore `media`) anywhere —
  // media's own ancestor chain does NOT reach the document's <main> at call time.
  // These two tests deliberately mirror that: `media` stays detached (never appended
  // to the real <main>, matching beforeEach's plain `document.body.append(media)`),
  // while the real page's <main> is a wholly separate element in the document. A
  // check based on media.closest('main') would wrongly see no <main> at all here.
  it('skips entirely when the document\'s <main> was replaced by a page-level PZN/experiment swap', () => {
    const main = document.createElement('main');
    main.dataset.pageSwapped = 'true';
    document.body.append(main); // separate from `media`, which beforeEach left under body directly

    const fetchAnimation = vi.fn();
    const loadPlayer = vi.fn();
    enhanceDashboardAnimation(media, picture, { fetchAnimation, loadPlayer });

    expect(IntersectionObserverMock.instances).toHaveLength(0);
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
  });

  it('still runs when the document\'s <main> is present but was not swapped', () => {
    const main = document.createElement('main');
    document.body.append(main); // separate from `media`, same as above

    enhanceDashboardAnimation(media, picture);

    expect(IntersectionObserverMock.instances).toHaveLength(2);
  });

  it('uses a delayed fallback when idle callbacks are unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(() => 1);

    enhanceDashboardAnimation(media, picture);

    const warmObserver = IntersectionObserverMock.instances
      .find(({ options }) => options.rootMargin === '500px 0px');
    warmObserver.intersect();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
  });
});
