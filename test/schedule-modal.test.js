import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../scripts/aem.js', () => ({
  getMetadata: vi.fn(() => ''),
}));
vi.mock('../blocks/modal/modal.js', () => ({
  openModal: vi.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line import/order
import { getMetadata } from '../scripts/aem.js';
// eslint-disable-next-line import/order
import { openModal } from '../blocks/modal/modal.js';
// eslint-disable-next-line import/order
import { bindScheduleLinks, openScheduleModal } from '../scripts/schedule-modal.js';

const flush = () => new Promise((r) => { setTimeout(r, 0); });

beforeEach(() => {
  getMetadata.mockReturnValue('');
});

describe('openScheduleModal', () => {
  it('opens the default schedule-call-vertical fragment when no metadata is authored', async () => {
    await openScheduleModal();
    expect(openModal).toHaveBeenCalledWith('/fragments/schedule-call-vertical');
  });

  it('resolves a bare schedule-fragment metadata value under /fragments/', async () => {
    getMetadata.mockReturnValue('schedule-call-alt');
    await openScheduleModal();
    expect(openModal).toHaveBeenCalledWith('/fragments/schedule-call-alt');
  });

  it('uses an absolute schedule-fragment metadata path as-is', async () => {
    getMetadata.mockReturnValue('/library/fragments/schedule-call-custom');
    await openScheduleModal();
    expect(openModal).toHaveBeenCalledWith('/library/fragments/schedule-call-custom');
  });
});

describe('bindScheduleLinks', () => {
  function makeContainer(...hrefs) {
    const container = document.createElement('div');
    container.innerHTML = hrefs.map((href) => `<a href="${href}">Schedule a call</a>`).join('');
    return container;
  }

  it('opens the modal and prevents navigation when a #schedule link is clicked', async () => {
    const container = makeContainer('#schedule');
    bindScheduleLinks(container);
    const link = container.querySelector('a');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    link.dispatchEvent(event);
    await flush();
    expect(preventDefault).toHaveBeenCalled();
    expect(openModal).toHaveBeenCalledWith('/fragments/schedule-call-vertical');
  });

  it('also binds a stray absolute URL ending in #schedule', async () => {
    const container = makeContainer('https://example.com/some/path#schedule');
    bindScheduleLinks(container);
    const link = container.querySelector('a');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(openModal).toHaveBeenCalledTimes(1);
  });

  it('ignores links that do not end in #schedule', () => {
    const container = makeContainer('#lets-connect', '/accountant', '#schedule-old');
    bindScheduleLinks(container);
    container.querySelectorAll('a').forEach((a) => {
      expect(a.dataset.scheduleBound).toBeUndefined();
    });
  });

  it('only binds links inside the given container', async () => {
    const outside = makeContainer('#schedule');
    document.body.append(outside);
    const container = document.createElement('div');
    bindScheduleLinks(container);
    outside.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(openModal).not.toHaveBeenCalled();
    outside.remove();
  });

  it('is idempotent: calling it twice on the same container does not double-bind a link', async () => {
    const container = makeContainer('#schedule');
    bindScheduleLinks(container);
    bindScheduleLinks(container); // simulates a second content-injection point re-scanning the same DOM
    const link = container.querySelector('a');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(openModal).toHaveBeenCalledTimes(1);
  });

  it('marks bound links with data-schedule-bound', () => {
    const container = makeContainer('#schedule');
    bindScheduleLinks(container);
    expect(container.querySelector('a').dataset.scheduleBound).toBe('true');
  });

  it('gives an unclaimed loose schedule anchor a semantic sheet identity', () => {
    const container = document.createElement('main');
    container.innerHTML = '<p><a href="#schedule">Schedule a consultation</a></p>';
    bindScheduleLinks(container);
    expect(container.querySelector('a').dataset.trackId).toBe('page:schedule-a-consultation');
  });

  it('preserves block-owned and explicit schedule identities', () => {
    const container = document.createElement('main');
    container.innerHTML = `
      <div class="tabs block"><a href="#schedule">Schedule a call</a></div>
      <p><a href="#schedule" data-track-id="custom:schedule">Schedule a demo</a></p>`;
    bindScheduleLinks(container);
    const [blockOwned, explicit] = container.querySelectorAll('a');
    expect(blockOwned.hasAttribute('data-track-id')).toBe(false);
    expect(explicit.dataset.trackId).toBe('custom:schedule');
  });

  it('leaves claimed ChiliPiper links to the widget without stopping bubbling', async () => {
    const container = makeContainer('#schedule');
    const link = container.querySelector('a');
    link.dataset.chilipiperTrigger = 'true';
    document.body.append(container);
    const tracking = vi.fn();
    document.addEventListener('click', tracking, { once: true });
    bindScheduleLinks(container);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    link.dispatchEvent(event);
    await flush();

    expect(openModal).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(tracking).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
