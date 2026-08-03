import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  buildSearchUrl, getSearchQuery, isArticle, searchEntries,
  enhanceSecondaryNavSearch, wireFooterSearch,
  SEARCH_PAGE,
} from '../blocks/blog-search/search-utils.js';

const data = [
  {
    path: '/blog', title: 'Home', description: '', date: '',
  },
  {
    path: '/blog/accounting', title: 'Accounting', description: 'category landing', date: '',
  },
  {
    path: '/blog/strategy/multi-entity-growth-data-problem', title: 'Multi-entity growth has a data problem', description: 'Fixing reporting', category: 'strategy', tags: 'growth', date: '2026-07-28',
  },
  {
    path: '/blog/strategy/horizontal-integration', title: 'What is horizontal integration', description: 'A best practices guide for multi-entity growth', category: 'strategy', tags: '', date: '2025-10-26',
  },
  {
    path: '/blog/financials/enterprise-value', title: 'Enterprise value explained', description: 'Company valuations', category: 'financials', tags: 'multi-entity', date: '2024-11-18',
  },
];

describe('isArticle', () => {
  it('is true only for depth ≥ 3 /blog paths (articles, not category pages)', () => {
    expect(isArticle({ path: '/blog' })).toBe(false);
    expect(isArticle({ path: '/blog/accounting' })).toBe(false);
    expect(isArticle({ path: '/blog/strategy/some-article' })).toBe(true);
    expect(isArticle({ path: '' })).toBe(false);
    expect(isArticle({})).toBe(false);
  });
});

describe('searchEntries', () => {
  it('returns [] for an empty/whitespace query', () => {
    expect(searchEntries(data, '')).toEqual([]);
    expect(searchEntries(data, '   ')).toEqual([]);
  });

  it('excludes the home and category landing pages', () => {
    const out = searchEntries(data, 'accounting');
    expect(out.every((e) => isArticle(e))).toBe(true);
    expect(out.find((e) => e.path === '/blog/accounting')).toBeUndefined();
  });

  it('AND-matches every token across title/description/category/tags', () => {
    const out = searchEntries(data, 'multi-entity growth');
    const paths = out.map((e) => e.path);
    // title match + description match both qualify
    expect(paths).toContain('/blog/strategy/multi-entity-growth-data-problem');
    expect(paths).toContain('/blog/strategy/horizontal-integration');
    // "Enterprise value" has "multi-entity" (tags) but not "growth" → excluded
    expect(paths).not.toContain('/blog/financials/enterprise-value');
  });

  it('ranks title matches above description-only matches', () => {
    const out = searchEntries(data, 'multi-entity growth');
    expect(out[0].path).toBe('/blog/strategy/multi-entity-growth-data-problem');
  });

  it('sorts by date descending within a rank group', () => {
    const out = searchEntries(data, 'multi-entity');
    const dates = out.map((e) => e.date);
    const sorted = [...dates].sort((a, b) => new Date(b) - new Date(a));
    expect(dates).toEqual(sorted);
  });
});

describe('buildSearchUrl / getSearchQuery', () => {
  it('builds a search-term URL and round-trips', () => {
    const url = buildSearchUrl('multi-entity growth');
    expect(url).toBe('/blog/search?search-term=multi-entity%20growth');
    const qs = url.slice(url.indexOf('?'));
    expect(getSearchQuery(qs)).toBe('multi-entity growth');
  });

  it('returns the bare page for an empty/whitespace query', () => {
    expect(buildSearchUrl('')).toBe(SEARCH_PAGE);
    expect(buildSearchUrl('   ')).toBe(SEARCH_PAGE);
  });

  it('encodes special characters and trims', () => {
    expect(buildSearchUrl('  a&b=c  ')).toBe('/blog/search?search-term=a%26b%3Dc');
    expect(getSearchQuery('?search-term=a%26b%3Dc')).toBe('a&b=c');
    expect(getSearchQuery('')).toBe('');
  });
});

describe('enhanceSecondaryNavSearch', () => {
  beforeEach(() => { window.history.pushState({}, '', '/blog/search'); });

  const buildNav = () => {
    const header = document.createElement('div');
    header.innerHTML = '<nav class="ies-secondary-nav"><div class="container"><a class="secondary-nav-brand">Resource center</a></div></nav>';
    return header;
  };

  it('injects the search widget into the secondary nav', () => {
    const header = buildNav();
    enhanceSecondaryNavSearch(header);
    expect(header.querySelector('.rc-search')).not.toBeNull();
    expect(header.querySelector('.rc-search-input')).not.toBeNull();
  });

  it('prefills the input from the current search-term param', () => {
    window.history.pushState({}, '', '/blog/search?search-term=hello%20world');
    const header = buildNav();
    enhanceSecondaryNavSearch(header);
    expect(header.querySelector('.rc-search-input').value).toBe('hello world');
  });

  it('is idempotent and a no-op without the secondary nav', () => {
    const header = buildNav();
    enhanceSecondaryNavSearch(header);
    enhanceSecondaryNavSearch(header);
    expect(header.querySelectorAll('.rc-search').length).toBe(1);

    const bare = document.createElement('div');
    enhanceSecondaryNavSearch(bare);
    expect(bare.querySelector('.rc-search')).toBeNull();
  });

  it('toggles open on the search icon', () => {
    const header = buildNav();
    enhanceSecondaryNavSearch(header);
    const widget = header.querySelector('.rc-search');
    header.querySelector('.rc-search-toggle').click();
    expect(widget.classList.contains('rc-search-open')).toBe(true);
  });
});

describe('wireFooterSearch', () => {
  it('marks the footer search input as wired, once', () => {
    const footer = document.createElement('div');
    footer.innerHTML = '<div class="footer-search"><input type="search"></div>';
    const input = footer.querySelector('input');
    wireFooterSearch(footer);
    expect(input.dataset.searchWired).toBe('true');
    wireFooterSearch(footer); // idempotent — should not throw
    expect(input.dataset.searchWired).toBe('true');
  });

  it('no-ops when there is no footer search input', () => {
    const footer = document.createElement('div');
    expect(() => wireFooterSearch(footer)).not.toThrow();
  });
});
