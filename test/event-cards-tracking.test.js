import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
// Wiring guard for the event-cards block: prod tracks it as the rw_cards_container carousel — each
// .event-card is an rw_card_N slot, the arrows are rw_carousel_control, and CTAs key off cards:<id>
// so the sheet's authored wa-links (cards:register -> nahb-builders-cta) resolve.
import {
  initTracking, resetTrackingState, stampInteraction, trackIdOf,
} from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

// event-cards is data-driven (loadIndex); mock it with enough items to force the carousel/arrows.
vi.mock('../scripts/content-index.js', async (importActual) => ({
  ...(await importActual()),
  loadIndex: async () => ([
    { title: 'Event 1', status: 'upcoming', ctaUrl: 'https://x.example/reg1', ctaLabel: 'Register' },
    { title: 'Event 2', status: 'upcoming', ctaUrl: 'https://x.example/reg2', ctaLabel: 'Register' },
    { title: 'Event 3', status: 'upcoming', ctaUrl: 'https://x.example/reg3', ctaLabel: 'Register' },
    { title: 'Event 4', status: 'upcoming', ctaUrl: 'https://x.example/reg4', ctaLabel: 'Register' },
  ]),
  formatDate: () => '',
}));

const { default: decorate } = await import('../blocks/event-cards/event-cards.js');

async function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = document.createElement('div');
  block.className = 'event-cards upcoming block';
  block.setAttribute('data-block-name', 'event-cards');
  main.append(block); document.body.append(main);
  await decorate(block);
  initTracking(document);
  return block;
}

describe('event-cards — carousel tracking (rw_cards_container)', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('a card CTA resolves rw_cards_container|carousel|rw_card_N + keys off cards:<id>', async () => {
    const block = await setup();
    const cta = block.querySelector('.event-card a.button');
    expect(cta).not.toBeNull();
    stampInteraction({ target: cta });
    expect(computeTrackingPayload(cta).ui_access_point).toMatch(/^rw_cards_container\|carousel\|rw_card_\d+$/);
    // href-based id (label fallback resolves the sheet's cards:register row -> nahb-builders-cta)
    expect(trackIdOf(cta).startsWith('cards:')).toBe(true);
  });

  it('the nav arrows report rw_carousel_control + arrow_left/right at the carousel level', async () => {
    const block = await setup();
    const prev = block.querySelector('.events-arrow.prev');
    const next = block.querySelector('.events-arrow.next');
    expect(prev).not.toBeNull();
    expect(trackIdOf(prev)).toBe('cards:previous-events');
    expect(trackIdOf(next)).toBe('cards:next-events');

    stampInteraction({ target: prev });
    let p = computeTrackingPayload(prev);
    expect(p.ui_object).toBe('rw_carousel_control');
    expect(p.ui_object_detail).toBe('arrow_left');
    expect(p.link_name).toBe('rw_carousel_control-arrow_left');
    expect(p.ui_access_point).toBe('rw_cards_container|carousel');

    stampInteraction({ target: next });
    p = computeTrackingPayload(next);
    expect(p.ui_object_detail).toBe('arrow_right');
    expect(p.link_name).toBe('rw_carousel_control-arrow_right');
  });
});
