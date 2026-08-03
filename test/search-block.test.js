import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

// createOptimizedPicture pulls in the full aem.js; stub it to a bare img.
vi.mock('../scripts/aem.js', () => ({
  createOptimizedPicture: (src, alt) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    return img;
  },
}));

// Feed the block a deterministic in-memory index instead of a network fetch.
const entries = Array.from({ length: 15 }, (_, i) => ({
  path: `/blog/strategy/article-${i}`,
  title: `Test article ${i}`,
  description: 'about testing',
  category: 'strategy',
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  image: `/img/${i}.jpg`,
}));
vi.mock('../scripts/content-index.js', () => ({
  loadIndex: vi.fn(async () => entries),
  formatDate: (v) => v,
}));

const loadBlock = async () => (await import('../blocks/blog-search/blog-search.js')).default;

describe('search block — Load More batching', () => {
  beforeEach(() => { window.history.pushState({}, '', '/blog/search?search-term=test'); });

  it('shows 6 results per batch and reveals Load More when there are more', async () => {
    const decorate = await loadBlock();
    const block = document.createElement('div');
    block.className = 'search';
    await decorate(block);

    expect(block.querySelector('.search-count').textContent).toBe('15 results');
    expect(block.querySelectorAll('.search-result').length).toBe(6);
    expect(block.querySelector('.search-load-more').hidden).toBe(false);
  });

  it('appends the next 6 on each Load More and hides the button at the end', async () => {
    const decorate = await loadBlock();
    const block = document.createElement('div');
    block.className = 'search';
    await decorate(block);
    const btn = block.querySelector('.search-load-more button');

    btn.click();
    expect(block.querySelectorAll('.search-result').length).toBe(12);
    expect(block.querySelector('.search-load-more').hidden).toBe(false);

    btn.click();
    expect(block.querySelectorAll('.search-result').length).toBe(15);
    expect(block.querySelector('.search-load-more').hidden).toBe(true);
  });

  it('renders the empty state (no results list) when there is no query', async () => {
    window.history.pushState({}, '', '/blog/search');
    const decorate = await loadBlock();
    const block = document.createElement('div');
    block.className = 'search';
    await decorate(block);

    expect(block.classList.contains('has-query')).toBe(false);
    expect(block.querySelectorAll('.search-result').length).toBe(0);
    expect(block.querySelector('.search-count').textContent).toBe('');
    expect(block.querySelector('.search-load-more').hidden).toBe(true);
  });

  it('re-searches in place on submit and clears back to the empty state', async () => {
    window.history.pushState({}, '', '/blog/search');
    const decorate = await loadBlock();
    const block = document.createElement('div');
    block.className = 'search';
    await decorate(block);

    const input = block.querySelector('.search-input');
    input.value = 'test';
    block.querySelector('.search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(window.location.search).toBe('?search-term=test');
    expect(block.classList.contains('has-query')).toBe(true);

    block.querySelector('.search-clear').click();
    await Promise.resolve();
    expect(window.location.search).toBe('');
    expect(block.classList.contains('has-query')).toBe(false);
  });

  it('auto-searches after the user pauses typing (debounced)', async () => {
    vi.useFakeTimers();
    try {
      window.history.pushState({}, '', '/blog/search');
      const decorate = await loadBlock();
      const block = document.createElement('div');
      block.className = 'search';
      await decorate(block);

      const input = block.querySelector('.search-input');
      input.value = 'test';
      input.dispatchEvent(new Event('input'));
      // nothing happens until the debounce window elapses
      expect(window.location.search).toBe('');

      await vi.advanceTimersByTimeAsync(400);
      expect(window.location.search).toBe('?search-term=test');
      expect(block.querySelectorAll('.search-result').length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
