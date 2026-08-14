import { describe, it, expect, vi } from 'vitest';
import {
  buildToc, buildByline, buildEyebrow, buildBylineMeta,
  buildShare, relocateShare, tocRailRowEnd, isBlogPage,
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

  it('links the tag to its category listing', () => {
    const el = buildEyebrow('case-study');
    const link = el.querySelector('a');
    expect(link.getAttribute('href')).toBe('/blog/case-study/');
    expect(link.textContent).toBe('case study');
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

describe('buildShare', () => {
  it('builds a label plus 4 social links in Facebook, X, LinkedIn, YouTube order', () => {
    const el = buildShare();
    expect(el.tagName).toBe('P');
    expect(el.className).toBe('blog-share');
    expect(el.querySelector('.blog-share-label').textContent).toBe('Share this article:');
    const links = [...el.querySelectorAll('.blog-share-link')];
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Facebook', 'X', 'LinkedIn', 'YouTube',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.facebook.com/intuit',
      'https://twitter.com/intuit',
      'https://www.linkedin.com/company/intuit',
      'https://www.youtube.com/user/intuit',
    ]);
    links.forEach((a) => {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
      expect(a.querySelector('svg')).toBeTruthy();
    });
  });
});

describe('relocateShare', () => {
  const fakeMQ = (matches) => {
    const listeners = [];
    return {
      matches,
      addEventListener: (type, cb) => listeners.push(cb),
      fire: (nowMatches) => listeners.forEach((cb) => cb({ matches: nowMatches })),
    };
  };

  it('places at the mobile position when the query does not match', () => {
    const share = document.createElement('p');
    const placeMobile = vi.fn();
    const placeDesktop = vi.fn();
    relocateShare(share, placeMobile, placeDesktop, fakeMQ(false));
    expect(placeMobile).toHaveBeenCalledOnce();
    expect(placeDesktop).not.toHaveBeenCalled();
  });

  it('places at the desktop position when the query matches', () => {
    const share = document.createElement('p');
    const placeMobile = vi.fn();
    const placeDesktop = vi.fn();
    relocateShare(share, placeMobile, placeDesktop, fakeMQ(true));
    expect(placeDesktop).toHaveBeenCalledOnce();
    expect(placeMobile).not.toHaveBeenCalled();
  });

  it('falls back to the mobile position when there is no desktop placement (no TOC)', () => {
    const share = document.createElement('p');
    const placeMobile = vi.fn();
    relocateShare(share, placeMobile, null, fakeMQ(true));
    expect(placeMobile).toHaveBeenCalledOnce();
  });

  it('re-places on breakpoint change', () => {
    const share = document.createElement('p');
    const placeMobile = vi.fn();
    const placeDesktop = vi.fn();
    const mq = fakeMQ(false);
    relocateShare(share, placeMobile, placeDesktop, mq);
    mq.fire(true);
    expect(placeDesktop).toHaveBeenCalledOnce();
  });
});

describe('tocRailRowEnd', () => {
  it('returns null when there are no headings', () => {
    expect(tocRailRowEnd([document.createElement('div')], [])).toBeNull();
  });

  it('computes the row-end line from the index of the last heading\'s section', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <div>hero</div>
      <div><h2 id="a">A</h2></div>
      <div><h2 id="b">B</h2></div>
      <div><h3>Recommended for you</h3></div>
    `;
    const sections = [...main.children];
    const headings = [main.querySelector('#a'), main.querySelector('#b')];
    // hero = index 0 (row 1); "B"'s section = index 2 (row 3) -> end line 4,
    // leaving the trailing "Recommended for you" section (index 3) excluded.
    expect(tocRailRowEnd(sections, headings)).toBe(4);
  });
});

describe('isBlogPage', () => {
  const setPage = (path, template) => {
    window.history.pushState({}, '', path);
    document.head.innerHTML = template ? `<meta name="template" content="${template}">` : '';
  };

  it('is true for a Blog Article template page', () => {
    setPage('/blog/operations/shipping-options', 'Blog Article');
    expect(isBlogPage()).toBe(true);
  });

  it('is false for a Category listing page', () => {
    setPage('/blog/acquisition-and-mergers', 'Category');
    expect(isBlogPage()).toBe(false);
  });

  it('is false for an Author listing page', () => {
    setPage('/blog/author/gene-marks', 'Author');
    expect(isBlogPage()).toBe(false);
  });

  it('is false outside /blog/', () => {
    setPage('/accountant', 'Blog Article');
    expect(isBlogPage()).toBe(false);
  });

  it('falls back to path shape when template metadata is absent', () => {
    setPage('/blog/operations/shipping-options', null);
    expect(isBlogPage()).toBe(true); // /blog/<category>/<slug>
    setPage('/blog/acquisition-and-mergers', null);
    expect(isBlogPage()).toBe(false); // single-segment category
    setPage('/blog/author/gene-marks', null);
    expect(isBlogPage()).toBe(false); // author listing
  });
});
