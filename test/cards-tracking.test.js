import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the carousel: the prev/next arrows (and dots) live in
// .cards-controls, a sibling of .cards-track — prod reports them at the carousel level
// (rw_cards_container|carousel), while real cards are rw_cards_container|carousel|rw_card_N.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/cards/cards.js');

function makeCarousel() {
  const block = document.createElement('div');
  block.className = 'cards carousel block';
  block.setAttribute('data-block-name', 'cards');
  block.innerHTML = `
    <div><div><picture><img src="/a.png" alt="a"></picture></div><div><h3>Card one</h3><p class="button-container"><a class="button" href="/one">Find out more</a></p></div></div>
    <div><div><picture><img src="/b.png" alt="b"></picture></div><div><h3>Card two</h3><p class="button-container"><a class="button" href="/two">Find out more</a></p></div></div>`;
  return block;
}

function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeCarousel();
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('cards — carousel control tracking', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('carousel nav arrows resolve to rw_cards_container|carousel (not a card)', () => {
    const block = setup();
    const nav = block.querySelector('.cards-controls .cards-nav-buttons button');
    expect(nav).not.toBeNull();
    stampInteraction({ target: nav });
    expect(computeTrackingPayload(nav).ui_access_point).toBe('rw_cards_container|carousel');
  });

  it('card CTAs still resolve to a per-card trail', () => {
    const block = setup();
    const cta = block.querySelector('.cards-track a.button');
    expect(cta).not.toBeNull();
    stampInteraction({ target: cta });
    expect(computeTrackingPayload(cta).ui_access_point).toMatch(/^rw_cards_container\|carousel\|rw_card_\d+$/);
  });
});
