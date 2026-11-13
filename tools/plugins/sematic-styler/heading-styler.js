import {
  headingKey, parseSizeClass, matchHeadings, KEY_RE, SIZE_PATTERN,
} from '../../../scripts/heading-key.js';

/*
 * Reads and writes heading/paragraph sizes in the DA page source.
 *
 * A size is stored either as a class on the element's block (`h2-1-size-xl`, tag-wide
 * `h2-size-xl` / `body-m`) or, for default content, as a token in the section metadata
 * `style` row. Legacy per-heading metadata rows (keyed by `headingKey`) are still read.
 */

const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';
const BODY = 'body-(?:l|m|s|xs|xxs)';
const BODY_CLASS_RE = new RegExp(`^${BODY}$`);
const PARAGRAPH_ALL_KEY = 'paragraph-all';
// What "apply to all paragraphs" writes: a bare body size or a tag-wide `p-size-body-*`.
const PARAGRAPH_ALL_STYLE_RE = new RegExp(`^(?:p-size-)?${BODY}$`);
// Any size class, positional or tag-wide, that the editor may fold onto a live section.
const SIZE_CLASS_RE = new RegExp(`^(?:(?:h[1-6]|p)(?:-[0-9]+)?-size-(?:${SIZE_PATTERN})|${BODY})$`);

const regexCache = new Map();
const regex = (source) => {
  if (!regexCache.has(source)) regexCache.set(source, new RegExp(source));
  return regexCache.get(source);
};

const tagName = (el) => el.tagName.toLowerCase();
const firstOf = (items, fn) => items.map(fn).find(Boolean);
const removeClasses = (el, test) => [...el.classList].filter(test)
  .forEach((name) => el.classList.remove(name));

/** `p` sizes from the body scale are written bare (`body-m`); others as `h2-size-xl`. */
const tagWideClass = (tag, size) => (tag === 'p' && BODY_CLASS_RE.test(size)
  ? size : `${tag}-size-${size}`);
const tagWideSize = (tag, token) => (tag === 'p' && BODY_CLASS_RE.test(token)
  ? token : regex(`^${tag}-size-(${SIZE_PATTERN})$`).exec(token)?.[1]);
const positionSize = (key, token) => regex(`^${key}-size-(${SIZE_PATTERN})$`).exec(token)?.[1];
// Tag-wide and positional styles of a tag, so applying to all replaces any per-element size.
const tagStyleRe = (tag) => regex(`^(?:${tag}(?:-[0-9]+)?-(?:size|as)-${tag === 'p' ? `|${BODY}$` : ''})`);
const styleFamily = (token) => (token.startsWith('body-') || token.startsWith('p-')
  ? 'p' : token.match(/^h[1-6]/)?.[0]);

/* ---------------------------------------------------------------- memo */

// Per-document memo for read-only lookups. Only documents passed to `cacheDoc` are memoized, so
// the documents `editDoc` parses and mutates always compute fresh.
const docCaches = new WeakMap();

/** Marks a parsed document as read-only so per-node lookups on it are memoized. */
export function cacheDoc(doc) {
  if (!docCaches.has(doc)) docCaches.set(doc, new Map());
  return doc;
}

/** Drops memoized lookups after a cached document is mutated. */
function resetDocCache(doc) {
  if (docCaches.has(doc)) docCaches.set(doc, new Map());
}

/** Memoizes `compute()` per node and name when the node's document is cached. */
export function memo(node, name, compute) {
  const cache = docCaches.get(node.ownerDocument || node);
  if (!cache) return compute();
  if (!cache.has(name)) cache.set(name, new WeakMap());
  const bucket = cache.get(name);
  if (!bucket.has(node)) bucket.set(node, compute());
  return bucket.get(node);
}

/* ------------------------------------------------------------ structure */

const sectionsOf = (doc) => memo(doc, 'sections', () => [...doc.querySelectorAll('main > div')]);

/** The block an element sits in, or null for default content. */
function blockOf(el) {
  const block = el.closest('main > div > div[class]');
  const isWrapper = block && [...block.classList].some((name) => name.endsWith('-wrapper'));
  return isWrapper ? null : block;
}

const blocksOf = (items) => new Set(items.map(({ el }) => blockOf(el)).filter(Boolean));
const defaultSectionsOf = (items) => new Set(items
  .filter(({ el }) => !blockOf(el)).map(({ section }) => section));

