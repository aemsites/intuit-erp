import { describe, it, expect } from 'vitest';
import {
  buildToc, buildByline, buildEyebrow, buildBylineMeta,
} from '../blocks/blog-template/blog-template.js';

describe('buildToc', () => {
  it('creates TOC links for each H2 only, ignoring nested h3s', () => {
    const main = document.createElement('main');
    main.innerHTML = '<h2>Expanding across the US</h2><p>x</p><h3>Detail</h3><h2>Results</h2>';
    const nav = buildToc(main);
    const links = nav.querySelectorAll('.blog-toc-list a');
    expect(links.length).toBe(2);
    expect(main.querySelector('h2').id).toBeTruthy();
    expect(links[0].getAttribute('href')).toBe(`#${main.querySelector('h2').id}`);
  });

  it('returns null when there are fewer than 2 headings', () => {
    const main = document.createElement('main');
    main.innerHTML = '<h2>Only one</h2>';
    expect(buildToc(main)).toBeNull();
  });

  it('excludes h2s inside callout blocks and the "Recommended for you" blog-cards section', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <div><div class="highlight"><h2>Results at a glance</h2></div></div>
      <div><h2>Managing a multi-entity portfolio</h2></div>
      <div><h2>Driving efficiency</h2></div>
      <div><h2>Recommended for you</h2><div class="blog-cards"></div></div>
    `;
    const nav = buildToc(main);
    const links = [...nav.querySelectorAll('.blog-toc-list a')];
    expect(links.length).toBe(2);
    expect(links.map((a) => a.textContent)).toEqual([
      'Managing a multi-entity portfolio',
      'Driving efficiency',
    ]);
  });

  it('builds a toggle button and a numbered list wrapped in a nav', () => {
    const main = document.createElement('main');
    main.innerHTML = '<h2>First</h2><h2>Second</h2>';
    const nav = buildToc(main);
    expect(nav.tagName).toBe('NAV');
    expect(nav.getAttribute('aria-label')).toBe('Table of contents');
    const toggle = nav.querySelector('.blog-toc-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Table of contents');
    expect(nav.querySelector('.blog-toc-list').tagName).toBe('OL');
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

describe('buildEyebrow', () => {
  it('returns null when no tag is given', () => {
    expect(buildEyebrow()).toBeNull();
  });

  it('renders the tag with hyphens replaced by spaces', () => {
    const el = buildEyebrow('case-study');
    expect(el.className).toBe('blog-byline-tag');
    expect(el.textContent).toBe('case study');
  });
});

describe('buildBylineMeta', () => {
  it('links the author name to their author page', () => {
    const el = buildBylineMeta({ author: 'Bryan Bui', date: 'March 9, 2026' });
    const link = el.querySelector('.blog-byline-author a');
    expect(link.getAttribute('href')).toBe('/blog/author/bryan-bui');
    expect(link.textContent).toBe('Bryan Bui');
    expect(el.querySelector('.blog-byline-date').textContent).toBe('Published on March 9, 2026');
  });

  it('returns an empty (childless) paragraph when no fields are given', () => {
    const el = buildBylineMeta();
    expect(el.tagName).toBe('P');
    expect(el.childElementCount).toBe(0);
  });
});
