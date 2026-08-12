import { describe, it, expect } from 'vitest';
import {
  parseExperience,
  setBlockTag,
  clearBlockTag,
  setSectionTag,
  clearSectionTag,
  setPageExperiment,
  clearPageExperiment,
  slugify,
  buildFormData,
} from '../tools/plugins/personalization/experience.js';

const PAGE = `<body>
  <header></header>
  <main>
    <div>
      <h1>Hero</h1>
      <div class="hero exp-hero-test">
        <div><div>a</div></div>
      </div>
    </div>
    <div>
      <div class="cards">
        <div><div>b</div></div>
      </div>
      <div class="section-metadata">
        <div><div>Style</div><div>dark, pzn-smb</div></div>
        <div><div>Background</div><div>https://content.da.live/x.jpg</div></div>
      </div>
    </div>
    <div>
      <div class="metadata">
        <div><div>Title</div><div>My Page</div></div>
        <div><div>experiment-id</div><div>385944</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>`;

describe('slugify', () => {
  it('lowercases and hyphenates free-form text', () => {
    expect(slugify('Hero Test 1')).toBe('hero-test-1');
    expect(slugify('  SMB / Retail!! ')).toBe('smb-retail');
    expect(slugify('already-slug')).toBe('already-slug');
  });

  it('returns empty string for empty or symbol-only input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('parseExperience', () => {
  it('reads page metadata, sections, blocks, and both tag modes', () => {
    const { page, sections } = parseExperience(PAGE);

    expect(page).toEqual({ experimentId: '385944', experimentLabel: '' });
    expect(sections).toHaveLength(3);

    // section 0: block-level exp tag
    expect(sections[0].exp).toBeNull();
    expect(sections[0].pzn).toBeNull();
    expect(sections[0].blocks).toEqual([
      { index: 0, name: 'hero', exp: 'exp-hero-test', pzn: null },
    ]);

    // section 1: section-level pzn tag in Style row
    expect(sections[1].pzn).toBe('pzn-smb');
    expect(sections[1].exp).toBeNull();
    // section-metadata is excluded from the block list
    expect(sections[1].blocks).toEqual([
      { index: 0, name: 'cards', exp: null, pzn: null },
    ]);

    // section 2: carries the page Metadata block
    expect(sections[2].hasPageMeta).toBe(true);
    expect(sections[2].blocks).toEqual([]);
  });

  it('returns empty page + no sections when there is no <main>', () => {
    const { page, sections } = parseExperience('<body><header></header></body>');
    expect(page).toEqual({ experimentId: '', experimentLabel: '' });
    expect(sections).toEqual([]);
  });
});

describe('setBlockTag / clearBlockTag', () => {
  it('replaces an existing tag of the same mode rather than stacking', () => {
    const out = setBlockTag(PAGE, 0, 0, 'exp', 'New Test');
    const block = parseExperience(out).sections[0].blocks[0];
    expect(block.exp).toBe('exp-new-test');
    expect(out).toContain('class="hero exp-new-test"');
    expect(out).not.toContain('exp-hero-test');
  });

  it('lets the two modes coexist on one block', () => {
    const out = setBlockTag(PAGE, 0, 0, 'pzn', 'vip');
    const block = parseExperience(out).sections[0].blocks[0];
    expect(block.exp).toBe('exp-hero-test');
    expect(block.pzn).toBe('pzn-vip');
  });

  it('clears only the targeted mode, keeping the block name', () => {
    const out = clearBlockTag(PAGE, 0, 0, 'exp');
    expect(out).toContain('class="hero"');
    expect(parseExperience(out).sections[0].blocks[0].exp).toBeNull();
  });

  it('is a no-op for an out-of-range address', () => {
    expect(setBlockTag(PAGE, 9, 9, 'exp', 'x')).toBe(PAGE);
  });
});

describe('setSectionTag / clearSectionTag', () => {
  it('creates section-metadata + Style row when absent', () => {
    const out = setSectionTag(PAGE, 0, 'exp', 'promo');
    expect(parseExperience(out).sections[0].exp).toBe('exp-promo');
    expect(out).toContain('section-metadata');
  });

  it('preserves other Style tokens including the other mode', () => {
    const out = setSectionTag(PAGE, 1, 'exp', 'q1');
    const section = parseExperience(out).sections[1];
    expect(section.exp).toBe('exp-q1');
    expect(section.pzn).toBe('pzn-smb');
    expect(out).toContain('dark');
  });

  it('replaces an existing token of the same mode', () => {
    const once = setSectionTag(PAGE, 1, 'pzn', 'enterprise');
    const section = parseExperience(once).sections[1];
    expect(section.pzn).toBe('pzn-enterprise');
    expect(once).not.toContain('pzn-smb');
  });

  it('clears the tag and drops an emptied Style row but keeps other rows', () => {
    const out = clearSectionTag(PAGE, 1, 'pzn');
    const section = parseExperience(out).sections[1];
    expect(section.pzn).toBeNull();
    // 'dark' remains, so the Style row stays
    expect(out).toContain('dark');
    // Background row untouched
    expect(out).toContain('Background');
  });

  it('removes the section-metadata block when clearing leaves it empty', () => {
    const withTag = setSectionTag('<body><main><div><div class="cards"><div><div>a</div></div></div></div></main></body>', 0, 'pzn', 'smb');
    expect(withTag).toContain('section-metadata');
    const cleared = clearSectionTag(withTag, 0, 'pzn');
    expect(cleared).not.toContain('section-metadata');
  });
});

describe('setPageExperiment / clearPageExperiment', () => {
  const NOMETA = `<body><header></header><main><div><h1>Hi</h1></div></main><footer></footer></body>`;

  it('updates the id in place on an existing metadata block', () => {
    const out = setPageExperiment(PAGE, { id: '999' });
    expect(parseExperience(out).page.experimentId).toBe('999');
    // existing Title row preserved
    expect(out).toContain('My Page');
  });

  it('adds a label row and keeps the id', () => {
    const out = setPageExperiment(PAGE, { id: '385944', label: 'Hero Test' });
    expect(parseExperience(out).page).toEqual({
      experimentId: '385944',
      experimentLabel: 'Hero Test',
    });
  });

  it('removes the label row when label is blank', () => {
    const withLabel = setPageExperiment(PAGE, { id: '1', label: 'L' });
    const withoutLabel = setPageExperiment(withLabel, { id: '1', label: '' });
    expect(parseExperience(withoutLabel).page.experimentLabel).toBe('');
    expect(withoutLabel).not.toContain('experiment-label');
  });

  it('creates a metadata block in a trailing section when none exists', () => {
    const out = setPageExperiment(NOMETA, { id: 'abc' });
    expect(out).toContain('class="metadata"');
    expect(parseExperience(out).page.experimentId).toBe('abc');
  });

  it('is a no-op when id is empty', () => {
    expect(setPageExperiment(PAGE, { id: '' })).toBe(PAGE);
    expect(setPageExperiment(PAGE, {})).toBe(PAGE);
  });

  it('clears experiment rows but keeps other metadata rows and the block', () => {
    const out = clearPageExperiment(PAGE);
    expect(parseExperience(out).page.experimentId).toBe('');
    expect(out).toContain('My Page');
    expect(out).toContain('class="metadata"');
  });

  it('removes the metadata block + trailing section when it becomes empty', () => {
    const created = setPageExperiment(NOMETA, { id: 'abc', label: 'L' });
    const cleared = clearPageExperiment(created);
    expect(cleared).not.toContain('class="metadata"');
    // no leftover empty trailing section beyond the original content section
    expect(parseExperience(cleared).sections).toHaveLength(1);
  });
});

describe('buildFormData', () => {
  it('wraps the html as a text/html data blob', () => {
    const fd = buildFormData('<body></body>');
    expect(fd).toBeInstanceOf(FormData);
    const data = fd.get('data');
    expect(data).toBeInstanceOf(Blob);
    expect(data.type).toBe('text/html');
  });
});