/** `h2-1`: the element's position among same-tag elements in its block. */
const positionKey = (el, block) => `${tagName(el)}-${[...block.querySelectorAll(el.tagName)].indexOf(el) + 1}`;

/** `h2-1`: the element's position among same-tag default-content elements in its section. */
function defaultPositionKey(el, section) {
  const peers = [...section.querySelectorAll(el.tagName)]
    .filter((peer) => !blockOf(peer) && !peer.closest('.section-metadata'));
  return `${tagName(el)}-${peers.indexOf(el) + 1}`;
}

/* ----------------------------------------------------- section metadata */

const rowKey = (row) => row.children[0]?.textContent.trim().toLowerCase();

function metaOf(section, create = false) {
  let meta = section.querySelector(':scope > .section-metadata');
  if (!meta && create) {
    meta = section.ownerDocument.createElement('div');
    meta.className = 'section-metadata';
    section.append(meta);
  }
  return meta;
}

const findRow = (section, key) => [...(metaOf(section)?.children || [])]
  .find((row) => rowKey(row) === key);

function setRow(section, key, value) {
  const existing = findRow(section, key);
  if (existing) {
    existing.children[1].textContent = value;
    return;
  }
  const row = section.ownerDocument.createElement('div');
  [key, value].forEach((text) => {
    const cell = section.ownerDocument.createElement('div');
    cell.textContent = text;
    row.append(cell);
  });
  metaOf(section, true).append(row);
}

function removeEmptyMetadata(section) {
  const meta = metaOf(section);
  if (meta && !meta.children.length) meta.remove();
}

/** Tokens of the section's `style` row. */
const styleTokens = (section) => findRow(section, 'style')?.children[1]?.textContent
  .split(/[\s,]+/).filter(Boolean) || [];

/** Writes the `style` row, removing it (and empty metadata) when there are no tokens left. */
function setStyleTokens(section, tokens) {
  if (tokens.length) {
    setRow(section, 'style', tokens.join(', '));
  } else {
    findRow(section, 'style')?.remove();
    removeEmptyMetadata(section);
  }
}

/** Legacy per-heading rows, keyed by `headingKey`. */
const entriesOf = (section) => [...(metaOf(section)?.children || [])]
  .filter((row) => KEY_RE.test(rowKey(row)))
  .map((row) => ({ key: rowKey(row), value: row.children[1]?.textContent.trim() || '', row }));

// Memoized per section on cached documents; `editDoc` documents re-match after every removal.
const matchOf = (section, el) => memo(section, 'match', () => matchHeadings(section, entriesOf(section)))
  .matched.find((m) => m.el === el);

const removeLegacyRows = (found) => found
  .forEach(({ section, el }) => matchOf(section, el)?.entry.row.remove());

/* -------------------------------------------------------------- reading */

/** Size from class tokens: the element's positional size wins over the tag-wide one. */
function sizeFrom(tokens, tag, key) {
  const size = firstOf(tokens, (token) => positionSize(key, token))
    || firstOf(tokens, (token) => tagWideSize(tag, token));
  return size ? parseSizeClass(`${tag}-size-${size}`) : null;
}

/** Section key and block position for a heading or paragraph in the source document. */
export function headingInfo(el) {
  return memo(el, 'info', () => {
    const section = el.closest('main > div');
    const block = blockOf(el);
    return {
      el,
      section,
      sectionIndex: sectionsOf(el.ownerDocument).indexOf(section) + 1,
      key: memo(el, 'key', () => headingKey(el, section)),
      block,
      blockName: (block && [...block.classList].find((name) => name !== 'block')) || '',
      position: block ? positionKey(el, block) : '',
      defaultPosition: block ? '' : defaultPositionKey(el, section),
    };
  });
}

/** Current heading/paragraph style; empty strings when unstyled. */
export function currentStyle(section, el) {
  return memo(el, 'style', () => {
    const block = blockOf(el);
    const tag = tagName(el);
    return (block && sizeFrom([...block.classList], tag, positionKey(el, block)))
      || sizeFrom(styleTokens(section), tag, defaultPositionKey(el, section))
      || parseSizeClass(matchOf(section, el)?.entry.value);
  });
}

export function paragraphAllEnabled(section) {
  return findRow(section, PARAGRAPH_ALL_KEY)?.children[1]?.textContent.trim().toLowerCase() === 'true';
}

