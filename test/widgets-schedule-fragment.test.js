import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

vi.mock('../blocks/modal/modal.js', () => ({
  createModal: vi.fn(async () => null),
  openModal: vi.fn(() => Promise.resolve(null)),
  isModalActive: vi.fn(() => false),
}));
vi.mock('../blocks/fragment/fragment.js', () => ({
  loadFragment: vi.fn(async () => null),
}));

// eslint-disable-next-line import/first
import decorate, {
  resolveFragmentPath,
} from '../widgets/pzn/schedule-fragment/schedule-fragment.js';
// eslint-disable-next-line import/first
import { openModal } from '../blocks/modal/modal.js';

afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.scheduleFragmentBound;
  vi.clearAllMocks();
});

const click = async (el) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
};

describe('schedule-fragment: resolveFragmentPath', () => {
  it('keeps absolute paths and resolves bare names under /fragments/', () => {
    expect(resolveFragmentPath('/fragments/pzn/x/form-a')).toBe('/fragments/pzn/x/form-a');
    expect(resolveFragmentPath('schedule-call-vertical')).toBe('/fragments/schedule-call-vertical');
  });
  it('returns null when no fragment is configured', () => {
    expect(resolveFragmentPath('')).toBeNull();
    expect(resolveFragmentPath(undefined)).toBeNull();
  });
});

describe('schedule-fragment: decorate repoints the schedule modal', () => {
  it('opens the configured fragment instead of the baseline schedule modal', async () => {
    document.body.innerHTML = '<div class="widget"></div>';
    const widget = document.querySelector('.widget');
    widget.dataset.fragment = '/fragments/pzn/test/form-variant';
    widget.dataset.trigger = '.sf-test-cta';
    await decorate(widget);

    document.body.insertAdjacentHTML('beforeend', '<a class="sf-test-cta" href="#schedule">Schedule a call</a>');
    const cta = document.querySelector('.sf-test-cta');
    const baseline = vi.fn();
    cta.addEventListener('click', baseline);

    await click(cta);
    expect(openModal).toHaveBeenCalledWith('/fragments/pzn/test/form-variant');
    expect(baseline).not.toHaveBeenCalled();
  });

  it('defaults to every #schedule link (relative or absolute) and the header nav CTA', async () => {
    document.body.innerHTML = '<header><button type="button" class="nav-cta">Schedule a call</button></header>'
      + '<div class="widget"></div><a class="cta-a" href="#schedule">A</a>'
      + '<a class="cta-b" href="https://erp.intuit.com/x#schedule">B</a>';
    const widget = document.querySelector('.widget');
    widget.dataset.fragment = 'pzn/test/form-default';
    await decorate(widget);

    await click(document.querySelector('header .nav-cta'));
    await click(document.querySelector('.cta-a'));
    await click(document.querySelector('.cta-b'));
    expect(openModal).toHaveBeenCalledTimes(3);
    expect(openModal).toHaveBeenNthCalledWith(1, '/fragments/pzn/test/form-default');
  });

  it('does nothing without a fragment, and yields to a ChiliPiper claim', async () => {
    document.body.innerHTML = '<div class="widget"></div><a class="sf-cp-cta" href="#schedule" data-chilipiper-trigger="true">x</a>';
    const widget = document.querySelector('.widget');
    widget.dataset.trigger = '.sf-cp-cta';
    await decorate(widget);
    expect(document.documentElement.dataset.scheduleFragmentBound).toBeUndefined();

    widget.dataset.fragment = '/fragments/pzn/test/form-cp';
    await decorate(widget);
    await click(document.querySelector('.sf-cp-cta'));
    expect(openModal).not.toHaveBeenCalled();
  });
});
