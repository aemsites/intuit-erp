import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  buildToc, buildByline, buildEyebrow, buildBylineMeta,
  buildShare, relocateShare, tocRailRowEnd, isBlogPage,
  buildBlogTemplate, decorateBodyLinks,
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
  beforeEach(() => {
    window.hlx = { codeBasePath: '' };
  });

  afterEach(() => {
    delete window.hlx;
  });

  it('builds a label plus 4 social links in Facebook, X, LinkedIn, YouTube order', () => {
    const el = buildShare();
    expect(el.tagName).toBe('P');
    expect(el.className).toBe('blog-share');
    expect(el.querySelector('.blog-share-label').textContent).toBe('Share this article:');
    const links = [...el.querySelectorAll('.blog-share-link')];
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Facebook', 'X', 'LinkedIn', 'YouTube',
    ]);
    links.forEach((a) => {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
    });
  });

  it('renders each icon from /icons as an <img>, not an embedded <svg>', () => {
    const el = buildShare();
    const links = [...el.querySelectorAll('.blog-share-link')];
    expect(links.map((a) => a.querySelector('img')?.getAttribute('src'))).toEqual([
      '/icons/facebook.svg', '/icons/x.svg', '/icons/linkedin.svg', '/icons/youtube.svg',
    ]);
    links.forEach((a) => expect(a.querySelector('svg')).toBeNull());
  });

  it('builds Facebook/X/LinkedIn as share-intent links carrying the current article URL', () => {
    const el = buildShare();
    const links = [...el.querySelectorAll('.blog-share-link')];
    const encodedUrl = encodeURIComponent(window.location.href);
    const [facebook, x, linkedin, youtube] = links.map((a) => a.getAttribute('href'));
    expect(facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`);
    expect(x).toBe(`https://twitter.com/share?url=${encodedUrl}`);
    expect(linkedin).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`);
    // YouTube stays a static "visit our channel" link, matching production —
    // its share row's 4th icon is a follow link, not a share intent.
    expect(youtube).toBe('https://www.youtube.com/user/intuit');
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

describe('decorateBodyLinks', () => {
  it('opens body prose links in a new tab but leaves anchors and chrome alone', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <div class="blog-hero"><p class="blog-byline"><a href="/blog/author/x">Author</a></p></div>
      <div class="blog-toc-rail"><nav class="blog-toc"><a href="#sec">Section</a></nav></div>
      <div><p><a href="https://quickbooks.intuit.com/r/foo/">External</a>
        <a href="/blog/strategy/other/">Cross-blog</a>
        <a href="#anchor">In-page</a></p></div>
      <div class="blog-rail"><p><a href="/fragments/right-rail">/fragments/right-rail</a></p></div>
    `;

    decorateBodyLinks(main);

    const byHref = (h) => main.querySelector(`a[href="${h}"]`);
    // body prose links -> new tab
    ['https://quickbooks.intuit.com/r/foo/', '/blog/strategy/other/'].forEach((h) => {
      expect(byHref(h).target).toBe('_blank');
      expect(byHref(h).rel).toBe('noopener noreferrer');
    });
    // in-page anchor and injected chrome -> untouched (same tab)
    ['#anchor', '#sec', '/blog/author/x', '/fragments/right-rail'].forEach((h) => {
      expect(byHref(h).getAttribute('target')).toBeNull();
    });
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

  it('is true for the other article templates — Case Study and Research', () => {
    setPage('/blog/case-study/fire-and-ice-intuit-enterprise-suite-review', 'Case Study');
    expect(isBlogPage()).toBe(true);
    setPage('/blog/research/business-solutions-survey-2024', 'Research');
    expect(isBlogPage()).toBe(true);
  });

  it('is false for a Guide — upstream gives it its own landing-page hero, not the article layout', () => {
    setPage('/blog/guide/construction-accounting-erp', 'Guide');
    expect(isBlogPage()).toBe(false);
  });

  it('is false for a Category listing page', () => {
    setPage('/blog/acquisition-and-mergers', 'Category');
    expect(isBlogPage()).toBe(false);
  });

  it('is false for an Author listing page', () => {
    setPage('/blog/author/gene-marks', 'Author');
    expect(isBlogPage()).toBe(false);
  });

  it('is false for a Search or unknown template even on an article-shaped path', () => {
    // deliberately article-shaped paths (>=2 segments, not /author/*) so the
    // template value is what decides — a single-segment path like /blog/search
    // would return false via the path fallback whatever the template said, and
    // would keep passing if `search` were ever added to the article list.
    setPage('/blog/search/results', 'Search');
    expect(isBlogPage()).toBe(false);
    setPage('/blog/case-study/some-slug', 'Landing Page');
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

describe('buildBlogTemplate', () => {
  const mainWith = (html) => {
    const main = document.createElement('main');
    main.innerHTML = html;
    document.body.append(main);
    return main;
  };

  afterEach(() => {
    document.querySelectorAll('main').forEach((m) => m.remove());
    document.head.innerHTML = '';
    delete window.hlx;
    delete window.matchMedia;
  });

  it('leaves a page that authors a case-study-header completely undecorated', () => {
    // The three net-new case studies render their own centred banner. Decorating
    // them as well would double up, so nothing here may run — in particular the
    // `blog-article` class, which is what tells the article CSS to take over.
    const main = mainWith('<div><div class="case-study-header"><div><div>Case study</div></div></div></div>');
    const before = main.innerHTML;

    buildBlogTemplate(main);

    expect(main.classList.contains('blog-article')).toBe(false);
    expect(main.querySelector('.blog-hero')).toBeNull();
    expect(main.querySelector('.blog-toc-rail')).toBeNull();
    expect(main.querySelector('.blog-rail')).toBeNull();
    expect(main.innerHTML).toBe(before);
  });

  it('decorates an ordinary article — the guard above is what makes the difference', () => {
    window.hlx = { codeBasePath: '' };
    window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    const main = mainWith(`
      <div><h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p></div>
      <div><h2>One</h2><p>a</p></div>
      <div><h2>Two</h2><p>b</p></div>
    `);

    buildBlogTemplate(main);

    expect(main.classList.contains('blog-article')).toBe(true);
    expect(main.querySelector('.blog-hero')).toBeTruthy();
    expect(main.querySelector('.blog-toc-rail')).toBeTruthy();
    // right-rail fragment link, which the fragment autoblock then picks up
    expect(main.querySelector('.blog-rail a').getAttribute('href')).toBe('/fragments/right-rail');
  });

  it('still decorates when a case-study-header is authored below section 1', () => {
    // The early return is scoped to section 1 so a header further down a page
    // can't silently strip that page's hero band and rails. The 46em clamp in
    // styles.css is scoped the same way (`main:has(> div:first-child
    // .case-study-header)`) — if either side loses that scope the two disagree,
    // and a full-width hero band gets clamped to a narrow column.
    window.hlx = { codeBasePath: '' };
    window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    const main = mainWith(`
      <div><h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p></div>
      <div><div class="case-study-header"><div><div>Case study</div></div></div></div>
      <div><h2>One</h2><p>a</p></div>
      <div><h2>Two</h2><p>b</p></div>
    `);

    buildBlogTemplate(main);

    expect(main.classList.contains('blog-article')).toBe(true);
    expect(main.querySelector('.blog-hero')).toBeTruthy();
  });

  it('leaves both rails without an inline grid-row when there is no TOC', () => {
    // <2 TOC-eligible headings means tocRailRowEnd can't anchor, so no inline
    // `grid-row` is set and the rails fall back to the stylesheet's
    // `grid-row: 2 / span 999`. The full-width cards appendix has no explicit
    // row either, so it auto-places after that span — which only lands
    // correctly because the ~999 spanned rows are empty and `.blog-article`
    // has no `row-gap`. Three live pages render this shape (see the comment on
    // `.blog-article > .blog-cards-container` in blog-template.css), so pin the
    // contract here: no TOC rail, and no inline row on the right rail.
    window.hlx = { codeBasePath: '' };
    window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    const main = mainWith(`
      <div><h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p></div>
      <div><p>intro prose, no headings</p></div>
      <div><h2>Recommended for you</h2><div class="blog-cards"></div></div>
    `);

    buildBlogTemplate(main);

    expect(main.classList.contains('blog-article')).toBe(true);
    expect(main.querySelector('.blog-toc-rail')).toBeNull();
    expect(main.querySelector('.blog-rail').style.gridRow).toBe('');
  });

  it('bounds both rails to the last TOC section when there is a TOC', () => {
    window.hlx = { codeBasePath: '' };
    window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    const main = mainWith(`
      <div><h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p></div>
      <div><h2>One</h2><p>a</p></div>
      <div><h2>Two</h2><p>b</p></div>
      <div><h2>Recommended for you</h2><div class="blog-cards"></div></div>
    `);

    buildBlogTemplate(main);

    // hero = row 1, so the last TOC section (index 2) ends at line 4 — the
    // appendix then auto-places at row 4, after the rails rather than inside them
    expect(main.querySelector('.blog-toc-rail').style.gridRow).toBe('2 / 4');
    expect(main.querySelector('.blog-rail').style.gridRow).toBe('2 / 4');
  });
});