/** Returns the shared tag-wide paragraph size only when it is applied to every paragraph. */
export function paragraphAllSize(paragraphs, pendingSizes) {
  if (!paragraphs.length) return '';
  const pendingReset = ({ sectionIndex, key }) => {
    const id = `${sectionIndex}:${key}`;
    return pendingSizes.has(id) && !pendingSizes.get(id);
  };
  if (pendingSizes && paragraphs.some(pendingReset)) return '';
  const sizes = paragraphs.map(({ section, el }) => {
    const block = blockOf(el);
    const tokens = block ? [...block.classList] : styleTokens(section);
    return firstOf(tokens, (token) => tagWideSize('p', token)) || '';
  });
  return sizes[0] && sizes.every((size) => size === sizes[0]) ? sizes[0] : '';
}

/* -------------------------------------------------------------- writing */

/** Use live section classes when the editor folds section metadata into the section element. */
export function syncLiveSectionStyles(section, liveSection) {
  const liveStyles = [...liveSection.classList].filter((name) => SIZE_CLASS_RE.test(name));
  if (!liveStyles.length) return;
  const liveFamilies = new Set(liveStyles.map(styleFamily));
  const kept = styleTokens(section).filter((token) => !liveFamilies.has(styleFamily(token)));
  setStyleTokens(section, [...new Set([...kept, ...liveStyles])]);
}

const isParagraphAll = (name) => PARAGRAPH_ALL_STYLE_RE.test(name);

export function clearParagraphAllStyles(paragraphs) {
  const section = paragraphs[0]?.section;
  if (!section) return;
  findRow(section, PARAGRAPH_ALL_KEY)?.remove();
  blocksOf(paragraphs).forEach((block) => removeClasses(block, isParagraphAll));
  if (paragraphs.some(({ el }) => !blockOf(el))) {
    setStyleTokens(section, styleTokens(section).filter((token) => !isParagraphAll(token)));
  }
  removeEmptyMetadata(section);
  resetDocCache(section.ownerDocument);
}

/** Removes a block-level "apply to all paragraphs" (the paragraphs' blocks only), in place. */
export function clearBlockParagraphAllStyles(paragraphs) {
  blocksOf(paragraphs).forEach((block) => removeClasses(block, isParagraphAll));
  if (paragraphs[0]) resetDocCache(paragraphs[0].el.ownerDocument);
}

/** The targets' elements in `doc`, matched by section index and heading key. */
function resolveTargets(doc, targets) {
  return targets.map(({ sectionIndex, key, defaultEditable }) => {
    const section = sectionsOf(doc)[sectionIndex - 1];
    const el = section && [...section.querySelectorAll(HEADINGS)]
      .find((h) => headingKey(h, section) === key);
    if (el && !blockOf(el) && defaultEditable === false) return null;
    return el && { section, el };
  }).filter(Boolean);
}

/** Sets (or clears, with '') each target's own positional size. */
function applySizes(doc, targets, size) {
  const found = resolveTargets(doc, targets);
  found.forEach(({ section, el }) => {
    matchOf(section, el)?.entry.row.remove();
    const block = blockOf(el);
    if (block) {
      const key = positionKey(el, block);
      removeClasses(block, (name) => name.startsWith(`${key}-size-`) || name.startsWith(`${key}-as-`));
      if (size) block.classList.add(`${key}-size-${size}`);
      removeEmptyMetadata(section);
    } else {
      const key = defaultPositionKey(el, section);
      const tokens = styleTokens(section).filter((token) => !token.startsWith(`${key}-size-`));
      setStyleTokens(section, size ? [...tokens, `${key}-size-${size}`] : tokens);
    }
  });
  return found.length;
}

