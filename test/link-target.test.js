import {
  describe, it, expect,
} from 'vitest';
import decorateLinkTargets from '../scripts/link-target.js';

describe('author-controlled link targets', () => {
  it('supports both targets and preserves queries and existing fragments', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="/account?plan=pro#details#target=_blank" rel="nofollow">New tab</a>
      <a href="https://partner.example/help#support#target=_self" target="_blank">Same tab</a>`;

    decorateLinkTargets(main);

    const [newTab, sameTab] = main.querySelectorAll('a');
    expect(newTab.getAttribute('href')).toBe('/account?plan=pro#details');
    expect(newTab.target).toBe('_blank');
    expect(newTab.relList.contains('nofollow')).toBe(true);
    expect(newTab.relList.contains('noopener')).toBe(true);
    expect(sameTab.getAttribute('href')).toBe('https://partner.example/help#support');
    expect(sameTab.target).toBe('_self');
  });

  it('keeps current behavior for unmarked links and ignores unsupported markers', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="https://partner.example/page">External</a>
      <a href="/internal">Internal</a>
      <a href="/page#target=_parent">Unsupported</a>`;

    decorateLinkTargets(main);

    const [external, internal, unsupported] = main.querySelectorAll('a');
    expect(external.hasAttribute('target')).toBe(false);
    expect(internal.hasAttribute('target')).toBe(false);
    expect(unsupported.getAttribute('href')).toBe('/page#target=_parent');
    expect(unsupported.hasAttribute('target')).toBe(false);
  });
});
