import { describe, it, expect } from 'vitest';
import {
  resolveFragmentPaths,
  toPlainHtmlPath,
  createCacheKeys,
  mergeCacheKeys,
  serializeCacheKeys,
  inlineTag,
  metaContent,
  DEFAULT_NAV_PATH,
  DEFAULT_FOOTER_PATH,
} from '../akamai/src/inline.js';

// Header bag matching the { get } shape inline.js consumes.
const bag = (tags) => ({ get: (name) => (name === 'edge-cache-tag' ? tags : null) });

describe('resolveFragmentPaths', () => {
  it('defaults to /nav and /footer when both empty tags exist and no meta', () => {
    const html = '<html><head></head><body><header></header><main></main><footer></footer></body></html>';
    expect(resolveFragmentPaths(html)).toEqual({
      navPath: DEFAULT_NAV_PATH,
      footerPath: DEFAULT_FOOTER_PATH,
    });
  });

  it('honors nav/footer metadata overrides', () => {
    const html = '<head>'
      + '<meta name="nav" content="/regions/uk/nav">'
      + '<meta name="footer" content="/regions/uk/footer">'
      + '</head><body><header></header><footer></footer></body>';
    expect(resolveFragmentPaths(html)).toEqual({
      navPath: '/regions/uk/nav',
      footerPath: '/regions/uk/footer',
    });
  });

  it('returns null for a fragment whose empty tag is absent', () => {
    const html = '<body><header></header><main></main></body>'; // no <footer></footer>
    expect(resolveFragmentPaths(html)).toEqual({ navPath: '/nav', footerPath: null });
  });

  it('skips a fragment already filled in (non-empty tag)', () => {
    const html = '<body><header><nav>already</nav></header><footer></footer></body>';
    expect(resolveFragmentPaths(html)).toEqual({ navPath: null, footerPath: '/footer' });
  });

  it.each(['true', 'yes', 'hide', 'Hide', ' YES '])(
    'skips nav/footer when hide metadata is %o',
    (val) => {
      const html = `<head><meta name="hide-header" content="${val}"><meta name="hide-footer" content="${val}"></head>`
        + '<body><header></header><footer></footer></body>';
      expect(resolveFragmentPaths(html)).toEqual({ navPath: null, footerPath: null });
    },
  );

  it('does not treat other hide values as hidden', () => {
    const html = '<head><meta name="hide-header" content="false"></head>'
      + '<body><header></header><footer></footer></body>';
    expect(resolveFragmentPaths(html).navPath).toBe('/nav');
  });
});

describe('metaContent', () => {
  it('reads a meta value case-insensitively on the tag', () => {
    expect(metaContent('<META NAME="nav" CONTENT="/x">', 'nav')).toBe('/x');
  });
  it('returns undefined when absent', () => {
    expect(metaContent('<head></head>', 'nav')).toBeUndefined();
  });
});

describe('toPlainHtmlPath', () => {
  it('appends .plain.html', () => {
    expect(toPlainHtmlPath('/nav')).toBe('/nav.plain.html');
  });
  it('maps a folder-index path to /index.plain.html', () => {
    expect(toPlainHtmlPath('/regions/uk/')).toBe('/regions/uk/index.plain.html');
  });
  it('is idempotent on an already-plain path', () => {
    expect(toPlainHtmlPath('/nav.plain.html')).toBe('/nav.plain.html');
  });
});

describe('cache keys (edge-cache-tag union)', () => {
  it('seeds from the page response', () => {
    const keys = createCacheKeys(bag('page-a, page-b'));
    expect(serializeCacheKeys(keys)).toBe('page-a,page-b');
  });

  it('unions fragment tags into the page tags and dedupes', () => {
    const keys = createCacheKeys(bag('page, shared'));
    mergeCacheKeys(keys, bag('nav, shared')); // "shared" already present
    mergeCacheKeys(keys, bag('footer'));
    expect([...keys].sort()).toEqual(['footer', 'nav', 'page', 'shared']);
  });

  it('tolerates missing/empty headers', () => {
    const keys = createCacheKeys(bag(null));
    mergeCacheKeys(keys, bag('  '));
    mergeCacheKeys(keys, bag('only'));
    expect(serializeCacheKeys(keys)).toBe('only');
  });
});

describe('inlineTag', () => {
  it('wraps the fragment in a <nav> inside the tag, preserving indentation', () => {
    const html = '  <header></header>';
    const out = inlineTag(html, 'header', '<div class="navigation">x</div>');
    expect(out).toBe(
      '  <header>\n'
      + '    <nav>\n'
      + '      <div class="navigation">x</div>\n'
      + '    </nav>\n'
      + '  </header>',
    );
  });

  it('inlines footer the same way', () => {
    const out = inlineTag('<footer></footer>', 'footer', '<div class="footer-columns">c</div>');
    expect(out).toBe(
      '<footer>\n  <nav>\n    <div class="footer-columns">c</div>\n  </nav>\n</footer>',
    );
  });

  it('is a no-op when there is no fragment markup', () => {
    expect(inlineTag('<header></header>', 'header', '')).toBe('<header></header>');
  });

  it('only replaces the empty tag, leaving the rest of the document intact', () => {
    const html = '<body><header></header><main>hi</main><footer></footer></body>';
    const out = inlineTag(html, 'header', '<div>N</div>');
    expect(out).toContain('<main>hi</main>');
    expect(out).toContain('<footer></footer>');
    expect(out).toContain('<nav>\n    <div>N</div>');
  });
});