/** Replaces the targets' per-element sizes with one tag-wide size on their blocks/sections. */
function applyTagSize(doc, targets, size) {
  const found = resolveTargets(doc, targets);
  removeLegacyRows(found);
  const blocks = blocksOf(found);
  const sections = defaultSectionsOf(found);
  new Set(found.map(({ el }) => tagName(el))).forEach((tag) => {
    const isTagStyle = (name) => tagStyleRe(tag).test(name);
    const style = tagWideClass(tag, size);
    blocks.forEach((block) => {
      removeClasses(block, isTagStyle);
      block.classList.add(style);
    });
    sections.forEach((section) => {
      setStyleTokens(section, [...styleTokens(section).filter((t) => !isTagStyle(t)), style]);
    });
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

/**
 * Removes every tag-wide and positional size of the targets' tags, and (unless `sectionAll` is
 * false) the section-level apply-all.
 */
function clearSizes(doc, targets, { sectionAll = true } = {}) {
  const found = resolveTargets(doc, targets);
  removeLegacyRows(found);
  if (sectionAll) found.forEach(({ section }) => findRow(section, PARAGRAPH_ALL_KEY)?.remove());
  const patterns = [...new Set(found.map(({ el }) => tagName(el)))].map(tagStyleRe);
  const isTagStyle = (name) => patterns.some((re) => re.test(name));
  blocksOf(found).forEach((block) => removeClasses(block, isTagStyle));
  defaultSectionsOf(found).forEach((section) => {
    setStyleTokens(section, styleTokens(section).filter((token) => !isTagStyle(token)));
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

/* -------------------------------------------------------------- saving */

export function sourceUrl({ org, repo, path }) {
  const p = (path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/index';
  return `https://admin.da.live/source/${org}/${repo}${p}.html`;
}

let writes = Promise.resolve();
let batch = null;

/**
 * Applies `edit(doc)` to a fresh read of the page source and saves it. Edits queued while a save
 * is in flight share the next read + save. Resolves with the edit's return value; an edit that
 * returns `false` (and no other edit in its batch) skips the save.
 */
function editDoc({ actions, context }, edit) {
  if (!batch) {
    const edits = [];
    const run = writes.then(async () => {
      // Edits from here on wait for the next batch, since this one has read the source.
      batch = null;
      const resp = await actions.daFetch(sourceUrl(context), { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
      const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
      const results = edits.map((fn) => {
        try { return { value: fn(doc) }; } catch (error) { return { error }; }
      });
      if (results.every(({ error, value }) => error || value === false)) return results;
      const body = new FormData();
      body.append('data', new Blob([doc.documentElement.outerHTML], { type: 'text/html' }));
      const saved = await actions.daFetch(sourceUrl(context), { method: 'PUT', body });
      if (!saved.ok) throw new Error(`Save failed (${saved.status})`);
      return results;
    });
    batch = { edits, run };
    writes = run.catch(() => {});
  }
  const index = batch.edits.push(edit) - 1;
  return batch.run.then((results) => {
    if (results[index].error) throw results[index].error;
    return results[index].value;
  });
}

/** Saves `count(doc)`, failing with `message` when it touched nothing. */
const editCount = (sdk, count, message) => editDoc(sdk, (doc) => {
  const n = count(doc);
  if (!n) throw new Error(message);
  return n;
});

export function setHeadingSize(sdk, target, size) {
  return editCount(sdk, (doc) => applySizes(doc, [target], size), 'Element moved since selection. Reselect it.')
    .then(() => undefined);
}

export function setHeadingSizes(sdk, targets, size) {
  return editCount(sdk, (doc) => applyTagSize(doc, targets, size), 'Elements moved since selection. Reselect them.');
}

/** Removes every applied size from the targets' blocks and default content in a single save. */
export function clearHeadingSizes(sdk, targets) {
  return editCount(sdk, (doc) => clearSizes(doc, targets), 'Elements moved since selection. Reselect them.');
}

/** Removes every applied size from one block's targets, leaving the section's settings alone. */
export function clearBlockSizes(sdk, targets) {
  return editCount(sdk, (doc) => clearSizes(doc, targets, { sectionAll: false }), 'Block moved since selection. Refresh the plugin.');
}

/**
 * Turns the section-level "apply to all paragraphs" on (clearing per-paragraph sizes) or off.
 * The `paragraph-all` row marks it on even when every paragraph is in a block, so it can't be
 * confused with a block-level apply-all.
 */
export function setParagraphAllEnabled(sdk, paragraphs, enabled) {
  return editDoc(sdk, (doc) => {
    const found = resolveTargets(doc, paragraphs);
    if (!found.length) throw new Error('Section moved since selection. Refresh the plugin.');
    if (!enabled) return clearParagraphAllStyles(found);
    clearSizes(doc, paragraphs);
    return setRow(found[0].section, PARAGRAPH_ALL_KEY, 'true');
  });
}

/** Turns a block-level "apply to all paragraphs" off: removes that block's tag-wide P size. */
export function clearBlockParagraphAll(sdk, paragraphs) {
  return editCount(sdk, (doc) => {
    const found = resolveTargets(doc, paragraphs);
    clearBlockParagraphAllStyles(found);
    return found.length;
  }, 'Block moved since selection. Refresh the plugin.');
}
