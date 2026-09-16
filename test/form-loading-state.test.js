import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import decorate from '../blocks/form/form.js';

vi.mock('../scripts/aem.js', () => ({
  loadScript: vi.fn(() => Promise.resolve()),
  getMetadata: vi.fn(() => ''),
  decorateIcons: vi.fn(),
}));
vi.mock('../scripts/placeholders.js', () => ({
  fetchPlaceholders: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../scripts/experience.js', () => ({
  experienceLog: vi.fn(),
}));
vi.mock('../scripts/scripts.js', () => ({
  getSiteConfig: vi.fn(() => Promise.resolve({
    'marketo.munchkin': '743-RZM-619',
    'chilipiper.subdomain': 'intuitsales',
  })),
}));

const flush = () => new Promise((r) => { setTimeout(r, 0); });

function buildFormBlock() {
  const block = document.createElement('div');
  block.className = 'form block';
  block.innerHTML = '<div><div>formId</div><div>1001</div></div>';
  return block;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // the block only reaches embedMarketoForm once it intersects; never fire it here
  // so the test observes the state the visitor sees while Marketo is still loading
  window.IntersectionObserver = class {
    observe() {}

    disconnect() {}
  };
});

describe('form loading state', () => {
  it('shows a spinner in place of the fields while Marketo loads inside a modal', async () => {
    const dialog = document.createElement('dialog');
    const block = buildFormBlock();
    dialog.append(block);
    document.body.append(dialog);

    await decorate(block);
    await flush();

    const loading = block.querySelector('.form-loading');
    expect(loading).not.toBeNull();
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.querySelector('.form-loading-spinner')).not.toBeNull();
    // the empty Marketo shell is still there, waiting to be filled
    expect(block.querySelector('form#mktoForm_1001')).not.toBeNull();
  });

  it('leaves page-embedded forms alone, so they keep their zero-shift layout', async () => {
    const block = buildFormBlock();
    document.body.append(block);

    await decorate(block);
    await flush();

    expect(block.querySelector('.form-loading')).toBeNull();
    expect(block.querySelector('form#mktoForm_1001')).not.toBeNull();
  });
});
