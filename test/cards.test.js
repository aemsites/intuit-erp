import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorate from '../blocks/cards/cards.js';

// Builds a single icon card: [icon cell][body cell], wrapped in a cards block.
function makeBlock(variant, bodyInner) {
  const block = document.createElement('div');
  block.className = variant;
  const row = document.createElement('div');
  const iconCell = document.createElement('div');
  iconCell.innerHTML = '<picture><img src="/icon.svg" alt=""></picture>';
  const bodyCell = document.createElement('div');
  bodyCell.innerHTML = bodyInner;
  row.append(iconCell, bodyCell);
  block.append(row);
  return block;
}

describe('cards .icons eyebrow grouping', () => {
  beforeEach(() => { window.hlx = { codeBasePath: '' }; });

  it('promotes a plain label paragraph before the heading into the head, inline with the icon', () => {
    const block = makeBlock('cards icons block', '<p>GUIDED SETUP</p><h3>Get the support you need</h3><p>Body copy.</p>');
    decorate(block);
    const head = block.querySelector('.cards-card-head');
    expect(head).toBeTruthy();
    // both icon and eyebrow live in the head (rendered side by side by CSS)
    expect(head.querySelector('.cards-card-image')).toBeTruthy();
    const eyebrow = head.querySelector('.cards-eyebrow');
    expect(eyebrow).toBeTruthy();
    expect(eyebrow.textContent.trim()).toBe('GUIDED SETUP');
    // the heading stays behind in the body
    expect(block.querySelector('.cards-card-body h3')).toBeTruthy();
  });

  it('still groups an italic-authored eyebrow (existing behaviour)', () => {
    const block = makeBlock('cards icons block', '<p><em>SMOOTH IMPLEMENTATION</em></p><h3>Title</h3>');
    decorate(block);
    const eyebrow = block.querySelector('.cards-card-head .cards-eyebrow');
    expect(eyebrow).toBeTruthy();
    expect(eyebrow.textContent.trim()).toBe('SMOOTH IMPLEMENTATION');
  });

  it('does not promote anything when the card has no label (body starts with the heading)', () => {
    const block = makeBlock('cards icons block', '<h3>Title</h3><p>Body copy.</p>');
    decorate(block);
    const head = block.querySelector('.cards-card-head');
    expect(head).toBeTruthy();
    expect(head.querySelector('.cards-eyebrow')).toBeNull(); // only the icon in the head
    expect(block.querySelector('.cards-eyebrow')).toBeNull();
  });

  it('does not promote a leading paragraph that is not followed by a heading', () => {
    const block = makeBlock('cards icons block', '<p>Just body text.</p><p>More body.</p>');
    decorate(block);
    expect(block.querySelector('.cards-eyebrow')).toBeNull();
    expect(block.querySelector('.cards-card-head .cards-eyebrow')).toBeNull();
  });

  it('leaves non-icons variants untouched (no head, plain label not made an eyebrow)', () => {
    const block = makeBlock('cards block', '<p>GUIDED SETUP</p><h3>Title</h3>');
    decorate(block);
    expect(block.querySelector('.cards-card-head')).toBeNull();
    expect(block.querySelector('.cards-eyebrow')).toBeNull();
  });
});
