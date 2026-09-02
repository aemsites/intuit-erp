import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard: drive the ACTUAL highlight decorate() + the delegated JIT-stamp
// runtime + the tracker replica, and assert the variant-dependent trail the customer golden
// (dark /events banner -> rw_banner) and our reverse-engineered golden (blog callout ->
// product_banner) report on prod. Keeps parity-gate's BLOCK.product_banner entry honest.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/highlight/highlight.js');

// highlight content model: single cell of rich content; a button-wrapped link is the CTA.
function makeHighlight(variant) {
  const block = document.createElement('div');
  block.className = `highlight ${variant} block`.replace(/\s+/g, ' ').trim();
  block.setAttribute('data-block-name', 'highlight');
  block.innerHTML = `<div><div>
    <h2>Join our webinar</h2>
    <p class="button-container"><a class="button" href="https://ieswebinars.intuit.com/x/register">Register now</a></p>
  </div></div>`;
  return block;
}

function trailFor(variant) {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeHighlight(variant);
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  const cta = block.querySelector('a.button');
  stampInteraction({ target: cta });
  return { block, payload: computeTrackingPayload(cta) };
}

describe('highlight — click tracking (variant-dependent trail)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('dark banner CTAs resolve to the `rw_banner` trail (prod /events)', () => {
    const { block, payload } = trailFor('dark');
    expect(block.getAttribute('data-tracking')).toBe('rw_banner');
    expect(payload.ui_access_point).toBe('rw_banner');
    expect(payload.object).toBe('content');
    expect(payload.action).toBe('interacted');
  });

  it('default callout CTAs resolve to the `product_banner` trail (prod blog)', () => {
    const { block, payload } = trailFor('');
    expect(block.getAttribute('data-tracking')).toBe('product_banner');
    expect(payload.ui_access_point).toBe('product_banner');
  });
});
