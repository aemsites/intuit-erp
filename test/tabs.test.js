import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorate, { parseItems, parseContent } from '../blocks/tabs/tabs.js';

// jsdom doesn't implement scrollIntoView; the base variant calls it on tab switch
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /width\s*<\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    let matches = false;
    if (max) matches = width < Number(max[1]);
    else if (min) matches = width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  };
}

function row(labelHtml, contentHtml) {
  return `<div><div>${labelHtml}</div><div>${contentHtml}</div></div>`;
}

function make(variant, rowsHtml) {
  const block = document.createElement('div');
  block.className = `tabs ${variant} block`.trim();
  block.innerHTML = rowsHtml;
  return block;
}

beforeEach(() => setViewport(1440));

describe('tabs field classifier (parseContent)', () => {
  function cell(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  it('classifies media, eyebrow, heading, and body', () => {
    const parts = parseContent(cell('<img src="a.png" alt=""><p>KICKER</p><h3>Heading</h3><p>Body copy.</p>'));
    expect(parts.media.tagName).toBe('IMG');
    expect(parts.eyebrow.textContent).toBe('KICKER');
    expect(parts.heading.textContent).toBe('Heading');
    expect(parts.bodyNodes).toHaveLength(1);
    expect(parts.bodyNodes[0].textContent).toBe('Body copy.');
  });

  it('treats a link-only paragraph as a CTA, not body copy', () => {
    const parts = parseContent(cell('<h3>H</h3><p>Body.</p><p><a href="/x">Learn more</a></p>'));
    expect(parts.cta).toEqual({ href: '/x', text: 'Learn more' });
    expect(parts.bodyNodes).toHaveLength(1);
  });

  it('extracts a blockquote + real <cite> as a quote', () => {
    const parts = parseContent(cell('<h3>H</h3><p>B</p><blockquote>Great product.</blockquote><cite>Jane Doe, CFO</cite>'));
    expect(parts.quote.textContent).toContain('Great product.');
    expect(parts.attribution).toBe('Jane Doe, CFO');
  });

  it('extracts attribution from a CMS-escaped "<cite>" paragraph when no real <cite> exists', () => {
    const parts = parseContent(cell('<h3>H</h3><p>B</p><blockquote>Great product.</blockquote><p>&lt;cite&gt; Jane Doe, CFO</p>'));
    expect(parts.attribution).toBe('Jane Doe, CFO');
  });

  it('keeps lists intact in body content', () => {
    const parts = parseContent(cell('<h3>H</h3><ul><li>One</li><li>Two</li></ul>'));
    expect(parts.bodyNodes).toHaveLength(1);
    expect(parts.bodyNodes[0].tagName).toBe('UL');
  });

  it('unwraps a rendered route that wraps picture+heading+text in one <p>', () => {
    const parts = parseContent(cell('<p><img src="a.png" alt=""><h3>Heading</h3><span>Body text</span></p>'));
    expect(parts.media).not.toBeNull();
    expect(parts.heading.textContent).toBe('Heading');
  });
});

describe('tabs label extraction (parseItems)', () => {
  it('reads an authored <img> icon and strips an EDS icon token from the label', () => {
    const block = make('', row('Construction', '<h3>H</h3><p>B</p>')
      + row('<img src="/i.svg" alt=""> Retail', '<h3>H2</h3><p>B2</p>'));
    const items = parseItems(block);
    expect(items[0].label).toBe('Construction');
    expect(items[0].icon).toBeNull();
    expect(items[1].label).toBe('Retail');
    expect(items[1].icon.tagName).toBe('IMG');
  });

  it('strips a raw :icon-name: token from the label text', () => {
    const block = make('', row(':construction: Construction', '<h3>H</h3><p>B</p>'));
    const items = parseItems(block);
    expect(items[0].label).toBe('Construction');
  });
});

describe('tabs (base): horizontal crossfade tablist', () => {
  function makeBase() {
    return make('', row('Multi-entity', '<img src="a.png" alt=""><p>EYEBROW</p><h3>Heading A</h3><p>Body A.</p>')
      + row('Reporting', '<img src="b.png" alt=""><h3>Heading B</h3><p>Body B.</p>'));
  }

  it('builds one tab + one crossfade panel per row, first active', () => {
    const block = makeBase();
    decorate(block);
    const tabs = block.querySelectorAll('.tab');
    const panels = block.querySelectorAll('.tab-panel');
    expect(tabs).toHaveLength(2);
    expect(panels).toHaveLength(2);
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(panels[0].classList.contains('is-active')).toBe(true);
    expect(panels[1].classList.contains('is-after')).toBe(true);
  });

  it('clicking a tab activates its panel and parks the others by relative position', () => {
    const block = makeBase();
    decorate(block);
    block.querySelectorAll('.tab')[1].click();
    const panels = block.querySelectorAll('.tab-panel');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    expect(panels[0].classList.contains('is-before')).toBe(true);
  });

  it('renders the eyebrow only when authored', () => {
    const block = makeBase();
    decorate(block);
    const panels = block.querySelectorAll('.tab-panel');
    expect(panels[0].querySelector('.eyebrow').textContent).toBe('EYEBROW');
    expect(panels[1].querySelector('.eyebrow')).toBeNull();
  });
});

describe('tabs.pill: vertical pill rail, true ARIA tablist', () => {
  function makePill() {
    return make('pill', row('QuickBooks Desktop', '<img src="a.png" alt=""><h3>Heading A</h3><p>Body A.</p><p><a href="/x">Schedule a call</a></p>')
      + row('QuickBooks Online', '<h3>Heading B</h3><p>Body B.</p>'));
  }

  it('builds nav buttons and panels, first active', () => {
    const block = makePill();
    decorate(block);
    const tabs = block.querySelectorAll('.vt-nav button[role="tab"]');
    const panels = block.querySelectorAll('.vt-panel[role="tabpanel"]');
    expect(tabs).toHaveLength(2);
    expect(panels).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('is-active')).toBe(true);
  });

  it('renders the CTA link from a link-only paragraph', () => {
    const block = makePill();
    decorate(block);
    const cta = block.querySelector('.vt-panel .vt-cta');
    expect(cta.getAttribute('href')).toBe('/x');
    expect(cta.textContent).toBe('Schedule a call');
  });

  it('gives same-label panel CTAs distinct semantic sheet identities', () => {
    const block = make('pill', [
      'From QuickBooks Desktop', 'From QuickBooks Online', 'From a non-Intuit solution',
    ].map((label) => row(label, '<h3>Heading</h3><p>Body.</p><p><a href="#schedule">Schedule a call</a></p>')).join(''));
    decorate(block);
    expect([...block.querySelectorAll('.vt-cta')].map(({ dataset }) => dataset.trackId)).toEqual([
      'tabs:from-quickbooks-desktop-schedule-a-call',
      'tabs:from-quickbooks-online-schedule-a-call',
      'tabs:from-a-non-intuit-solution-schedule-a-call',
    ]);
  });

  it('ArrowDown/ArrowUp move the active tab and panel', () => {
    const block = makePill();
    decorate(block);
    document.body.append(block);
    const tabs = block.querySelectorAll('.vt-nav button');
    const panels = block.querySelectorAll('.vt-panel');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[1].classList.contains('is-active')).toBe(true);
    block.remove();
  });
});

