import { describe, it, expect } from 'vitest';
import { filterEntries, cardEl, categoryLabel } from '../blocks/blog-cards/blog-cards.js';

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

describe('categoryLabel', () => {
  it('prefers the entry\'s own category', () => {
    expect(categoryLabel(data[0])).toBe('financials');
  });
  it('falls back to the path segment for indices with no category column', () => {
    // /blog/case-study/query-index.json rows carry no `category`
    expect(categoryLabel({ path: '/blog/case-study/sparq-partners' })).toBe('case study');
  });
  it('renders hyphenated slugs as words (CSS uppercases them)', () => {
    expect(categoryLabel({ category: 'product-update' })).toBe('product update');
  });
  it('returns empty for listing pages, which have no category segment', () => {
    expect(categoryLabel({ path: '/blog/erp' })).toBe('');
    expect(categoryLabel({})).toBe('');
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
  it('renders category, title and date in the source card\'s order', () => {
    const el = cardEl(data[0]);
    const body = [...el.querySelector('.blog-card-body').children].map((c) => c.className);
    expect(body).toEqual(['blog-card-category', 'blog-card-title', 'blog-card-date']);
  });
  it('omits the category for an entry with no category to show', () => {
    const el = cardEl({ path: '/blog/erp', title: 'Listing' });
    expect(el.querySelector('.blog-card-category')).toBeNull();
  });
});
