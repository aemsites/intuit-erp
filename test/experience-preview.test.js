import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));
vi.mock('../scripts/aem.js', async (importOriginal) => ({
  ...await importOriginal(),
  loadSections: vi.fn(),
}));
vi.mock('../blocks/fragment/fragment.js', () => ({ loadFragment: vi.fn() }));
vi.mock('../blocks/modal/modal.js', () => ({
  openModal: vi.fn(),
  isModalActive: vi.fn(() => false),
}));
vi.mock('../scripts/experience.js', async (importOriginal) => ({
  ...await importOriginal(),
  fetchExperience: vi.fn(),
}));

const authored = `<div class="section" data-exp="123" data-exp-block="hero">
  <div class="hero block" data-block-name="hero">
    <a href="#schedule" data-track-id="hero:schedule">Default schedule</a>
  </div>
</div>`;
let preview;
let openModal;
let loadFragment;
let fetchExperience;
let listeners;
let originalUrl;
let originalHlx;
let messageHandler;

beforeEach(async () => {
  vi.resetModules();
  originalUrl = window.location.href;
  originalHlx = window.hlx;
  window.history.replaceState(null, '', '/construction/');
  document.head.innerHTML = '';
  document.body.innerHTML = `<main>${authored}</main>`;
  window.hlx = {};
  ({ openModal } = await import('../blocks/modal/modal.js'));
  openModal.mockReset();
  openModal.mockImplementation(async () => document.createElement('dialog'));
  ({ loadFragment } = await import('../blocks/fragment/fragment.js'));
  loadFragment.mockReset();
  loadFragment.mockImplementation(async (path) => {
    const fragment = document.createElement('main');
    fragment.innerHTML = `<div><a href="#schedule">${path}</a></div>`;
    return fragment;
  });
  ({ fetchExperience } = await import('../scripts/experience.js'));
  fetchExperience.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => authored,
  })));
  const { bindScheduleLinks } = await import('../scripts/schedule-modal.js');
  bindScheduleLinks(document.querySelector('main'));
  const engine = await import('../scripts/experience-preview.js');
  const windowListeners = vi.spyOn(window, 'addEventListener');
  engine.init();
  [, messageHandler] = windowListeners.mock.calls.find(([type]) => type === 'message');
  preview = window.hlx.experiencePreview;
  listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
});

afterEach(() => {
  window.removeEventListener('message', messageHandler);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', originalUrl);
  window.hlx = originalHlx;
});

function target(scope = 'block', mode = 'swap') {
  return {
    ...preview.getTargets()[0],
    scope,
    blockName: scope === 'block' ? 'hero' : null,
    mode,
  };
}

async function expectScheduling(link) {
  expect(listeners.mock.calls.filter(([type], index) => (
    type === 'click' && listeners.mock.contexts[index] === link
  ))).toHaveLength(1);
  openModal.mockClear();
  const hash = window.location.hash;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  expect(link.dispatchEvent(event)).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => {
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(link.querySelector('.modal-trigger-spinner')).toBeNull();
  });
  expect(openModal).toHaveBeenCalledWith('/fragments/schedule-call-vertical');
  expect(window.location.hash).toBe(hash);
  const dialog = await openModal.mock.results[0].value;
  dialog.dispatchEvent(new Event('close'));
  expect(link.hasAttribute('aria-disabled')).toBe(false);
}

describe('preview scheduling rebinding', () => {
  it.each(['block', 'section'])('rebinds a %s baseline with a copied binding marker', async (scope) => {
    const t = target(scope);
    const original = document.querySelector('a');
    expect(original.dataset.scheduleBound).toBe('true');
    await preview.applyVariant(t, '/fragments/a');

    expect(await preview.applyVariant(t, '__default__')).toEqual({ applied: true });
    const restored = document.querySelector('a');
    expect(restored).not.toBe(original);
    expect(restored.textContent).toBe('Default schedule');
    expect(restored.dataset.scheduleBound).toBe('true');
    expect(restored.dataset.trackId).toBe('hero:schedule');
    await expectScheduling(restored);
  });

  it.each(['block', 'section'])('switches %s variants without duplicate handlers', async (scope) => {
    const t = target(scope);
    for (const path of ['/fragments/a', '/fragments/b', '/fragments/a']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await preview.applyVariant(t, path)).toEqual({ applied: true });
      const link = document.querySelector('a');
      expect(link.textContent).toBe(path);
      // eslint-disable-next-line no-await-in-loop
      await expectScheduling(link);
      // eslint-disable-next-line no-await-in-loop
      await expectScheduling(link);
    }
  });

  it('rebinds restored and appended links without accumulating variants', async () => {
    const t = target('block', 'append');
    await preview.applyVariant(t, '/fragments/a');
    await preview.applyVariant(t, '/fragments/b');
    const links = document.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('Default schedule');
    expect(links[1].textContent).toBe('/fragments/b');
    await expectScheduling(links[0]);
    await expectScheduling(links[1]);
  });

  it('keeps the restored baseline usable after a failed fragment load', async () => {
    const t = target();
    await preview.applyVariant(t, '/fragments/a');
    loadFragment.mockResolvedValueOnce(null);
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    expect(await preview.applyVariant(t, '/fragments/missing')).toEqual({
      applied: false,
      reason: 'Fragment not found (404): /fragments/missing',
    });
    const link = document.querySelector('a');
    expect(link.textContent).toBe('Default schedule');
    await expectScheduling(link);
  });

  it('rebinds after whole-page swaps and full baseline resets', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<div><a href="#schedule">Page variant</a></div>',
    });
    expect(await preview.applyVariant(target('page'), '/variants/page')).toEqual({ applied: true });
    expect(document.querySelector('a').textContent).toBe('Page variant');
    await expectScheduling(document.querySelector('a'));

    expect(await preview.resetToBaseline()).toEqual({ applied: true });
    expect(document.querySelector('a').textContent).toBe('Default schedule');
    await expectScheduling(document.querySelector('a'));
  });

  it.each([false, true])('rebinds context simulation with page swap=%s', async (pageSwap) => {
    if (pageSwap) document.head.innerHTML = '<meta name="experiment-id" content="456">';
    fetchExperience.mockResolvedValueOnce({
      experiments: Object.fromEntries((pageSwap ? ['123', '456'] : ['123']).map((id) => [
        id,
        { payload: JSON.stringify({ contentId: '/fragments/simulated' }) },
      ])),
    });

    expect((await preview.simulateContext({})).applied).toBe(true);
    expect(loadFragment).toHaveBeenCalledWith('/fragments/simulated');
    const link = document.querySelector('a');
    expect(link.textContent).toBe('/fragments/simulated');
    await expectScheduling(link);
  });
});
