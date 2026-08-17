import { describe, it, expect } from 'vitest';
import decorate from '../blocks/guide-hero/guide-hero.js';
import buildGuideHeroAutoBlock from '../blocks/guide-hero/guide-hero-autoblock.js';
import { isGuidePage } from '../blocks/guide-hero/guide-detect.js';

// Mirrors what buildGuideHeroAutoBlock (scripts.js) hands over: one row, one
// cell, holding section 1's authored flow verbatim.
const blockWith = (inner) => {
  const block = document.createElement('div');
  block.className = 'guide-hero';
  block.innerHTML = `<div><div>${inner}</div></div>`;
  return block;
};

describe('guide-hero decorate', () => {
  it('splits the authored flow into a media half and a copy half, media first', () => {
    const block = blockWith(`
      <h1>Construction accounting: Using an ERP</h1>
      <p>See how large construction firms can modernize operations.</p>
      <p><picture><img src="hero.jpg" alt="A person in a suit"></picture></p>
    `);

    decorate(block);

    expect([...block.children].map((c) => c.className))
      .toEqual(['guide-hero-media', 'guide-hero-copy']);
    expect(block.querySelector('.guide-hero-media picture img')).toBeTruthy();
    expect(block.querySelector('.guide-hero-copy h1').textContent)
      .toBe('Construction accounting: Using an ERP');
    expect(block.querySelector('.guide-hero-copy p').textContent)
      .toContain('modernize operations');
    // the image must not be left behind in the copy column
    expect(block.querySelector('.guide-hero-copy picture, .guide-hero-copy img')).toBeNull();
  });

  it('removes the emptied paragraph that wrapped the image', () => {
    const block = blockWith('<h1>Headline</h1><p><picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    // only the headline remains in the copy column — no leftover empty <p>,
    // which would still carry the global paragraph margin
    expect(block.querySelectorAll('.guide-hero-copy p').length).toBe(0);
    expect(block.querySelector('.guide-hero-copy h1')).toBeTruthy();
  });

  it('keeps a lede paragraph that shares its cell with the image', () => {
    const block = blockWith('<h1>Headline</h1><p>Lede copy.<picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    expect(block.querySelector('.guide-hero-media img')).toBeTruthy();
    expect(block.querySelector('.guide-hero-copy p').textContent).toBe('Lede copy.');
  });

  it('puts the photo ahead of the copy, so it is the section\'s first img', () => {
    // aem.js's waitForFirstImage() un-defers section 1's first <img> as the LCP
    // candidate, so the ordering is what gets the hero photo that treatment —
    // this block deliberately does not set loading itself.
    const block = blockWith('<h1>Headline</h1><p>Lede.</p><p><picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    expect(block.querySelector('img').closest('div').className).toBe('guide-hero-media');
    expect(block.querySelector('img').getAttribute('loading')).toBeNull();
  });

  it('marks the hero photo fetchpriority="high" — loading="eager" alone does not prioritize', () => {
    const block = blockWith('<h1>Headline</h1><p><picture><source srcset="hero.webp"><img src="hero.jpg"></picture></p>');
    decorate(block);
    // the hint has to land on the <img>, not the <picture> that was moved
    expect(block.querySelector('.guide-hero-media picture').hasAttribute('fetchpriority')).toBe(false);
    expect(block.querySelector('.guide-hero-media img').getAttribute('fetchpriority')).toBe('high');
  });

  it('marks the hero photo when it is a bare img, and when it is wrapped in a link', () => {
    const bare = blockWith('<h1>H</h1><p><img src="hero.jpg"></p>');
    decorate(bare);
    expect(bare.querySelector('.guide-hero-media img').getAttribute('fetchpriority')).toBe('high');

    const linked = blockWith('<h1>H</h1><p><a href="/gated"><picture><img src="hero.jpg"></picture></a></p>');
    decorate(linked);
    expect(linked.querySelector('.guide-hero-media a img').getAttribute('fetchpriority')).toBe('high');
  });

  it('does not prioritize anything on the no-media variant', () => {
    // an icon is not the LCP element; hinting it would waste the boost
    const block = blockWith('<h1>H</h1><p>Lede <span class="icon icon-check"><img data-icon-name="check" src="/icons/check.svg"></span>.</p>');
    decorate(block);
    expect(block.querySelector('img').hasAttribute('fetchpriority')).toBe(false);
  });

  it('carries an authored CTA into the copy column', () => {
    // decorateButtons turns <em><a> into a.button.secondary later; the block only
    // has to keep the paragraph on the copy side
    const block = blockWith('<h1>Headline</h1><p><em><a href="#download">Get the free white paper</a></em></p><p><picture><img src="hero.jpg"></picture></p>');
    decorate(block);
    const cta = block.querySelector('.guide-hero-copy a[href="#download"]');
    expect(cta).toBeTruthy();
    expect(cta.textContent).toBe('Get the free white paper');
  });

  it('inserts no media half at all when there is no image', () => {
    // the autoblock will not create the block in this case, but a hand-authored
    // one must not render an empty square taking half the card
    const block = blockWith('<h1>Headline only</h1>');
    decorate(block);
    expect(block.querySelector('.guide-hero-copy h1')).toBeTruthy();
    expect(block.querySelector('.guide-hero-media')).toBeNull();
    expect([...block.children].map((c) => c.className)).toEqual(['guide-hero-copy']);
    // the variant class the CSS keys on for the plain centred headline
    expect(block.classList.contains('no-media')).toBe(true);
  });

  it('does not mistake a decorateIcons icon for the hero photo', () => {
    // decorateIcons runs before buildAutoBlocks, so an authored `:icon-check:` is
    // already an <img> by the time this decorates — it must neither be hoisted
    // into the media half nor suppress the no-media variant
    const block = blockWith('<h1>H</h1><p>Lede <span class="icon icon-check"><img data-icon-name="check" src="/icons/check.svg"></span> more.</p>');
    decorate(block);
    expect(block.classList.contains('no-media')).toBe(true);
    expect(block.querySelector('.guide-hero-media')).toBeNull();
    // and the icon stays in the sentence where it was authored
    expect(block.querySelector('.guide-hero-copy p .icon img')).toBeTruthy();
    expect(block.querySelector('.guide-hero-copy p').textContent).toContain('more.');
  });

  it('keeps the link when the hero photo is wrapped in one, and drops the emptied paragraph', () => {
    const block = blockWith('<h1>H</h1><p><a href="/gated"><picture><img src="hero.jpg"></picture></a></p>');
    decorate(block);
    const link = block.querySelector('.guide-hero-media a[href="/gated"]');
    expect(link).toBeTruthy();
    expect(link.querySelector('picture img')).toBeTruthy();
    // the <p> that held the link is gone, not left behind carrying its margin
    expect(block.querySelectorAll('.guide-hero-copy p').length).toBe(0);
  });
});

describe('buildGuideHeroAutoBlock', () => {
  const mainWith = (html) => {
    const main = document.createElement('main');
    main.innerHTML = html;
    return main;
  };
  const SECTION = '<div><h1>Headline</h1><p>Lede.</p><p><picture><img src="hero.jpg"></picture></p></div>';

  it('promotes section 1 on a Guide page', () => {
    const main = mainWith(SECTION);
    const block = buildGuideHeroAutoBlock(main);
    expect(block.classList.contains('guide-hero')).toBe(true);
    expect(main.querySelector(':scope > div').firstElementChild).toBe(block);
    expect(block.querySelector('h1')).toBeTruthy();
    expect(block.querySelector('picture img')).toBeTruthy();
  });

  it('does nothing without an h1 to build a header around', () => {
    const noH1 = mainWith('<div><p>Lede.</p><p><picture><img src="hero.jpg"></picture></p></div>');
    expect(buildGuideHeroAutoBlock(noH1)).toBeNull();
  });

  it('still builds the block when there is no photo — that is the no-media variant', () => {
    // building it either way is what keeps the imageless treatment inside the
    // block's own CSS instead of in the global stylesheet
    const main = mainWith('<div><h1>Headline</h1><p>Lede.</p></div>');
    const block = buildGuideHeroAutoBlock(main);
    expect(block).toBeTruthy();
    expect(block.querySelector('h1')).toBeTruthy();
  });

  it('leaves authored blocks in the section — nesting them would break decorateBlocks', () => {
    const main = mainWith(`<div>
      <h1>Headline</h1>
      <p><picture><img src="hero.jpg"></picture></p>
      <div class="download-form"><div><div>Get it</div></div></div>
    </div>`);
    const block = buildGuideHeroAutoBlock(main);
    const section = main.querySelector(':scope > div');
    // the form is still a direct child of the section, where decorateBlocks looks
    expect(section.querySelector(':scope > .download-form')).toBeTruthy();
    expect(block.querySelector('.download-form')).toBeNull();
    expect(block.querySelector('h1')).toBeTruthy();
  });

  it('leaves a lone video link for buildVideoAutoBlocks', () => {
    const main = mainWith(`<div>
      <h1>Headline</h1>
      <p><a href="https://www.youtube.com/watch?v=abc123">Watch</a></p>
      <p><picture><img src="hero.jpg"></picture></p>
    </div>`);
    const block = buildGuideHeroAutoBlock(main);
    const section = main.querySelector(':scope > div');
    expect(section.querySelector(':scope > p > a[href*="youtube"]')).toBeTruthy();
    expect(block.querySelector('a[href*="youtube"]')).toBeNull();
  });

  it('is idempotent', () => {
    const main = mainWith(SECTION);
    buildGuideHeroAutoBlock(main);
    expect(buildGuideHeroAutoBlock(main)).toBeNull();
    expect(main.querySelectorAll('.guide-hero').length).toBe(1);
  });
});

describe('isGuidePage', () => {
  const setPage = (path, template) => {
    window.history.pushState({}, '', path);
    document.head.innerHTML = template ? `<meta name="template" content="${template}">` : '';
  };

  it('is true for a Guide page under /blog/guide/', () => {
    setPage('/blog/guide/construction-accounting-erp', 'Guide');
    expect(isGuidePage()).toBe(true);
  });

  it('is true for a Guide page anywhere else — the template is the contract, not the path', () => {
    // /library/templates/guide is the real case: it carries `template: Guide` and
    // the same h1 + hero photo, and it is the document authors copy a new guide
    // from, so it has to render like one
    ['/library/templates/guide', '/resources/some-new-guide', '/guide'].forEach((path) => {
      setPage(path, 'Guide');
      expect(isGuidePage()).toBe(true);
    });
  });

  it('is false for every other template', () => {
    ['Blog Article', 'Case Study', 'Research', 'Category', 'Author', ''].forEach((template) => {
      setPage('/blog/guide/construction-accounting-erp', template);
      expect(isGuidePage()).toBe(false);
    });
  });

  it('is false on the guide listing page, which is a Category', () => {
    // /blog/guide (no trailing segment) is the paginated blog-cards index
    setPage('/blog/guide', 'Category');
    expect(isGuidePage()).toBe(false);
  });

  it('tolerates casing and stray whitespace in the metadata', () => {
    ['guide', ' Guide ', 'GUIDE'].forEach((template) => {
      setPage('/blog/guide/data-analytics', template);
      expect(isGuidePage()).toBe(true);
    });
  });
});
