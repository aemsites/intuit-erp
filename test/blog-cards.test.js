import { describe, it, expect } from 'vitest';
import { filterEntries, cardEl } from '../blocks/blog-cards/blog-cards.js';

const data = [
  {
    path: '/blog/financials/a', title: 'A', category: 'financials', date: '2026-02-01', author: 'abigail-sims', image: '/a.jpg', description: 'da',
  },
  {
    path: '/blog/erp/b', title: 'B', category: 'erp', date: '2026-03-01', author: 'bob-wang', image: '/b.jpg', description: 'db',
  },
  {
    path: '/blog/financials/c', title: 'C', category: 'financials', date: '2026-01-01', author: 'abigail-sims', image: '/c.jpg', description: 'dc',
  },
];

describe('filterEntries', () => {
  it('filters by category and sorts by date desc', () => {
    const out = filterEntries(data, { category: 'financials' });
    expect(out.map((e) => e.title)).toEqual(['A', 'C']);
  });
  it('filters by author and respects limit', () => {
    const out = filterEntries(data, { author: 'abigail-sims', limit: 1 });
    expect(out.length).toBe(1);
    expect(out[0].title).toBe('A');
  });
  it('excludes the current path (for recommended grids)', () => {
    const out = filterEntries(data, { category: 'financials', excludePath: '/blog/financials/a' });
    expect(out.map((e) => e.title)).toEqual(['C']);
  });
});

describe('cardEl', () => {
  it('builds an anchor card with title, image and link', () => {
    const el = cardEl(data[0]);
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/blog/financials/a');
    expect(el.querySelector('img').getAttribute('src')).toBe('/a.jpg');
    expect(el.textContent).toContain('A');
  });
});
