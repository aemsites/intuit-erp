import {
  describe, it, expect, vi,
} from 'vitest';
import { renderPanels } from '../blocks/industry-tabs/industry-tabs.js';

const data = [
  {
    label: 'Construction', heading: 'H', body: 'B', image: '/i.png',
  },
  { label: 'Retail', heading: 'H2', body: 'B2' },
];

function make() {
  const el = document.createElement('div');
  el.className = 'industry-tabs block';
  return el;
}

describe('industry-tabs renderPanels', () => {
  it('builds N tabs + N panels, first tab/panel active', () => {
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('[role="tab"]');
    const panels = el.querySelectorAll('[role="tabpanel"]');
    expect(tabs.length).toBe(2);
    expect(panels.length).toBe(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(panels[1].classList.contains('is-active')).toBe(false);
  });

  it('sets up full ARIA wiring: tablist, aria-controls, roving tabindex', () => {
    const el = make();
    renderPanels(el, data);
    const nav = el.querySelector('[role="tablist"]');
    expect(nav).not.toBeNull();
    const tabs = el.querySelectorAll('[role="tab"]');
    const panels = el.querySelectorAll('[role="tabpanel"]');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panels[0].id);
    expect(tabs[1].getAttribute('aria-controls')).toBe(panels[1].id);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it('renders heading/body/image content into panels', () => {
    const el = make();
    renderPanels(el, data);
    const panels = el.querySelectorAll('[role="tabpanel"]');
    expect(panels[0].textContent).toContain('H');
    expect(panels[0].textContent).toContain('B');
    expect(panels[0].querySelector('img')).not.toBeNull();
    expect(panels[1].querySelector('img')).toBeNull();
  });

  it('clicking the second tab activates the second panel', () => {
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('[role="tab"]');
    const panels = el.querySelectorAll('[role="tabpanel"]');
    tabs[1].click();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(false);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
  });

  it('ArrowRight/ArrowLeft move the active tab and panel (horizontal tablist keys)', () => {
    const el = make();
    renderPanels(el, data);
    document.body.append(el);
    const tabs = el.querySelectorAll('[role="tab"]');
    const panels = el.querySelectorAll('[role="tabpanel"]');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[1].classList.contains('is-active')).toBe(true);

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('is-active')).toBe(true);

    el.remove();
  });

  it('Home/End move focus+activation to first/last tab', () => {
    const el = make();
    renderPanels(el, data);
    document.body.append(el);
    const tabs = el.querySelectorAll('[role="tab"]');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    el.remove();
  });

  it('degrades gracefully (renders nothing) on empty data, without throwing', () => {
    const el = make();
    expect(() => renderPanels(el, [])).not.toThrow();
    expect(el.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(el.querySelectorAll('[role="tabpanel"]').length).toBe(0);
  });
});

describe('industry-tabs decorate (network isolation)', () => {
  it('fetches the JSON URL from the block cell link and renders panels on success (bare array)', async () => {
    const { default: decorate } = await import('../blocks/industry-tabs/industry-tabs.js');
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div><div><a href="/foo/data.json">data.json</a></div></div>';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => data,
    });
    await decorate(block);
    expect(globalThis.fetch).toHaveBeenCalledWith('/foo/data.json');
    expect(block.querySelectorAll('[role="tab"]').length).toBe(2);
  });

  it('handles a { data: [...] } wrapped shape', async () => {
    const { default: decorate } = await import('../blocks/industry-tabs/industry-tabs.js');
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div><div><a href="/foo/data.json">data.json</a></div></div>';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data }),
    });
    await decorate(block);
    expect(block.querySelectorAll('[role="tab"]').length).toBe(2);
  });

  it('degrades gracefully without throwing when fetch fails', async () => {
    const { default: decorate } = await import('../blocks/industry-tabs/industry-tabs.js');
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div><div><a href="/foo/data.json">data.json</a></div></div>';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(decorate(block)).resolves.not.toThrow();
    expect(block.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('degrades gracefully without throwing when the response is not ok', async () => {
    const { default: decorate } = await import('../blocks/industry-tabs/industry-tabs.js');
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div><div><a href="/foo/data.json">data.json</a></div></div>';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    await expect(decorate(block)).resolves.not.toThrow();
    expect(block.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('degrades gracefully without throwing when there is no source link', async () => {
    const { default: decorate } = await import('../blocks/industry-tabs/industry-tabs.js');
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    globalThis.fetch = vi.fn();
    await expect(decorate(block)).resolves.not.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(block.querySelectorAll('[role="tab"]').length).toBe(0);
  });
});
