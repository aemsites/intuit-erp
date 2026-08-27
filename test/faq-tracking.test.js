import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render guard for the faq accordion's JIT payload deriver: each toggle emits the
// structured accordion beacon (accordion_item_N / faq|question_N / displayed|dismissed),
// not the generic button/clicked; answer-body links stay on the normal derive.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/faq/faq.js');

function makeFaq() {
  const block = document.createElement('div');
  block.className = 'faq block';
  block.setAttribute('data-block-name', 'faq');
  block.innerHTML = ''
    + '<div><div>What is an ERP system?</div><div>An answer with a <a href="/learn">link</a>.</div></div>'
    + '<div><div>How easy is it to migrate?</div><div>Another answer.</div></div>'
    + '<div><div>Do I still need third-party apps?</div><div>A third answer.</div></div>';
  return block;
}

function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeFaq();
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('faq — structured accordion tracking (JIT-derived)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('each toggle emits accordion_item_N / faq|question_N by DOM order + accordion trail', () => {
    const block = setup();
    const toggles = block.querySelectorAll('.faq-toggle');
    stampInteraction({ target: toggles[1] });
    expect(toggles[1].getAttribute('data-ui-object')).toBe('accordion_item_2');
    expect(toggles[1].getAttribute('data-object-detail')).toBe('faq|question_2');
    expect(computeTrackingPayload(toggles[1]).ui_access_point).toBe('accordion');
    expect(toggles[1].getAttribute('data-custom-properties') || '').toContain('link_name|accordion_item_2-how-easy-is-it-to-migrate');
  });

  it('ui_action reflects expand (displayed) vs collapse (dismissed) state', () => {
    const block = setup();
    const t = block.querySelector('.faq-toggle'); // open by default on marketing pages
    expect(t.getAttribute('aria-expanded')).toBe('true');
    stampInteraction({ target: t });
    expect(t.getAttribute('data-ui-action')).toBe('dismissed'); // was open -> about to collapse
    t.setAttribute('aria-expanded', 'false');
    stampInteraction({ target: t });
    expect(t.getAttribute('data-ui-action')).toBe('displayed'); // was closed -> about to expand
  });

  it('answer-body links are NOT stamped as accordion items (deriver returns null)', () => {
    const block = setup();
    const answerLink = block.querySelector('.faq-answer a');
    expect(answerLink).not.toBeNull();
    stampInteraction({ target: answerLink });
    expect(answerLink.getAttribute('data-object-detail')).toBeNull();
    expect(answerLink.getAttribute('data-ui-object')).not.toBe('accordion_item_1');
  });
});
