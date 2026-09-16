import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../scripts/schedule-modal.js', () => ({
  openScheduleModal: vi.fn(),
  withTriggerLoading: vi.fn((trigger, openFn) => openFn()),
}));

// eslint-disable-next-line import/order
import { openScheduleModal, withTriggerLoading } from '../scripts/schedule-modal.js';

const { default: decorate } = await import('../blocks/assessment/assessment.js');

// intro row, two question rows, then the result row (messages + CTA)
function buildBlock() {
  const block = document.createElement('div');
  block.className = 'assessment block';
  block.innerHTML = `
    <div><div><h3>Should you migrate?</h3></div></div>
    <div><div>Are you on QuickBooks Desktop?</div></div>
    <div><div>Do you manage multiple entities?</div></div>
    <div>
      <div><p>Sounds like a fit.</p><p>Maybe not yet.</p></div>
      <div><a href="#schedule">Assess your migration</a></div>
    </div>`;
  document.body.append(block);
  return block;
}

beforeEach(() => {
  document.body.innerHTML = '';
  openScheduleModal.mockClear();
  withTriggerLoading.mockClear();
});

describe('assessment CTA', () => {
  it('opens the shared modal through withTriggerLoading, so the CTA gets the same loading state as the nav CTA', () => {
    const block = buildBlock();
    decorate(block);
    const cta = block.querySelector('.assessment-cta');

    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(withTriggerLoading).toHaveBeenCalledTimes(1);
    expect(withTriggerLoading.mock.calls[0][0]).toBe(cta);
    expect(openScheduleModal).toHaveBeenCalledTimes(1);
  });

  it('prevents navigation to the #schedule href', () => {
    const block = buildBlock();
    decorate(block);
    const cta = block.querySelector('.assessment-cta');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    cta.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not open the modal while the CTA is gated off by a negative result', () => {
    const block = buildBlock();
    decorate(block);
    const cta = block.querySelector('.assessment-cta');
    // answer "No" to every question so the result turns negative
    block.querySelectorAll('input[value="no"]').forEach((input) => {
      input.checked = true;
      input.closest('.assessment-toggle').dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(cta.getAttribute('aria-disabled')).toBe('true');

    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(withTriggerLoading).not.toHaveBeenCalled();
    expect(openScheduleModal).not.toHaveBeenCalled();
  });
});
