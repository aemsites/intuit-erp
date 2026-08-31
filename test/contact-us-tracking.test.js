import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  resetTrackingState, resolveTrackable, stampInteraction, trackIdOf,
} from '../scripts/tracking.js';

vi.mock('../scripts/aem.js', () => ({ getMetadata: () => '' }));
vi.mock('../scripts/schedule-modal.js', () => ({ openScheduleModal: vi.fn() }));

const { default: initContactUs } = await import('../blocks/contact-us/contact-us.js');

describe('contact-us tracking', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/accounting/business-intelligence-reports');
    window.hlx = { codeBasePath: '' };
    resetTrackingState();
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      text: async () => (String(url).includes('contact-info')
        ? '<div class="contact-info"><div><div>Sales Phone</div><div>1-800-555-0100</div></div><div><div>Sales Hours</div><div>Monday-Friday</div></div><div><div>Support URL</div><div><a href="https://quickbooks.intuit.com/support">Support</a></div></div></div>'
        : '<svg></svg>'),
    })));
  });

  it('keeps the close control trackable with a stable sheet identity', async () => {
    await initContactUs();
    const close = document.querySelector('.cu-close');

    expect(trackIdOf(close)).toBe('talk-to-sales:close-sales-widget');
    expect(close.hasAttribute('data-track-skip')).toBe(false);
    expect(resolveTrackable(close)).not.toBeNull();

    stampInteraction({ target: close });
    expect(close.getAttribute('data-ui-action')).toBe('clicked');
  });
});
