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
  it('returns a .ct-tip wrapper with a button.ct-tip-btn[aria-expanded=false] and a sibling .ct-tip-popover holding the text', () => {
    const wrapper = buildTooltip('Includes free onboarding calls.');
    expect(wrapper.classList.contains('ct-tip')).toBe(true);
    const btn = wrapper.querySelector('button.ct-tip-btn');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const popover = wrapper.querySelector('.ct-tip-popover');
    expect(popover).not.toBeNull();
    expect(popover.textContent).toBe('Includes free onboarding calls.');
    // the popover must be a SIBLING of the button, not nested inside it —
    // otherwise a click on the popover's own text bubbles into the button's
    // click handler and immediately re-closes it (click-trap).
    expect(btn.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(wrapper);
  });

  it('toggles aria-expanded on click', () => {
    const wrapper = buildTooltip('Some help text');
    const btn = wrapper.querySelector('button');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape when expanded', () => {
    const wrapper = buildTooltip('Some help text');
    const btn = wrapper.querySelector('button');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('a click on the popover text itself does not close the tooltip (no click-trap)', () => {
    const wrapper = buildTooltip('Some help text');
    document.body.append(wrapper);
    const btn = wrapper.querySelector('button');
    const popover = wrapper.querySelector('.ct-tip-popover');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    popover.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    wrapper.remove();
  });

  it('closes when a click lands outside the wrapper (document click-outside)', () => {
    const wrapper = buildTooltip('Some help text');
    document.body.append(wrapper);
    const btn = wrapper.querySelector('button');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    document.body.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    wrapper.remove();
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

  it('renders a final single-cell legend row (nested tip) as .ct-legend, not as a band', () => {
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

  it('renders a two-cell legend row ([legend, text]) as .ct-legend, not as a band', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      row('Onboarding timeline', 'Less than 2 months', '6 months', '4 months', '6 months'),
      row('legend', 'Included in base subscription'),
    ].join(''));
    decorate(block);
    const legend = block.querySelector('.ct-legend');
    expect(legend).not.toBeNull();
    expect(legend.textContent.trim()).toBe('Included in base subscription');
    expect(block.querySelectorAll('.cmp-band').length).toBe(1);
  });

  it('treats a single-cell "Legend" row as legend even with no tip/text at all (never a band)', () => {
    const block = make([
      row('', 'Intuit Enterprise Suite', 'NetSuite', 'Sage Intacct', 'MS Dynamics'),
      row('Implementation'),
      row('Onboarding timeline', 'Less than 2 months', '6 months', '4 months', '6 months'),
      '<div><div>Legend</div></div>',
    ].join(''));
    decorate(block);
    expect(block.querySelectorAll('.cmp-band').length).toBe(1);
    const legend = block.querySelector('.ct-legend');
    expect(legend).not.toBeNull();
    expect(legend.textContent.trim()).toBe('');
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
    // popover is a sibling of the button, not nested inside it
    expect(btn.contains(popover)).toBe(false);
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
