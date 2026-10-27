import {
  beforeEach, describe, expect, it,
} from 'vitest';
import decorate from '../blocks/disclosure/disclosure.js';

function mount(classes = '') {
  const main = document.querySelector('main') || document.body.appendChild(document.createElement('main'));
  main.insertAdjacentHTML('beforeend', `<div class="disclosure block ${classes}">`
    + '<div><div>Important pricing details</div></div>'
    + '<div><div><p>Terms <a href="https://example.com/terms">terms link</a></p></div></div></div>');
  const block = main.lastElementChild;
  decorate(block);
  return block;
}

describe('disclosure expanded variation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('renders static content without details/summary', () => {
    const block = mount('expanded');
    expect(block.querySelector('details')).toBeNull();
    expect(block.querySelector('summary')).toBeNull();
    expect(block.querySelector('.disc-caret')).toBeNull();
    expect(block.querySelector('.disclosure-title').textContent).toBe('Important pricing details');
    const body = block.querySelector('.disclosure-body');
    expect(body.querySelector('p')).not.toBeNull();
    expect(body.querySelector('a[href="https://example.com/terms"]')).not.toBeNull();
  });

  it('keeps the title non-interactive', () => {
    const block = mount('expanded');
    const title = block.querySelector('.disclosure-title');
    expect(title.tagName).toBe('P');
    expect(title.hasAttribute('tabindex')).toBe(false);
    expect(title.hasAttribute('role')).toBe(false);
    expect(title.hasAttribute('aria-expanded')).toBe(false);
    expect(block.querySelector('summary, button, [role="button"], [aria-expanded], [aria-controls]')).toBeNull();
  });

  it('keeps the body as a region labelled by the title', () => {
    const block = mount('expanded');
    const title = block.querySelector('.disclosure-title');
    const body = block.querySelector('.disclosure-body');
    expect(title.id).toMatch(/^disclosure-title-\d+$/);
    expect(body.getAttribute('role')).toBe('region');
    expect(body.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('keeps body links focusable', () => {
    const block = mount('expanded');
    const link = block.querySelector('.disclosure-body a[href]');
    expect(link.tabIndex).toBe(0);
  });

  it('makes the first disclosure the #disclaimer anchor target', () => {
    const first = mount('expanded');
    const second = mount('expanded');
    expect(first.querySelector('.disclosure-item').id).toBe('disclaimer');
    expect(second.querySelector('.disclosure-item').id).toBe('');

    window.location.hash = '#disclaimer';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(first.querySelector('.disclosure-body a[href]')).not.toBeNull();
  });

  it('combines with visual variants', () => {
    const block = mount('white expanded');
    expect(block.classList.contains('white')).toBe(true);
    expect(block.classList.contains('expanded')).toBe(true);
    expect(block.querySelector('details')).toBeNull();
    expect(block.querySelector('div.disclosure-item > p.disclosure-title + .disclosure-body')).not.toBeNull();
  });
});

describe('disclosure default variation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is unchanged', () => {
    const block = mount();
    expect(block.querySelector('details.disclosure-item > summary .disc-caret')).not.toBeNull();
    expect(block.querySelector('details.disclosure-item > .disclosure-body')).not.toBeNull();
    expect(block.querySelector('summary').id).toMatch(/^disclosure-summary-\d+$/);
    expect(block.querySelector('.disclosure-title')).toBeNull();
  });
});
