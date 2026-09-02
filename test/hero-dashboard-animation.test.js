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
  let media;
  let picture;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    window.hlx = { codeBasePath: '' };
    IntersectionObserverMock.instances = [];
    idleCallbacks = [];

    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));

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

  it('warms resources near the viewport, then initializes during idle once visible', async () => {
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
    expect(fetchAnimation).toHaveBeenCalledWith('/blocks/hero/dashboard-animation.json');
    const modulePreload = document.head.querySelector(
      'link[rel="modulepreload"][href="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js/+esm"]',
    );
    expect(modulePreload).not.toBeNull();
    expect(modulePreload.nonce).toBe('aem');
    expect(loadPlayer).not.toHaveBeenCalled();

    visibleObserver.intersect({ ratio: 0.25 });
    await flushPromises();
    expect(idleCallbacks).toHaveLength(1);
    expect(loadPlayer).not.toHaveBeenCalled();

    idleCallbacks[0]();
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
});
