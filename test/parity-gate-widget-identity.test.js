import {
  describe, expect, it, vi,
} from 'vitest';

vi.mock('../blocks/faq/faq.js', () => ({ faqTogglePayload: vi.fn() }));
vi.mock('../blocks/cards/cards.js', () => ({ navArrowPayload: vi.fn() }));
vi.mock('../blocks/carousel/carousel.js', () => ({ chevronPayload: vi.fn() }));
vi.mock('../blocks/stat-band/stat-band.js', () => ({ scrollArrowPayload: vi.fn() }));

const { idOf } = await import('../scripts/diff/parity-gate.mjs');

const entry = (page, detail) => ({
  page,
  key: 'talk-to-sales',
  text: detail,
  href: '',
  exp: { ui_object_detail: detail },
});

describe('parity-gate contact widget identities', () => {
  it.each([
    ['/accounting/business-intelligence-reports', 'talktosales|open_widget', 'talk-to-sales:contact-us'],
    ['/accounting/business-intelligence-reports', 'talktosales|close_widget', 'talk-to-sales:close-sales-widget'],
    ['/blog/construction/automation-in-construction', 'ies-open-sales-widget', 'talk-to-sales:talk-to-sales'],
    ['/blog/construction/automation-in-construction', 'close-sales-widget', 'talk-to-sales:close-sales-widget-blog'],
    ['/blog/construction/automation-in-construction', 'Schedule a call', 'talk-to-sales:schedule-a-call'],
    ['/blog/construction/automation-in-construction', 'Visit support page', 'talk-to-sales:visit-support-page'],
  ])('maps %s %s to the rendered tracking id', (page, detail, expected) => {
    expect(idOf(entry(page, detail))).toBe(expected);
  });
});
