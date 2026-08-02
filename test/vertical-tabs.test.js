import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorate from '../blocks/vertical-tabs/vertical-tabs.js';

/**
 * The block's two variants have different interaction models, so the default
 * (accordion) and .pill (tabs) DOM are asserted separately.
 *
 * The accordion also has a stacked mobile mode driven by matchMedia, which jsdom
 * stubs as always-false unless overridden — setViewport() below fakes a width so
 * both modes are covered.
 */
function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /width\s*<\s*(\d+)px/.exec(query);
    return {
      matches: max ? width < Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  };
}

function make(variant = '') {
  const block = document.createElement('div');
  block.className = `vertical-tabs ${variant} block`.trim();
  block.innerHTML = `
    <div><div>Single source of truth</div><div>Comprehensive reporting</div></div>
    <div><div><img src="a.png" alt=""></div><div>Single source of truth</div><div>Eliminate fragmented data.</div></div>
    <div><div><img src="b.png" alt=""></div><div>Comprehensive reporting</div><div>Multi-dimensional KPIs.</div></div>`;
  return block;
}

beforeEach(() => setViewport(1440));

describe('vertical-tabs (default) — accordion', () => {
  it('builds one item per row with the first open', () => {
    const block = make();
    decorate(block);
    const items = block.querySelectorAll('.vt-item');
    const regions = block.querySelectorAll('.vt-region');
    expect(items.length).toBe(2);
    expect(items[0].classList.contains('is-open')).toBe(true);
    expect(items[1].classList.contains('is-open')).toBe(false);
    expect(regions[0].hidden).toBe(false);
    expect(regions[1].hidden).toBe(true);
    expect(block.querySelectorAll('.vt-tab')[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the clicked item and closes the previous one', () => {
    const block = make();
    decorate(block);
    block.querySelectorAll('.vt-tab')[1].click();
    const items = block.querySelectorAll('.vt-item');
    const regions = block.querySelectorAll('.vt-region');
    expect(items[1].classList.contains('is-open')).toBe(true);
    expect(items[0].classList.contains('is-open')).toBe(false);
    expect(regions[1].hidden).toBe(false);
    expect(regions[0].hidden).toBe(true);
  });

  it('shows the open item\'s image in the shared media column', () => {
    const block = make();
    decorate(block);
    const medias = block.querySelectorAll('.vt-media');
    expect(medias[0].classList.contains('is-active')).toBe(true);
    block.querySelectorAll('.vt-tab')[1].click();
    expect(medias[1].classList.contains('is-active')).toBe(true);
    expect(medias[0].classList.contains('is-active')).toBe(false);
  });

  it('gives every item its own inline image for the stacked layout', () => {
    const block = make();
    decorate(block);
    // one per item, in addition to the shared media column's copies
    expect(block.querySelectorAll('.vt-item-media img').length).toBe(2);
  });

  it('ArrowDown/ArrowUp move focus between headers', () => {
    const block = make();
    decorate(block);
    document.body.append(block); // focus() needs the node connected
    const headers = block.querySelectorAll('.vt-tab');
    headers[0].focus();
    headers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(headers[1]);
    headers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(headers[0]);
    block.remove();
  });

  describe('below 768px (stacked)', () => {
    it('expands every item and drops the disclosure semantics', () => {
      setViewport(390);
      const block = make();
      decorate(block);
      expect(block.querySelector('.vt-acc').classList.contains('is-stacked')).toBe(true);
      const regions = [...block.querySelectorAll('.vt-region')];
      expect(regions.every((r) => !r.hidden)).toBe(true);
      const headers = [...block.querySelectorAll('.vt-tab')];
      // no aria-expanded: the headers no longer control anything
      expect(headers.every((h) => !h.hasAttribute('aria-expanded'))).toBe(true);
      expect(headers.every((h) => h.disabled)).toBe(true);
    });

    it('ignores clicks — everything is already open', () => {
      setViewport(390);
      const block = make();
      decorate(block);
      block.querySelectorAll('.vt-tab')[1].click();
      const regions = [...block.querySelectorAll('.vt-region')];
      expect(regions.every((r) => !r.hidden)).toBe(true);
    });
  });
});

describe('vertical-tabs.pill — tabs', () => {
  it('builds nav buttons and panels, first active', () => {
    const block = make('pill');
    decorate(block);
    const tabs = block.querySelectorAll('.vt-nav button[role="tab"]');
    const panels = block.querySelectorAll('.vt-panel[role="tabpanel"]');
    expect(tabs.length).toBe(2);
    expect(panels.length).toBe(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(panels[1].classList.contains('is-active')).toBe(false);
  });

  it('activates the second panel on click', () => {
    const block = make('pill');
    decorate(block);
    block.querySelectorAll('.vt-nav button')[1].click();
    const panels = block.querySelectorAll('.vt-panel');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(false);
  });

  it('ArrowDown/ArrowUp move the active tab and panel (vertical tablist keys)', () => {
    const block = make('pill');
    decorate(block);
    document.body.append(block); // focus() only affects activeElement when connected
    const tabs = block.querySelectorAll('.vt-nav button');
    const panels = block.querySelectorAll('.vt-panel');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(false);

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(panels[1].classList.contains('is-active')).toBe(false);

    block.remove();
  });
});
