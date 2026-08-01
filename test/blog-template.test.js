import { describe, it, expect } from 'vitest';
import { buildToc, buildByline } from '../blocks/blog-template/blog-template.js';

describe('buildToc', () => {
  it('creates TOC links for each h2/h3 and assigns missing ids', () => {
    const main = document.createElement('main');
    main.innerHTML = '<h2>Expanding across the US</h2><p>x</p><h3>Detail</h3><h2>Results</h2>';
    const nav = buildToc(main);
    const links = nav.querySelectorAll('a');
    expect(links.length).toBe(3);
    expect(main.querySelector('h2').id).toBeTruthy();
    expect(links[0].getAttribute('href')).toBe(`#${main.querySelector('h2').id}`);
  });

  it('returns null when there are fewer than 2 headings', () => {
    const main = document.createElement('main');
    main.innerHTML = '<h2>Only one</h2>';
    expect(buildToc(main)).toBeNull();
  });
});

describe('buildByline', () => {
  it('renders author, tag and dates', () => {
    const el = buildByline({
      author: 'Bryan Bui', tag: 'Case study', date: 'March 24, 2026', updated: 'April 1, 2026',
    });
    expect(el.textContent).toContain('Bryan Bui');
    expect(el.textContent).toContain('Case study');
    expect(el.textContent).toContain('March 24, 2026');
  });

  it('omits missing fields', () => {
    const el = buildByline({ author: 'Bryan Bui' });
    expect(el.textContent).toContain('Bryan Bui');
    expect(el.className).toBe('blog-byline');
  });
});
