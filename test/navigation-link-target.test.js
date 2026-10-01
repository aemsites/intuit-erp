import {
  describe, it, expect,
} from 'vitest';
import decorate from '../blocks/navigation/navigation.js';

describe('navigation authored link targets', () => {
  it('applies target markers to rendered flyout and top-level links', () => {
    const block = document.createElement('div');
    block.innerHTML = `
      <div>
        <div>Logo</div>
        <div>
          <ul>
            <li><p>Products</p><ul><li><a href="/guide#faq#target=_blank">Guide</a></li></ul></li>
            <li><a href="https://partner.example/page#section#target=_self">Partner</a></li>
          </ul>
        </div>
      </div>`;

    decorate(block);

    const guide = block.querySelector('.flyout-link');
    expect(guide.getAttribute('href')).toBe('/guide#faq');
    expect(guide.target).toBe('_blank');
    expect(guide.relList.contains('noopener')).toBe(true);

    const partner = block.querySelector('.nav-link');
    expect(partner.getAttribute('href')).toBe('https://partner.example/page#section');
    expect(partner.target).toBe('_self');
  });
});
