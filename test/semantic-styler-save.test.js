import {
  describe, it, expect, vi, beforeAll, afterEach,
} from 'vitest';
import {
  editDoc, headingInfo, paragraphAllEnabled, setParagraphAllEnabled, setSectionParagraphSize,
  clearHeadingSizes, onSourceSaved, blockWithParagraphSize, hasParagraphSize, SAVE_SETTINGS,
  onSaveProgress, setNativeEditor, singleBlockEdit, setHeadingSize, setHeadingSizes, clearBlockSizes,
} from '../tools/plugins/sematic-styler/heading-styler.js';
import { summary } from '../tools/plugins/sematic-styler/metrics.js';

const context = { org: 'org', repo: 'site', path: '/page' };
const SOURCE_URL = 'https://admin.da.live/source/org/site/page.html';
const page = (text) => `<html><head></head><body><main><div><p>${text}</p></div></main></body></html>`;

const res = (status, { body = null, etag } = {}) => new Response(body, {
  status, headers: etag ? { ETag: etag } : {},
});

// jsdom's Blob has no text().
const readBlob = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsText(blob);
});

/** A daFetch mock answering GET/PUT/HEAD from queues, recording each call. */
function mockDa({ gets = [], puts = [], heads = [] }) {
  const calls = [];
  const daFetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const call = { method, url, ifMatch: opts.headers?.['If-Match'] };
    if (method === 'PUT') call.html = await readBlob(opts.body.get('data'));
    calls.push(call);
    const queue = { GET: gets, PUT: puts, HEAD: heads }[method];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    // A function answers lazily (fresh Response, a hang, or a server-side effect).
    return typeof next === 'function' ? next(opts) : next;
  });
  return { sdk: { actions: { daFetch }, context }, calls };
}

// What daFetch returns when fetch itself fails (offline, CORS, abort).
const networkFailure = () => new Response(null, { status: 500, statusText: 'Failed to fetch' });
// A request that never answers until aborted, as daFetch then reports it.
const hang = (opts) => new Promise((resolve) => {
  opts.signal.addEventListener('abort', () => resolve(new Response(null, { status: 500, statusText: 'aborted' })));
});

beforeAll(() => {
  Object.assign(SAVE_SETTINGS, { backoffMs: 1, maxBackoffMs: 5 });
});

// Marks the page's paragraph, like a size edit does; safe to run again.
const markP = (doc) => {
  doc.querySelector('main p').classList.add('body-m');
  return 1;
};