describe('tabs.vertical: disclosure accordion, shared media column', () => {
  function makeVertical() {
    return make('vertical', row('Single source of truth', '<img src="a.png" alt=""><p>Eliminate fragmented data.</p>')
      + row('Comprehensive reporting', '<img src="b.png" alt=""><p>Multi-dimensional KPIs.</p>'));
  }

  it('builds one item per row with the first open', () => {
    const block = makeVertical();
    decorate(block);
    const items = block.querySelectorAll('.vt-item');
    const regions = block.querySelectorAll('.vt-region');
    expect(items[0].classList.contains('is-open')).toBe(true);
    expect(regions[0].hidden).toBe(false);
    expect(regions[1].hidden).toBe(true);
  });

  it('opens the clicked item, closing the previous one, and swaps the shared media', () => {
    const block = makeVertical();
    decorate(block);
    block.querySelectorAll('.vt-tab')[1].click();
    const items = block.querySelectorAll('.vt-item');
    const medias = block.querySelectorAll('.vt-media');
    expect(items[1].classList.contains('is-open')).toBe(true);
    expect(items[0].classList.contains('is-open')).toBe(false);
    expect(medias[1].classList.contains('is-active')).toBe(true);
  });

  it('expands every item and drops disclosure semantics below 768px', () => {
    setViewport(390);
    const block = makeVertical();
    decorate(block);
    expect(block.querySelector('.vt-acc').classList.contains('is-stacked')).toBe(true);
    const regions = [...block.querySelectorAll('.vt-region')];
    expect(regions.every((r) => !r.hidden)).toBe(true);
  });
});

describe('tabs.navy: dark rail (desktop) / accordion (mobile)', () => {
  function makeNavy() {
    return make('navy', row(':construction: Construction', '<h3>Protect profit</h3><p>Body copy.</p><p><a href="/construction/">Explore</a></p><img src="/dash.png" alt=""><blockquote>Great product.</blockquote><cite>Scott, RedHammer</cite>')
      + row('Nonprofit', '<h3>H2</h3><p>B2</p>'));
  }

  it('builds N tabs + N panels (disclosure pattern, no tablist role)', () => {
    const block = makeNavy();
    decorate(block);
    expect(block.querySelector('[role="tablist"]')).toBeNull();
    const tabs = block.querySelectorAll('.it-tab');
    const panels = block.querySelectorAll('.it-panel');
    expect(tabs).toHaveLength(2);
    expect(panels).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('renders icon, media, quote/attribution, and CTA from authored content', () => {
    const block = makeNavy();
    decorate(block);
    const tab = block.querySelectorAll('.it-tab')[0];
    const panel = block.querySelectorAll('.it-panel')[0];
    expect(tab.textContent).toContain('Construction');
    expect(panel.querySelector('.it-media img[src="/dash.png"]')).not.toBeNull();
    expect(panel.querySelector('.it-quote blockquote').textContent).toContain('Great product.');
    expect(panel.querySelector('.it-quote cite').textContent).toContain('Scott');
    expect(panel.querySelector('.it-cta').getAttribute('href')).toBe('/construction/');
  });

  it('re-clicking the open tab collapses it on mobile but not on desktop', () => {
    setViewport(390);
    const block = makeNavy();
    decorate(block);
    const tabs = block.querySelectorAll('.it-tab');
    const panels = block.querySelectorAll('.it-panel');
    tabs[0].click();
    expect(panels[0].classList.contains('is-active')).toBe(false);
    expect(tabs[0].getAttribute('aria-expanded')).toBe('false');

    setViewport(1440);
    const desktopBlock = makeNavy();
    decorate(desktopBlock);
    const dTabs = desktopBlock.querySelectorAll('.it-tab');
    const dPanels = desktopBlock.querySelectorAll('.it-panel');
    dTabs[0].click();
    expect(dPanels[0].classList.contains('is-active')).toBe(true);
  });
});
