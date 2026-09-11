import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/aem.js', () => ({
  buildBlock: vi.fn(() => document.createElement('div')),
  decorateBlock: vi.fn(),
  loadBlock: vi.fn(() => Promise.resolve()),
  loadCSS: vi.fn(() => Promise.resolve()),
  loadSections: vi.fn(() => Promise.resolve()),
}));
vi.mock('../blocks/fragment/fragment.js', () => ({
  loadFragment: vi.fn(),
}));
vi.mock('../scripts/schedule-modal.js', () => ({
  bindScheduleLinks: vi.fn(),
}));

// eslint-disable-next-line import/order
import { loadBlock } from '../scripts/aem.js';
// eslint-disable-next-line import/order
import { loadFragment } from '../blocks/fragment/fragment.js';
// eslint-disable-next-line import/order
import {
  createModal, openModal, isModalActive,
} from '../blocks/modal/modal.js';

window.hlx = { codeBasePath: '' };

// Directly dispatching 'close' (rather than calling the real .close()) sidesteps
// jsdom's incomplete <dialog> implementation while still exercising the guard-reset
// logic in modal.js's own 'close' listener.
function simulateClose(dialog) {
  dialog.dispatchEvent(new Event('close'));
}

beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  loadBlock.mockReset();
  loadBlock.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  // Belt-and-suspenders: if a test leaves a dialog open, release the module-level
  // guard so it can't leak into the next test.
  document.querySelectorAll('dialog').forEach(simulateClose);
  document.body.innerHTML = '';
});

describe('createModal reentrancy guard', () => {
  it('returns null for a second concurrent call while the first is still under construction', async () => {
    const first = createModal([document.createElement('p')]);
    const second = await createModal([document.createElement('p')]);
    expect(second).toBeNull();
    const result = await first;
    expect(result).not.toBeNull();
    expect(isModalActive()).toBe(true);
    simulateClose(result.block.querySelector('dialog'));
  });

  it('releases the guard when the dialog closes, allowing a new modal afterwards', async () => {
    const first = await createModal([document.createElement('p')]);
    expect(isModalActive()).toBe(true);
    simulateClose(first.block.querySelector('dialog'));
    expect(isModalActive()).toBe(false);

    const second = await createModal([document.createElement('p')]);
    expect(second).not.toBeNull();
    simulateClose(second.block.querySelector('dialog'));
  });

  it('releases the guard if construction throws, so a future attempt is not permanently blocked', async () => {
    loadBlock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await expect(createModal([document.createElement('p')])).rejects.toThrow('boom');
    expect(isModalActive()).toBe(false);

    const result = await createModal([document.createElement('p')]);
    expect(result).not.toBeNull();
    simulateClose(result.block.querySelector('dialog'));
  });
});

describe('openModal', () => {
  function makeFragment(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  it('resolves to the opened dialog element on success', async () => {
    loadFragment.mockResolvedValueOnce(makeFragment('<p>Schedule a call</p>'));
    const dialog = await openModal('/fragments/schedule-call-vertical');
    expect(dialog?.tagName).toBe('DIALOG');
    simulateClose(dialog);
  });

  it('resolves to null when a modal is already active', async () => {
    loadFragment.mockResolvedValue(makeFragment('<p>Schedule a call</p>'));
    const first = await openModal('/fragments/schedule-call-vertical');
    const second = await openModal('/fragments/schedule-call-vertical');
    expect(second).toBeNull();
    simulateClose(first);
  });

  it('shows a fallback dialog (still returning it) when the fragment fetch fails', async () => {
    loadFragment.mockResolvedValueOnce(null);
    const dialog = await openModal('/fragments/missing');
    expect(dialog?.tagName).toBe('DIALOG');
    expect(dialog.querySelector('.modal-error')).not.toBeNull();
    simulateClose(dialog);
  });
});
