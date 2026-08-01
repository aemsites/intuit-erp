import { describe, it, expect } from 'vitest';
import decorate, { buildTooltip } from '../blocks/comparison-table/comparison-table.js';

function row(...cells) {
  return `<div>${cells.map((c) => `<div>${c}</div>`).join('')}</div>`;
}

function make(rowsHtml) {
  const block = document.createElement('div');
  block.className = 'comparison-table block';
  block.innerHTML = rowsHtml;
  return block;
}

describe('buildTooltip', () => {
  it('returns a button[aria-expanded=false] containing a .ct-tip-popover with the given text', () => {
    const btn = buildTooltip('Includes free onboarding calls.');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const popover = btn.querySelector('.ct-tip-popover');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toBe('Includes free onboarding calls.');
  });

  it('toggles aria-expanded on click', () => {
    const btn = buildTooltip('Some help text');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape when expanded', () => {
    const btn = buildTooltip('Some help text');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('comparison-table decorate', () => {
  it('renders a normal band row as .cmp-band (regression guard)', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      row('Onboarding timeline', 'Less than 2 months', '6 months', '4 months', '6 months'),
    ].join(''));
    decorate(block);
    const bands = block.querySelectorAll('.cmp-band');
    expect(bands.length).toBe(1);
    expect(bands[0].textContent.trim()).toBe('Implementation');
    expect(block.querySelector('.ct-legend')).toBeNull();
  });

  it('renders a final legend row as .ct-legend, not as a band', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      row('Onboarding timeline', 'Less than 2 months', '6 months', '4 months', '6 months'),
      '<div><div>Legend<span class="tip">Included in base subscription</span></div></div>',
    ].join(''));
    decorate(block);
    const legend = block.querySelector('.ct-legend');
    expect(legend).not.toBeNull();
    expect(legend.textContent.trim()).toBe('Included in base subscription');
    // the legend row must not also have produced an extra band
    expect(block.querySelectorAll('.cmp-band').length).toBe(1);
  });

  it('extracts a row-header tooltip (nested span.tip) into a button + popover, wired via aria-describedby', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      '<div><div>Onboarding timeline<span class="tip">Time to go live.</span></div>'
        + '<div>Less than 2 months</div><div>6 months</div><div>4 months</div><div>6 months</div></div>',
    ].join(''));
    decorate(block);
    const th = block.querySelector('th[scope="row"]');
    expect(th.childNodes[0].textContent.trim()).toBe('Onboarding timeline');
    const btn = th.querySelector('button');
    expect(btn).not.toBeNull();
    const describedbyId = th.getAttribute('aria-describedby');
    expect(describedbyId).toBeTruthy();
    const popover = th.querySelector('.ct-tip-popover');
    expect(popover.id).toBe(describedbyId);
    expect(popover.textContent).toBe('Time to go live.');
  });

  it('renders a row-header tooltip from a second <p> as well', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      '<div><div><p>Granular user roles</p><p>Row/field level permissions.</p></div>'
        + '<div>✓</div><div>✓</div><div>✓</div><div>✓</div></div>',
    ].join(''));
    decorate(block);
    const th = block.querySelector('th[scope="row"]');
    expect(th.textContent).toContain('Granular user roles');
    const popover = th.querySelector('.ct-tip-popover');
    expect(popover.textContent).toBe('Row/field level permissions.');
  });

  it('sets a data-adaptive attribute on the block for mobile card CSS', () => {
    const block = make(row('', 'A', 'B', 'C', 'D'));
    decorate(block);
    expect(block.hasAttribute('data-adaptive')).toBe(true);
  });

  it('tags each value cell with data-label matching its column header', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      row('Onboarding timeline', 'Less than 2 months', '6 months', '4 months', '6 months'),
    ].join(''));
    decorate(block);
    const tds = block.querySelectorAll('tbody tr:not(.cmp-band):not(.cmp-head) td');
    expect(tds[0].dataset.label).toBe('Intuit Enterprise Suite');
    expect(tds[3].dataset.label).toBe('MS Dynamics');
  });
});
