import { describe, it, expect } from 'vitest';
import decorate from '../blocks/highlight/highlight.js';

function make(inner) {
  const block = document.createElement('div');
  block.className = 'highlight block';
  block.innerHTML = `<div><div>${inner}</div></div>`;
  return block;
}

describe('highlight block', () => {
  it('wraps authored content in .highlight-inner and preserves nodes', () => {
    const block = make('<h2>Key takeaways:</h2><ul><li>One</li><li>Two</li></ul>');
    decorate(block);
    const inner = block.querySelector('.highlight-inner');
    expect(inner).not.toBeNull();
    expect(inner.querySelector('h2').textContent).toBe('Key takeaways:');
    expect(inner.querySelectorAll('li').length).toBe(2);
  });
});
