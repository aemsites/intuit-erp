import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard (the synthetic parity gate's blind spot): drive the ACTUAL
// feature-grid decorate() + the delegated JIT-stamp runtime + the tracker replica, and
// assert the block truly stamps the single-level `feature` trail the customer golden
// reports on prod. This is what keeps parity-gate's BLOCK.feature entry honest.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/feature-grid/feature-grid.js');

// feature-grid authored shape: one row per card = [media cell, content cell]; the
// content cell's trailing link-only line is the CTA (see feature-grid.js JSDoc).
function makeFeatureGrid() {
  const block = document.createElement('div');
  block.className = 'feature-grid block';
  block.innerHTML = `
    <div>
      <div><img src="/close.png" alt="Close management"></div>
      <div>
        <p><strong>CLOSE MANAGEMENT</strong></p>
        <h3>Automate the close</h3>
        <p>Close in days, not weeks.</p>
        <p class="button-container"><a class="button" href="/accounting">Register</a></p>
      </div>
    </div>`;
  return block;
}

describe('feature-grid — click tracking', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('feature-grid CTAs resolve to the single-level `feature` trail (matches prod)', () => {
    const main = document.createElement('main');
    const block = makeFeatureGrid();
    main.append(block);
    document.body.append(main);
    decorate(block);
    initTracking(document);

    // buildCard rebuilds the CTA as <a class="feature-cta"> (also wrapping the expanded
    // image in a bare <a> to the same href). This test guards what the BLOCK WIRING owns:
    // the single-level `feature` trail. (ui_object: derive gives `link` for .feature-cta;
    // prod emits `button` — supplied by the sheet residue, and a directive-4 candidate to
    // improve in the derive. The image-wrapper anchor is a possible over-tracking beacon.
    // Both are out of scope for this wiring guard.)
    const cta = block.querySelector('a.feature-cta[href="/accounting"]');
    expect(cta).not.toBeNull();
    expect(block.getAttribute('data-tracking')).toBe('feature'); // trackAs stamped the block

    stampInteraction({ target: cta });
    const p = computeTrackingPayload(cta);
    expect(p.ui_access_point).toBe('feature'); // the trail the block owns — matches prod
    expect(p.object).toBe('content');
    expect(p.action).toBe('interacted');
  });
});
