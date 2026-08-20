import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorate from '../blocks/promo-banner/promo-banner.js';

function make(rows) {
  const block = document.createElement('div');
  block.className = 'promo-banner block';
  block.innerHTML = rows.map((cell) => `<div><div>${cell}</div></div>`).join('');
  return block;
}

describe('promo-banner block', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('renders message text and marks the inline link as the CTA', () => {
    const block = make(['<p>Get 50% OFF QuickBooks for 3 months <a href="/pricing">Buy now</a></p>']);
    decorate(block);
    const message = block.querySelector('.promo-banner-message');
    expect(message.textContent).toContain('Get 50% OFF QuickBooks for 3 months');
    const cta = block.querySelector('a.promo-banner-cta');
    expect(cta).not.toBeNull();
    expect(cta.textContent).toBe('Buy now');
  });

  it('renders without a CTA when the message has no link', () => {
    const block = make(['<p>QuickBooks is currently experiencing scheduled maintenance.</p>']);
    decorate(block);
    expect(block.querySelector('a.promo-banner-cta')).toBeNull();
    expect(block.querySelector('.promo-banner-message').textContent).toContain('scheduled maintenance');
  });

  it('does not render a close button when not marked dismissible', () => {
    const block = make(['<p>Some message</p>']);
    decorate(block);
    expect(block.querySelector('.promo-banner-close')).toBeNull();
  });

  it('renders a close button when marked dismissible', () => {
    const block = make(['<p>Some message</p>', 'dismissible']);
    decorate(block);
    expect(block.querySelector('.promo-banner-close')).not.toBeNull();
  });

  it('removes the block and persists dismissal in sessionStorage on close', () => {
    const block = make(['<p>Some message</p>', 'dismissible']);
    document.body.append(block);
    decorate(block);
    const closeBtn = block.querySelector('.promo-banner-close');
    closeBtn.click();
    expect(document.body.contains(block)).toBe(false);
    expect(window.sessionStorage.getItem(`promo-banner-dismissed:${window.location.pathname}`)).toBe('true');
  });

  it('does not render when previously dismissed in this session', () => {
    window.sessionStorage.setItem(`promo-banner-dismissed:${window.location.pathname}`, 'true');
    const block = make(['<p>Some message</p>', 'dismissible']);
    document.body.append(block);
    decorate(block);
    expect(document.body.contains(block)).toBe(false);
  });
});