describe('semantic styler save', () => {
  it('saves with If-Match and verifies the ETag', async () => {
    const { sdk, calls } = mockDa({
      gets: [res(200, { body: page('one'), etag: '"a"' })],
      puts: [res(201, { etag: '"b"' })],
      heads: [res(200, { etag: '"b"' })],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'HEAD']);
    expect(calls[1]).toMatchObject({ url: SOURCE_URL, ifMatch: '"a"' });
    expect(calls[1].html).toContain('class="body-m"');
  });

  it('re-reads and re-applies after a 412', async () => {
    const { sdk, calls } = mockDa({
      gets: [res(200, { body: page('old'), etag: '"a"' }), res(200, { body: page('newer'), etag: '"b"' })],
      puts: [res(412), res(201, { etag: '"c"' })],
      heads: [res(200, { etag: '"c"' })],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.ifMatch)).toEqual(['"a"', '"b"']);
    expect(puts[1].html).toContain('newer');
    expect(puts[1].html).toContain('class="body-m"');
  });

  it('re-applies on top of a collab flush that replaced the save', async () => {
    const { sdk, calls } = mockDa({
      gets: [
        res(200, { body: page('before'), etag: '"a"' }),
        res(200, { body: page('typed by author'), etag: '"x"' }),
      ],
      puts: [res(201, { etag: '"b"' }), res(201, { etag: '"c"' })],
      heads: [res(200, { etag: '"x"' }), res(200, { etag: '"c"' })],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    const last = calls.filter((c) => c.method === 'PUT').at(-1);
    expect(last.ifMatch).toBe('"x"');
    expect(last.html).toContain('typed by author');
    expect(last.html).toContain('class="body-m"');
  });

  it('gives up after repeated conflicts', async () => {
    const { sdk, calls } = mockDa({
      gets: [1, 2, 3, 4].map((n) => res(200, { body: page('p'), etag: `"${n}"` })),
      puts: [() => res(412)],
      heads: [],
    });
    await expect(editDoc(sdk, markP)).rejects.toThrow('The page changed while saving');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(SAVE_SETTINGS.attempts);
  });

  it('saves without conditions when the server sends no ETag', async () => {
    const { sdk, calls } = mockDa({
      gets: [res(200, { body: page('p') })],
      puts: [res(201)],
      heads: [],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[1].ifMatch).toBeUndefined();
  });

  it('hands over the saved markup only once the ETag confirms it is current', async () => {
    const seen = [];
    const stop = onSourceSaved((html) => seen.push(html));
    const confirmed = mockDa({
      gets: [res(200, { body: page('one'), etag: '"a"' })],
      puts: [res(201, { etag: '"b"' })],
      heads: [res(200, { etag: '"b"' })],
    });
    await editDoc(confirmed.sdk, markP);
    const unconfirmed = mockDa({ gets: [res(200, { body: page('two') })], puts: [res(201)], heads: [] });
    await editDoc(unconfirmed.sdk, markP);
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('class="body-m"');
  });

  it('skips the save when no edit changes anything', async () => {
    const { sdk, calls } = mockDa({
      gets: [res(200, { body: page('p'), etag: '"a"' })],
      puts: [],
      heads: [],
    });
    await expect(editDoc(sdk, () => false)).resolves.toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

describe('save reliability', () => {
  const ok = (text, etag) => () => res(200, { body: page(text), etag });

  it('retries a read that failed on the network, with progress reported', async () => {
    const progress = [];
    const stop = onSaveProgress((p) => progress.push(p));
    const { sdk, calls } = mockDa({
      gets: [networkFailure, ok('p', '"a"')],
      puts: [res(201, { etag: '"b"' })],
      heads: [res(200, { etag: '"b"' })],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    stop();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PUT', 'HEAD']);
    expect(progress).toEqual([{ attempt: 2, attempts: SAVE_SETTINGS.attempts, reason: 'read-network' }]);
  });

  it('backs off and retries a 503 save against a fresh read', async () => {
    const { sdk, calls } = mockDa({
      gets: [ok('p', '"a"'), ok('p', '"a"')],
      puts: [res(503), res(201, { etag: '"b"' })],
      heads: [res(200, { etag: '"b"' })],
    });
    await expect(editDoc(sdk, markP)).resolves.toBe(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });

  it('does not save twice when a timed-out save actually landed', async () => {
    const before = SAVE_SETTINGS.timeoutMs.PUT;
    SAVE_SETTINGS.timeoutMs.PUT = 20;
    // The PUT lands on the server but its response never arrives; the next read shows it.
    const landed = '<html><head></head><body><main><div><p class="body-m">p</p></div></main></body></html>';
    const { sdk, calls } = mockDa({
      gets: [ok('p', '"a"'), () => res(200, { body: landed, etag: '"b"' })],
      puts: [hang],
      heads: [],
    });
    try {
      await expect(editDoc(sdk, markP)).resolves.toBe(1);
    } finally {
      SAVE_SETTINGS.timeoutMs.PUT = before;
    }
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET']);
  });

  it('times out a hung read instead of waiting forever', async () => {
    const before = SAVE_SETTINGS.timeoutMs.GET;
    SAVE_SETTINGS.timeoutMs.GET = 20;
    // daFetch ignoring the abort entirely must not hang the save either.
    const { sdk } = mockDa({ gets: [() => new Promise(() => {})], puts: [], heads: [] });
    try {
      await expect(editDoc(sdk, markP)).rejects.toMatchObject({ network: true });
    } finally {
      SAVE_SETTINGS.timeoutMs.GET = before;
    }
  });

  it('reports an unconfirmed save, not a failed one, when save answers never arrive', async () => {
    const { sdk } = mockDa({
      gets: [ok('p', '"a"')],
      puts: [networkFailure],
      heads: [],
    });
    const error = await editDoc(sdk, markP).catch((e) => e);
    expect(error).toMatchObject({ uncertain: true, network: true });
    expect(error.message).toMatch('did not confirm');
  });

  it('fails plainly, without retrying, on a non-retryable status', async () => {
    const { sdk, calls } = mockDa({ gets: [res(403)], puts: [], heads: [] });
    await expect(editDoc(sdk, markP)).rejects.toThrow('Load failed (403)');
    expect(calls).toHaveLength(1);
  });

  it('records outcomes, retries and failure reasons', () => {
    const s = summary();
    expect(s.operations).toBeGreaterThan(0);
    expect(s.retries).toBeGreaterThan(0);
    expect(Object.keys(s.failureReasons)).toEqual(expect.arrayContaining(['read-403']));
  });
});

describe('section-level apply to all paragraphs', () => {
  const meta = (rows) => `<div class="section-metadata">${rows
    .map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`).join('')}</div>`;
  // A section whose paragraphs are all in a block, plus optional section metadata rows.
  const blockPage = (blockClass = 'cards', rows = []) => `<html><head></head><body><main><div>
    <div class="${blockClass}"><div><div><p>one</p><p>two</p></div></div></div>
    ${rows.length ? meta(rows) : ''}</div></main></body></html>`;

  const targetsOf = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('main p')].map(headingInfo);
  };
  const savedDoc = (calls) => new DOMParser()
    .parseFromString(calls.filter((c) => c.method === 'PUT').at(-1).html, 'text/html');
  const sectionOf = (doc) => doc.querySelector('main > div');
  const styleRow = (doc) => [...doc.querySelectorAll('.section-metadata > div')]
    .find((row) => row.children[0].textContent.trim() === 'style')?.children[1].textContent;
  const hasParagraphAllRow = (doc) => [...doc.querySelectorAll('.section-metadata > div')]
    .some((row) => row.children[0].textContent.trim() === 'paragraph-all');
  const saveOnce = (html) => mockDa({
    gets: [res(200, { body: html })], puts: [res(201)], heads: [],
  });

  it('writes no paragraph-all row when checked, and drops a legacy one', async () => {
    const html = blockPage('cards p-1-size-body-s', [['paragraph-all', 'true']]);
    const { sdk, calls } = saveOnce(html);
    await setParagraphAllEnabled(sdk, targetsOf(html), true);
    const doc = savedDoc(calls);
    expect(hasParagraphAllRow(doc)).toBe(false);
    expect(doc.querySelector('.cards').className).toBe('cards');
  });

  it('marks the section on with the size in its style row once a size is chosen', async () => {
    const html = blockPage();
    const { sdk, calls } = saveOnce(html);
    await expect(setSectionParagraphSize(sdk, targetsOf(html), 'body-m')).resolves.toBe(2);
    const doc = savedDoc(calls);
    expect(styleRow(doc)).toBe('body-m');
    expect(doc.querySelector('.cards').classList.contains('body-m')).toBe(true);
    expect(hasParagraphAllRow(doc)).toBe(false);
    expect(paragraphAllEnabled(sectionOf(doc))).toBe(true);
  });

  it('turns off by removing the size from the style row and the blocks', async () => {
    const html = blockPage('cards body-m', [['style', 'dark, body-m']]);
    const { sdk, calls } = saveOnce(html);
    await setParagraphAllEnabled(sdk, targetsOf(html), false);
    const doc = savedDoc(calls);
    expect(styleRow(doc)).toBe('dark');
    expect(doc.querySelector('.cards').className).toBe('cards');
    expect(paragraphAllEnabled(sectionOf(doc))).toBe(false);
  });

  it('section reset clears the style row size', async () => {
    const html = blockPage('cards body-m', [['style', 'body-m']]);
    const { sdk, calls } = saveOnce(html);
    await clearHeadingSizes(sdk, targetsOf(html));
    const doc = savedDoc(calls);
    expect(doc.querySelector('.section-metadata')).toBeNull();
    expect(paragraphAllEnabled(sectionOf(doc))).toBe(false);
  });

  it('a block-level size alone does not turn the section on', () => {
    const doc = new DOMParser().parseFromString(blockPage('cards body-m'), 'text/html');
    expect(paragraphAllEnabled(sectionOf(doc))).toBe(false);
  });

  it('still reads a legacy paragraph-all row as on', () => {
    const doc = new DOMParser()
      .parseFromString(blockPage('cards body-m', [['paragraph-all', 'true']]), 'text/html');
    expect(paragraphAllEnabled(sectionOf(doc))).toBe(true);
  });
});

describe('in-editor apply to all paragraphs', () => {
  const liveBlock = (cls) => new DOMParser().parseFromString(
    `<main><div><div class="${cls}" data-block-index="12"><div><div>
      <p data-prose-index="14">one</p><p><img src="a.png" data-image-index="20" data-image-version="3"></p>
    </div></div></div></div></main>`,
    'text/html',
  ).querySelector('[data-block-index]');

  it('adds the size, drops other paragraph sizes and editor attributes', () => {
    const html = blockWithParagraphSize(liveBlock('cards p-1-size-body-s h2-size-xl'), 'body-m');
    const block = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
    expect([...block.classList]).toEqual(['cards', 'h2-size-xl', 'body-m']);
    expect(html).not.toMatch(/data-(block|prose|image)-/);
    expect(block.querySelector('img').getAttribute('src')).toBe('a.png');
  });

  it('returns null when the block already has exactly the size', () => {
    expect(blockWithParagraphSize(liveBlock('cards body-m'), 'body-m')).toBeNull();
    expect(blockWithParagraphSize(liveBlock('cards body-m p-2-size-body-s'), 'body-m')).not.toBeNull();
  });
});

describe('block edits in the editor', () => {
  // A live document: one section with default content and a block, plus section metadata.
  const live = () => `<html><head></head><body><main><div>
    <h2 data-prose-index="1">Intro</h2><p data-prose-index="2">lead</p>
    <div class="cards" data-block-index="5"><div><div><h3 data-prose-index="7">Card</h3><p>one</p><p>two</p></div></div></div>
    <div class="section-metadata"><div><div>style</div><div>dark</div></div></div>
  </div></main></body></html>`;
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const targets = (doc, selector) => [...doc.querySelectorAll(selector)].map(headingInfo);
  const blockIn = (doc) => doc.querySelector('[data-block-index]');

  /** Registers an editor that applies edits the way the panel does, recording replacements. */
  function editorWith(doc) {
    const replaced = [];
    setNativeEditor(async (edit) => {
      const change = singleBlockEdit(doc, blockIn(doc), edit);
      if (!change) return null;
      if (change.html) replaced.push(change.html);
      return { value: change.value };
    });
    return replaced;
  }
  afterEach(() => setNativeEditor(null));

  it('applies a block heading size in the editor, with no source read or save', async () => {
    const doc = parse(live());
    const replaced = editorWith(doc);
    const { sdk, calls } = mockDa({ gets: [], puts: [], heads: [] });
    await setHeadingSize(sdk, targets(parse(live()), '.cards h3')[0], 'l');
    expect(calls).toHaveLength(0);
    expect(replaced).toHaveLength(1);
    const block = parse(replaced[0]).body.firstElementChild;
    expect(block.classList.contains('cards')).toBe(true);
    expect(block.className).toMatch(/h3-1-size-l/);
    expect(replaced[0]).not.toMatch(/data-(block|prose)-index/);
    expect(block.textContent).toContain('Card');
  });

  it('applies and resets a block-level paragraph size in the editor', async () => {
    const doc = parse(live());
    const replaced = editorWith(doc);
    const { sdk, calls } = mockDa({ gets: [], puts: [], heads: [] });
    const paragraphs = targets(parse(live()), '.cards p');
    await expect(setHeadingSizes(sdk, paragraphs, 'body-s')).resolves.toBe(2);
    expect(blockIn(doc).classList.contains('body-s')).toBe(true);
    await clearBlockSizes(sdk, paragraphs);
    expect(blockIn(doc).className).toBe('cards');
    expect(replaced).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });

  it('saves default content (section metadata) through the source, as before', async () => {
    const replaced = editorWith(parse(live()));
    const { sdk, calls } = mockDa({
      gets: [() => res(200, { body: live(), etag: '"a"' })],
      puts: [res(201, { etag: '"b"' })],
      heads: [res(200, { etag: '"b"' })],
    });
    await setHeadingSize(sdk, targets(parse(live()), 'main > div > h2')[0], 'xl');
    expect(replaced).toHaveLength(0);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'HEAD']);
    expect(calls[1].html).toMatch(/h2-1-size-xl/);
  });

  it('never offers section-level apply-all to the editor', async () => {
    const offered = vi.fn(async () => null);
    setNativeEditor(offered);
    const { sdk } = mockDa({
      gets: [() => res(200, { body: live(), etag: '"a"' })],
      puts: [res(201)],
      heads: [],
    });
    await setSectionParagraphSize(sdk, targets(parse(live()), 'main p'), 'body-m');
    expect(offered).not.toHaveBeenCalled();
  });

  it('falls back to the source save when the editor cannot take the change', async () => {
    setNativeEditor(async () => null);
    const { sdk, calls } = mockDa({
      gets: [() => res(200, { body: live(), etag: '"a"' })],
      puts: [res(201)],
      heads: [],
    });
    await setHeadingSize(sdk, targets(parse(live()), '.cards h3')[0], 'l');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
  });

  it('does not also save the source when the editor outcome is unknown', async () => {
    setNativeEditor(async () => { throw Object.assign(new Error('unknown'), { uncertain: true }); });
    const { sdk, calls } = mockDa({ gets: [], puts: [], heads: [] });
    await expect(setHeadingSize(sdk, targets(parse(live()), '.cards h3')[0], 'l'))
      .rejects.toMatchObject({ uncertain: true });
    expect(calls).toHaveLength(0);
  });

  it('reports an edit the block already shows as done, with nothing to replace', () => {
    const doc = parse(live().replace('class="cards"', 'class="cards body-s"'));
    const change = singleBlockEdit(doc, blockIn(doc), () => 1);
    expect(change).toEqual({ value: 1, html: null });
  });

  it('rejects edits that change anything outside the block', () => {
    const doc = parse(live());
    const touchMeta = (d) => { d.querySelector('.section-metadata').remove(); return 1; };
    expect(singleBlockEdit(doc, blockIn(doc), touchMeta)).toBeNull();
    expect(singleBlockEdit(doc, blockIn(doc), () => { throw new Error('moved'); })).toBeNull();
    expect(singleBlockEdit(doc, blockIn(doc), () => 0)).toBeNull();
  });
});

describe('manual paragraph sizes', () => {
  const blockIn = (cls) => new DOMParser()
    .parseFromString(`<main><div><div class="${cls}"><div><div><p>x</p></div></div></div></div></main>`, 'text/html')
    .querySelector('main > div > div');

  it('treats complete and half-typed body tokens as the author sizing the block', () => {
    ['cards body-xs', 'cards body', 'cards body-', 'cards p-1-size-body-s'].forEach((cls) => {
      expect(hasParagraphSize(blockIn(cls))).toBe(true);
    });
    expect(hasParagraphSize(blockIn('cards dark'))).toBe(false);
    expect(hasParagraphSize(blockIn('body-m'))).toBe(false);
  });

  it('replaces stray body tokens when a size is applied', () => {
    const html = blockWithParagraphSize(blockIn('cards body body-xs'), 'body-m');
    const block = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
    expect([...block.classList]).toEqual(['cards', 'body-m']);
  });
});
