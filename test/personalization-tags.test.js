import { describe, it, expect } from 'vitest';
import {
  parseExperience,
  setSectionTag,
  clearSectionTag,
  setPageExperiment,
  clearPageExperiment,
  setPagePersonalization,
  clearPagePersonalization,
  splitList,
  joinList,
  toPath,
  buildFormData,
} from '../tools/plugins/personalization/experience.js';

const PAGE = `<body>
  <header></header>
  <main>
    <div>
      <h1>Hero</h1>
      <div class="hero">
        <div><div>a</div></div>
      </div>
    </div>
    <div>
      <div class="cards">
        <div><div>b</div></div>
      </div>
      <div class="media-text">
        <div><div>c</div></div>
      </div>
      <div class="section-metadata">
        <div><div>Style</div><div>dark</div></div>
        <div><div>pzn</div><div>myPlacementId</div></div>
        <div><div>pzn-block</div><div>cards</div></div>
        <div><div>pzn-variants</div><div>/fragments/pzn/a, /fragments/pzn/b</div></div>
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

describe('toPath', () => {
  it('reduces a full aem.page/hlx.page URL to a pathname', () => {
    expect(toPath('https://main--repo--org.aem.page/fragments/pzn/x')).toBe('/fragments/pzn/x');
    expect(toPath('https://x.hlx.page/a/b?q=1')).toBe('/a/b');
  });
  it('leaves a bare path untouched and trims', () => {
    expect(toPath('  /fragments/pzn/x  ')).toBe('/fragments/pzn/x');
    expect(toPath(null)).toBe('');
  });
});

describe('splitList / joinList', () => {
  it('splits on comma and newline, trims, drops empties', () => {
    expect(splitList('/a, /b\n/c , ')).toEqual(['/a', '/b', '/c']);
    expect(splitList('')).toEqual([]);
  });
  it('caps at 5 items', () => {
    expect(splitList('/1,/2,/3,/4,/5,/6,/7')).toHaveLength(5);
  });
  it('joins to a comma-separated pathname list, mapping URLs and capping', () => {
    expect(joinList(['https://x.aem.page/a', '/b'])).toBe('/a, /b');
    expect(joinList(['/1', '/2', '/3', '/4', '/5', '/6'])).toBe('/1, /2, /3, /4, /5');
    expect(joinList(null)).toBe('');
  });
});

describe('parseExperience', () => {
  it('reads page experiment metadata, section ids, block scope, and variants', () => {
    const { page, sections } = parseExperience(PAGE);

    expect(page).toEqual({
      experimentId: '385944',
      experimentLabel: '',
      experimentVariants: [],
      personalizationId: '',
      personalizationVariants: [],
    });
    expect(sections).toHaveLength(3);

    // section 0: untagged, one block
    expect(sections[0].pzn).toBe('');
    expect(sections[0].exp).toBe('');
    expect(sections[0].blocks).toEqual([{ index: 0, name: 'hero' }]);

    // section 1: pzn id (verbatim camelCase), block scope, variants; two blocks listed
    expect(sections[1].pzn).toBe('myPlacementId');
    expect(sections[1].pznBlock).toBe('cards');
    expect(sections[1].pznVariants).toEqual(['/fragments/pzn/a', '/fragments/pzn/b']);
    expect(sections[1].exp).toBe('');
    expect(sections[1].blocks).toEqual([
      { index: 0, name: 'cards' },
      { index: 1, name: 'media-text' },
    ]);

    // section 2: carries the page Metadata block
    expect(sections[2].hasPageMeta).toBe(true);
    expect(sections[2].blocks).toEqual([]);
  });

  it('returns empty page + no sections when there is no <main>', () => {
    const { page, sections } = parseExperience('<body><header></header></body>');
    expect(page).toEqual({
      experimentId: '',
      experimentLabel: '',
      experimentVariants: [],
      personalizationId: '',
      personalizationVariants: [],
    });
    expect(sections).toEqual([]);
  });
});

describe('setSectionTag', () => {
  it('creates a section-metadata block and writes id verbatim (camelCase preserved)', () => {
    const out = setSectionTag(PAGE, 0, 'exp', { id: 'MyExpId123' });
    const section = parseExperience(out).sections[0];
    expect(section.exp).toBe('MyExpId123');
    expect(out).toContain('section-metadata');
    // no block/variants rows when not provided
    expect(section.expBlock).toBe('');
    expect(section.expVariants).toEqual([]);
  });

  it('writes a block-scope row when block is provided', () => {
    const out = setSectionTag(PAGE, 0, 'pzn', { id: 'p1', block: 'hero' });
    const section = parseExperience(out).sections[0];
    expect(section.pzn).toBe('p1');
    expect(section.pznBlock).toBe('hero');
  });

  it('writes up to 5 variants, mapping URLs to pathnames and capping', () => {
    const out = setSectionTag(PAGE, 0, 'pzn', {
      id: 'p1',
      variants: [
        'https://main--r--o.aem.page/fragments/pzn/a',
        '/fragments/pzn/b', '/fragments/pzn/c', '/fragments/pzn/d', '/fragments/pzn/e', '/fragments/pzn/f',
      ],
    });
    const section = parseExperience(out).sections[0];
    expect(section.pznVariants).toEqual([
      '/fragments/pzn/a', '/fragments/pzn/b', '/fragments/pzn/c', '/fragments/pzn/d', '/fragments/pzn/e',
    ]);
  });

  it('updates in place and lets the two modes coexist, preserving Style', () => {
    const out = setSectionTag(PAGE, 1, 'exp', { id: 'e9' });
    const section = parseExperience(out).sections[1];
    expect(section.exp).toBe('e9');
    expect(section.pzn).toBe('myPlacementId'); // untouched
    expect(out).toContain('dark'); // Style row preserved
  });

  it('removes block/variants rows when re-set without them', () => {
    const out = setSectionTag(PAGE, 1, 'pzn', { id: 'myPlacementId' });
    const section = parseExperience(out).sections[1];
    expect(section.pznBlock).toBe('');
    expect(section.pznVariants).toEqual([]);
    expect(section.pzn).toBe('myPlacementId');
  });

  it('writes and clears the append (mode) flag for both modes', () => {
    const appended = setSectionTag(PAGE, 0, 'pzn', { id: 'p1', append: true });
    expect(appended).toContain('pzn-mode');
    expect(parseExperience(appended).sections[0].pznAppend).toBe(true);

    // exp works identically
    const expAppended = setSectionTag(PAGE, 0, 'exp', { id: 'e1', append: true });
    expect(parseExperience(expAppended).sections[0].expAppend).toBe(true);

    // default is swap; re-set without append removes the row
    expect(parseExperience(setSectionTag(PAGE, 0, 'pzn', { id: 'p1' })).sections[0].pznAppend).toBe(false);
    const cleared = setSectionTag(appended, 0, 'pzn', { id: 'p1', append: false });
    expect(parseExperience(cleared).sections[0].pznAppend).toBe(false);
  });

  it('is a no-op for empty id, invalid mode, or out-of-range section', () => {
    expect(setSectionTag(PAGE, 0, 'pzn', { id: '' })).toBe(PAGE);
    expect(setSectionTag(PAGE, 0, 'nope', { id: 'x' })).toBe(PAGE);
    expect(setSectionTag(PAGE, 9, 'pzn', { id: 'x' })).toBe(PAGE);
  });
});

describe('clearSectionTag', () => {
  it('clears only the targeted mode (id + block + variants)', () => {
    const withExp = setSectionTag(PAGE, 1, 'exp', { id: 'e1', variants: ['/x'] });
    const out = clearSectionTag(withExp, 1, 'pzn');
    const section = parseExperience(out).sections[1];
    expect(section.pzn).toBe('');
    expect(section.pznBlock).toBe('');
    expect(section.pznVariants).toEqual([]);
    expect(section.exp).toBe('e1'); // other mode preserved
  });

  it('drops the section-metadata block when clearing leaves it empty', () => {
    const only = setSectionTag('<body><main><div><div class="cards"><div><div>a</div></div></div></div></main></body>', 0, 'pzn', { id: 'p1' });
    expect(only).toContain('section-metadata');
    const cleared = clearSectionTag(only, 0, 'pzn');
    expect(cleared).not.toContain('section-metadata');
  });
});

describe('setPageExperiment / clearPageExperiment', () => {
  const NOMETA = `<body><header></header><main><div><h1>Hi</h1></div></main><footer></footer></body>`;

  it('updates id in place and adds label + variants', () => {
    const out = setPageExperiment(PAGE, {
      id: '999',
      label: 'Hero Test',
      variants: ['https://x.aem.page/v1', '/v2'],
    });
    expect(parseExperience(out).page).toEqual({
      experimentId: '999',
      experimentLabel: 'Hero Test',
      experimentVariants: ['/v1', '/v2'],
      personalizationId: '',
      personalizationVariants: [],
    });
    expect(out).toContain('My Page'); // existing Title preserved
  });

  it('removes label/variants rows when blank/empty', () => {
    const withAll = setPageExperiment(PAGE, { id: '1', label: 'L', variants: ['/v'] });
    const stripped = setPageExperiment(withAll, { id: '1' });
    expect(parseExperience(stripped).page).toEqual({
      experimentId: '1',
      experimentLabel: '',
      experimentVariants: [],
      personalizationId: '',
      personalizationVariants: [],
    });
    expect(stripped).not.toContain('experiment-label');
    expect(stripped).not.toContain('experiment-variants');
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
    expect(parseExperience(cleared).sections).toHaveLength(1);
  });
});

describe('setPagePersonalization / clearPagePersonalization', () => {
  const NOMETA = `<body><header></header><main><div><h1>Hi</h1></div></main><footer></footer></body>`;

  it('writes personalization-id (+ variants) into the page Metadata block', () => {
    const out = setPagePersonalization(PAGE, {
      id: 'homepageHero',
      variants: ['https://x.aem.page/fragments/pzn/a', '/fragments/pzn/b'],
    });
    const { page } = parseExperience(out);
    expect(page.personalizationId).toBe('homepageHero');
    expect(page.personalizationVariants).toEqual(['/fragments/pzn/a', '/fragments/pzn/b']);
    expect(out).toContain('My Page'); // existing Title preserved
    expect(page.experimentId).toBe('385944'); // experiment tag untouched
  });

  it('removes the variants row when re-set without them', () => {
    const withAll = setPagePersonalization(PAGE, { id: 'p', variants: ['/v'] });
    const stripped = setPagePersonalization(withAll, { id: 'p' });
    expect(parseExperience(stripped).page.personalizationVariants).toEqual([]);
    expect(stripped).not.toContain('personalization-variants');
  });

  it('creates a metadata block in a trailing section when none exists', () => {
    const out = setPagePersonalization(NOMETA, { id: 'abc' });
    expect(out).toContain('class="metadata"');
    expect(parseExperience(out).page.personalizationId).toBe('abc');
  });

  it('is a no-op when id is empty', () => {
    expect(setPagePersonalization(PAGE, { id: '' })).toBe(PAGE);
    expect(setPagePersonalization(PAGE, {})).toBe(PAGE);
  });

  it('clears personalization rows but keeps the experiment tag and the block', () => {
    const withPzn = setPagePersonalization(PAGE, { id: 'p', variants: ['/v'] });
    const cleared = clearPagePersonalization(withPzn);
    const { page } = parseExperience(cleared);
    expect(page.personalizationId).toBe('');
    expect(page.personalizationVariants).toEqual([]);
    expect(page.experimentId).toBe('385944'); // experiment preserved
    expect(cleared).toContain('class="metadata"');
  });

  it('removes the metadata block + trailing section when personalization was its only content', () => {
    const created = setPagePersonalization(NOMETA, { id: 'abc', variants: ['/v'] });
    const cleared = clearPagePersonalization(created);
    expect(cleared).not.toContain('class="metadata"');
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
