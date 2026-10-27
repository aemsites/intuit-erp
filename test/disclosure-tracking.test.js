import {
  beforeEach, describe, expect, it,
} from 'vitest';
import decorate from '../blocks/disclosure/disclosure.js';
import { resetTrackingState, stampInteraction } from '../scripts/tracking.js';

describe('disclosure click tracking', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetTrackingState();
  });

  it('tracks the native summary with stable open and close metadata', () => {
    document.body.innerHTML = '<main><div class="disclosure block">'
      + '<div><div>Important pricing details and product information</div></div>'
      + '<div><div><p>Terms</p></div></div></div></main>';
    const block = document.querySelector('.disclosure');
    decorate(block);
    const details = block.querySelector('details');
    const summary = block.querySelector('summary');

    expect(summary.getAttribute('data-track-id')).toBe('disclaimer:important-pricing-details-and-product-information');
    stampInteraction({ target: summary });
    expect(summary.getAttribute('data-object-detail')).toBe('disclaimer|open');
    expect(summary.getAttribute('data-ui-object')).toBe('link');

    details.open = true;
    stampInteraction({ target: summary });
    expect(summary.getAttribute('data-object-detail')).toBe('disclaimer|close');
  });

  it('does not emit expand/collapse metadata for the expanded variation', () => {
    document.body.innerHTML = '<main><div class="disclosure expanded block">'
      + '<div><div>Important pricing details and product information</div></div>'
      + '<div><div><p>Terms <a href="https://example.com/terms">terms link</a></p></div></div></div></main>';
    const block = document.querySelector('.disclosure');
    decorate(block);
    const link = block.querySelector('a[href]');

    expect(block.querySelector('summary')).toBeNull();
    expect(block.querySelector('.disclosure-title').hasAttribute('data-track-id')).toBe(false);
    expect(link.hasAttribute('data-track-id')).toBe(true);
    stampInteraction({ target: link });
    expect(link.getAttribute('data-object-detail') || '').not.toMatch(/^disclaimer\|(open|close)$/);
  });
});
