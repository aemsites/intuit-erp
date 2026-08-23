import { describe, it, expect } from 'vitest';
import {
  filterEntries, cardEl, categoryLabel, distinctValues,
} from '../blocks/blog-cards/blog-cards.js';

const data = [
  {
    path: '/blog/financials/a', title: 'A', category: 'financials', date: '2026-02-01', author: 'abigail-sims', image: '/a.jpg', description: 'da', tags: 'automation, ai',
  },
  {
    path: '/blog/erp/b', title: 'B', category: 'erp', date: '2026-03-01', author: 'bob-wang', image: '/b.jpg', description: 'db', tags: 'automation',
  },
  {
    path: '/blog/financials/c', title: 'C', category: 'financials', date: '2026-01-01', author: 'abigail-sims', image: '/c.jpg', description: 'dc', tags: 'multi-entity',
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
  it('excludes listing pages by their template metadata, not their path', () => {
    const mixed = [
      { path: '/blog', title: 'Blog | Intuit Enterprise Suite', template: 'Blog Home', date: '2026-04-01' },
      { path: '/blog/erp', title: 'ERP | Enterprise | Intuit', template: 'Category', date: '2026-04-01' },
      { path: '/blog/search', title: 'Search', template: 'Search', date: '2026-04-01' },
      ...data,
    ];
    const out = filterEntries(mixed);
    expect(out.map((e) => e.path)).toEqual([
      '/blog/erp/b', '/blog/financials/a', '/blog/financials/c',
    ]);
  });
  it('matches listing templates case-insensitively', () => {
    const out = filterEntries([
      { path: '/blog', title: 'Home', template: 'BLOG HOME' },
      { path: '/blog/erp/b', title: 'B', template: 'Blog Article', date: '2026-03-01' },
    ]);
    expect(out.map((e) => e.title)).toEqual(['B']);
  });
  it('keeps content pages regardless of path depth (case studies live at /blog/case-study/*)', () => {
    // Case-study rows are real articles; only the /blog/case-study index is a listing.
    const out = filterEntries([
      { path: '/blog/case-study', title: 'Customer success stories', template: 'Category', date: '2026-04-01' },
      { path: '/blog/case-study/sparq-partners', title: 'Sparq', template: 'Case Study', date: '2026-03-01' },
    ]);
    expect(out.map((e) => e.path)).toEqual(['/blog/case-study/sparq-partners']);
  });
  it('accepts multiple categories (comma-separated) and merges newest-first', () => {
    const out = filterEntries(data, { category: 'erp, financials' });
    expect(out.map((e) => e.title)).toEqual(['B', 'A', 'C']);
  });
  it('accepts multiple categories as an array', () => {
    const out = filterEntries(data, { category: ['financials', 'erp'], limit: 2 });
    expect(out.map((e) => e.title)).toEqual(['B', 'A']);
  });
  it('filters by tags, matching any of the entry\'s own comma-separated tags', () => {
    const out = filterEntries(data, { tags: 'automation' });
    expect(out.map((e) => e.title)).toEqual(['B', 'A']);
  });
  it('accepts multiple requested tags (OR)', () => {
    const out = filterEntries(data, { tags: 'ai, multi-entity' });
    expect(out.map((e) => e.title)).toEqual(['A', 'C']);
  });
  it('matches tags case-insensitively (real feed data uses ["Automation"], not ["automation"])', () => {
    const mixed = [
      { path: '/blog/operations/x', title: 'X', date: '2026-01-01', tags: ['Automation'] },
    ];
    expect(filterEntries(mixed, { tags: 'automation' }).map((e) => e.title)).toEqual(['X']);
  });
  it('treats a post\'s own folder as an implicit tag (home posts need no explicit tag)', () => {
    // A page filtering `tags: financials` lists /blog/financials/* without those posts
    // carrying a redundant "financials" tag, plus any cross-folder post tagged financials.
    const mixed = [
      { path: '/blog/financials/home', title: 'Home', date: '2026-03-01' },
      { path: '/blog/hr/cross', title: 'Cross', date: '2026-02-01', tags: 'financials' },
      { path: '/blog/erp/other', title: 'Other', date: '2026-01-01', tags: 'automation' },
    ];
    expect(filterEntries(mixed, { tags: 'financials' }).map((e) => e.title)).toEqual(['Home', 'Cross']);
  });
  it('folder-as-tag matches across hyphen vs. space (slug folders)', () => {
    const mixed = [
      { path: '/blog/project-cost-estimation/x', title: 'X', date: '2026-01-01' },
    ];
    expect(filterEntries(mixed, { tags: 'project-cost-estimation' }).map((e) => e.title)).toEqual(['X']);
  });
  it('matches tags across hyphen vs. space — tags are phrases, not slugs', () => {
    const mixed = [
      { path: '/blog/financials/y', title: 'Y', date: '2026-01-01', tags: ['Funding and ownership'] },
    ];
    expect(filterEntries(mixed, { tags: 'funding-and-ownership' }).map((e) => e.title)).toEqual(['Y']);
  });
  it('filters by template (case-insensitively) — one blog index for every collection', () => {
    const mixed = [
      { path: '/blog/erp/b', title: 'Article', template: 'Blog Article', date: '2026-03-01' },
      { path: '/blog/case-study/x', title: 'Case', template: 'Case Study', date: '2026-02-01' },
      { path: '/blog/research/y', title: 'Research', template: 'Research', date: '2026-01-01' },
    ];
    expect(filterEntries(mixed, { template: 'case study' }).map((e) => e.title)).toEqual(['Case']);
    expect(filterEntries(mixed, { template: 'Case Study, Research' }).map((e) => e.title))
      .toEqual(['Case', 'Research']);
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
    const img = el.querySelector('img');
    expect(img.getAttribute('src')).toContain('/a.jpg');
    expect(img.getAttribute('src')).toContain('width=400');
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
  it('is not featured by default (no featured class, smaller image request)', () => {
    const el = cardEl(data[0]);
    expect(el.className).not.toContain('featured');
    expect(el.querySelector('img').getAttribute('src')).toContain('width=400');
  });
  it('renders a featured card with the featured class and a larger image request', () => {
    const el = cardEl(data[0], true);
    expect(el.classList.contains('featured')).toBe(true);
    expect(el.querySelector('img').getAttribute('src')).toContain('width=750');
  });
});

describe('distinctValues', () => {
  it('returns sorted, deduped, non-empty values for a field', () => {
    expect(distinctValues(data, 'category')).toEqual(['erp', 'financials']);
  });
  it('returns an empty array when no entry has the field', () => {
    expect(distinctValues(data, 'industry')).toEqual([]);
  });
});
