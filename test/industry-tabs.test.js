import {
  describe, it, expect, vi,
} from 'vitest';
import decorate, { renderPanels } from '../blocks/industry-tabs/industry-tabs.js';

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

// the block branches on the 900px breakpoint (collapsible accordion vs tab rail)
function matchMediaDesktop(isDesktop) {
  window.matchMedia = vi.fn(() => ({ matches: isDesktop }));
}

describe('industry-tabs renderPanels', () => {
  it('builds N tabs + N panels, first tab/panel active', () => {
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    expect(tabs.length).toBe(2);
    expect(panels.length).toBe(2);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
    expect(tabs[1].getAttribute('aria-expanded')).toBe('false');
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(panels[1].classList.contains('is-active')).toBe(false);
  });

  it('sets up full ARIA wiring: aria-controls, roving tabindex (no tablist — disclosure pattern)', () => {
    const el = make();
    renderPanels(el, data);
    // panels render inside the same nav as the tabs (interleaved, for the mobile
    // accordion layout); the tabs pattern forbids that nesting under a tablist,
    // so this intentionally has no role="tablist"/"tab"/"tabpanel" at all.
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('[role="tab"]')).toBeNull();
    expect(el.querySelector('[role="tabpanel"]')).toBeNull();
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panels[0].id);
    expect(tabs[1].getAttribute('aria-controls')).toBe(panels[1].id);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it('renders heading/body/image content into panels', () => {
    const el = make();
    renderPanels(el, data);
    const panels = el.querySelectorAll('[role="region"]');
    expect(panels[0].textContent).toContain('H');
    expect(panels[0].textContent).toContain('B');
    expect(panels[0].querySelector('img')).not.toBeNull();
    expect(panels[1].querySelector('img')).toBeNull();
  });

  it('clicking the second tab activates the second panel', () => {
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    tabs[1].click();
    expect(tabs[1].getAttribute('aria-expanded')).toBe('true');
    expect(tabs[0].getAttribute('aria-expanded')).toBe('false');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(false);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
  });

  it('ArrowRight/ArrowLeft move the active tab and panel (horizontal tablist keys)', () => {
    const el = make();
    renderPanels(el, data);
    document.body.append(el);
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-expanded')).toBe('true');
    expect(panels[1].classList.contains('is-active')).toBe(true);

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
    expect(panels[0].classList.contains('is-active')).toBe(true);

    el.remove();
  });

  it('Home/End move focus+activation to first/last tab', () => {
    const el = make();
    renderPanels(el, data);
    document.body.append(el);
    const tabs = el.querySelectorAll('.it-tab');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tabs[1].getAttribute('aria-expanded')).toBe('true');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
    el.remove();
  });

  it('re-clicking the open tab collapses it on mobile (accordion)', () => {
    matchMediaDesktop(false);
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    tabs[0].click();
    expect(panels[0].classList.contains('is-active')).toBe(false);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('false');
    // the collapsed row stays keyboard-reachable
    expect(tabs[0].tabIndex).toBe(0);

    tabs[0].click();
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('re-clicking the open tab does NOT collapse it on desktop (tab rail)', () => {
    matchMediaDesktop(true);
    const el = make();
    renderPanels(el, data);
    const tabs = el.querySelectorAll('.it-tab');
    const panels = el.querySelectorAll('[role="region"]');
    tabs[0].click();
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('degrades gracefully (renders nothing) on empty data, without throwing', () => {
    const el = make();
    expect(() => renderPanels(el, [])).not.toThrow();
    expect(el.querySelectorAll('.it-tab').length).toBe(0);
    expect(el.querySelectorAll('[role="region"]').length).toBe(0);
  });

  it('renders a tab icon when the item carries icon markup', () => {
    const el = make();
    renderPanels(el, [
      {
        label: 'Construction', heading: 'H', body: 'B', icon: '<span class="icon icon-construction"></span>',
      },
      { label: 'Retail', heading: 'H2', body: 'B2' },
    ]);
    const tabs = el.querySelectorAll('.it-tab');
    expect(tabs[0].querySelector('.icon.icon-construction')).not.toBeNull();
    expect(tabs[0].textContent).toContain('Construction');
    expect(tabs[1].querySelector('.icon')).toBeNull();
  });

  it('renders a panel quote + attribution when present', () => {
    const el = make();
    renderPanels(el, [
      {
        label: 'Construction', heading: 'H', body: 'B', quote: 'Great product.', attribution: 'Scott Franchini, Partner, RedHammer',
      },
      { label: 'Retail', heading: 'H2', body: 'B2' },
    ]);
    const panels = el.querySelectorAll('[role="region"]');
    expect(panels[0].querySelector('.it-quote blockquote').textContent).toContain('Great product.');
    expect(panels[0].querySelector('.it-quote cite').textContent).toContain('Scott Franchini');
    expect(panels[1].querySelector('.it-quote')).toBeNull();
  });
});

describe('industry-tabs parseAuthored (via decorate)', () => {
  it('extracts icon markup and quote/attribution from authored rows', () => {
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div>'
      + '<div><img src="/construction-icon.svg" alt=""> Construction</div>'
      + '<div><h3>Protect profit</h3><p>Body copy here.</p>'
      + '<p><a href="/construction/">Explore construction edition</a></p>'
      + '<img src="/dash.png" alt="Construction dashboard"><blockquote>Finally connects.</blockquote>'
      + '<cite>Scott Franchini, Partner, RedHammer</cite></div>'
      + '</div>';
    decorate(block);
    const tab = block.querySelector('.it-tab');
    const panel = block.querySelector('[role="region"]');
    expect(tab.querySelector('img[src="/construction-icon.svg"]')).not.toBeNull();
    expect(tab.textContent).toContain('Construction');
    expect(panel.querySelector('.it-media img[src="/dash.png"]')).not.toBeNull();
    expect(panel.querySelector('.it-quote blockquote').textContent).toContain('Finally connects.');
    expect(panel.querySelector('.it-quote cite').textContent).toContain('Scott Franchini');
    expect(panel.textContent).toContain('Body copy here.');
  });
});

describe('industry-tabs decorate (authored content only)', () => {
  it('renders tabs+panels from authored rows, without any fetch', () => {
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    block.innerHTML = '<div><div>Construction</div><div><h3>H</h3><p>B</p></div></div>'
      + '<div><div>Retail</div><div><h3>H2</h3><p>B2</p></div></div>';
    globalThis.fetch = vi.fn();
    decorate(block);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(block.querySelectorAll('.it-tab').length).toBe(2);
    expect(block.querySelectorAll('[role="region"]').length).toBe(2);
    expect(block.querySelector('[role="region"]').textContent).toContain('H');
  });

  it('renders nothing (no throw) for an empty block', () => {
    const block = document.createElement('div');
    block.className = 'industry-tabs block';
    expect(() => decorate(block)).not.toThrow();
    expect(block.querySelectorAll('.it-tab').length).toBe(0);
  });
});
