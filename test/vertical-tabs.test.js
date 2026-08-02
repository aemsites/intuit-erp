import { describe, it, expect } from 'vitest';
import decorate from '../blocks/vertical-tabs/vertical-tabs.js';

function make() {
  const block = document.createElement('div');
  block.className = 'vertical-tabs block';
  block.innerHTML = `
    <div><div>Single source of truth</div><div>Comprehensive reporting</div></div>
    <div><div><img src="a.png" alt=""></div><div>Single source of truth</div><div>Eliminate fragmented data.</div></div>
    <div><div><img src="b.png" alt=""></div><div>Comprehensive reporting</div><div>Multi-dimensional KPIs.</div></div>`;
  return block;
}

describe('vertical-tabs', () => {
  it('builds nav buttons and panels, first active', () => {
    const block = make();
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
    const block = make();
    decorate(block);
    block.querySelectorAll('.vt-nav button')[1].click();
    const panels = block.querySelectorAll('.vt-panel');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(false);
  });
  it('ArrowDown/ArrowUp move the active tab and panel (vertical tablist keys)', () => {
    const block = make();
    decorate(block);
    document.body.append(block); // focus() only affects document.activeElement when connected
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
