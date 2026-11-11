import {
  headingKey, parseHeadingKey, parseSizeClass, matchHeadings, KEY_RE, SIZE_PATTERN,
} from '../../../scripts/heading-key.js';

const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';
const POSITIONAL_CLASS_RE = new RegExp(
  `^(h[1-6]|p)-([0-9]+)-(?:size-(?:${SIZE_PATTERN})|as-(?:h[1-6]|p))$`,
);
const BODY_CLASS_RE = /^body-(?:l|m|s|xs|xxs)$/;
const PARAGRAPH_ALL_KEY = 'paragraph-all';
const PARAGRAPH_GLOBAL_STYLE_RE = /^(?:body-(?:l|m|s|xs|xxs)|p-size-body-(?:l|m|s|xs|xxs))$/;
const SIZE_CLASS_RE = new RegExp(
  `^(?:(?:h[1-6]|p)(?:-[0-9]+)?-size-(?:${SIZE_PATTERN})|body-(?:l|m|s|xs|xxs))$`,
);
const styleFamily = (token) => (token.startsWith('body-') || token.startsWith('p-')
  ? 'p' : token.match(/^h[1-6]/)?.[0]);
const tagWideClass = (tag, size) => (tag === 'p' && BODY_CLASS_RE.test(size)
  ? size : `${tag}-size-${size}`);
const tagWideSize = (tag, token) => (tag === 'p' && BODY_CLASS_RE.test(token) ? token
  : token.match(new RegExp(`^${tag}-size-(${SIZE_PATTERN})$`))?.[1]);
const rowKey = (row) => row.children[0]?.textContent.trim().toLowerCase();
const blockOf = (el) => {
  const block = el.closest('main > div > div[class]');
  if (block && [...block.classList].some((name) => (
    name === 'default-content-wrapper' || name.endsWith('-wrapper')
  ))) return null;
  return block;
};
const tagName = (el) => el.tagName.toLowerCase();

function positionKey(el, block) {
  return `${tagName(el)}-${[...block.querySelectorAll(el.tagName)].indexOf(el) + 1}`;
}

function defaultElements(section, tag) {
  return [...section.querySelectorAll(tag)]
    .filter((el) => !blockOf(el) && !el.closest('.section-metadata'));
}

function defaultPositionKey(el, section) {
  return `${tagName(el)}-${defaultElements(section, el.tagName).indexOf(el) + 1}`;
}

function blockStyle(block, el) {
  if (!block) return null;
  const key = positionKey(el, block);
  const tag = tagName(el);
  const specificPattern = new RegExp(`^${key}-size-(${SIZE_PATTERN})$`);
  const names = [...block.classList];
  const specific = names.map((name) => name.match(specificPattern)).find(Boolean)?.[1];
  const all = names.map((name) => tagWideSize(tag, name)).find(Boolean);
  const size = specific || all;
  return size ? parseSizeClass(`${tag}-size-${size}`) : null;
}

function setBlockStyle(block, el, size) {
  const key = positionKey(el, block);
  [...block.classList]
    .filter((name) => name.startsWith(`${key}-size-`) || name.startsWith(`${key}-as-`))
    .forEach((name) => block.classList.remove(name));
  if (!size) return;
  block.classList.add(`${key}-size-${size}`);
}

function sourceUrl({ org, repo, path }) {
  const p = (path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/index';
  return `https://admin.da.live/source/${org}/${repo}${p}.html`;
}

let writes = Promise.resolve();
let batch = null;

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
  .find((r) => rowKey(r) === key);

export function paragraphAllEnabled(section) {
  return findRow(section, PARAGRAPH_ALL_KEY)?.children[1]?.textContent.trim().toLowerCase() === 'true';
}

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

export function clearParagraphAllStyles(paragraphs) {
  const section = paragraphs[0]?.section;
  if (!section) return;
  findRow(section, PARAGRAPH_ALL_KEY)?.remove();
  new Set(paragraphs.map(({ el }) => blockOf(el)).filter(Boolean)).forEach((block) => {
    [...block.classList].filter((name) => PARAGRAPH_GLOBAL_STYLE_RE.test(name))
      .forEach((name) => block.classList.remove(name));
  });
  if (paragraphs.some(({ el }) => !blockOf(el))) {
    const styleRow = findRow(section, 'style');
    const valueCell = styleRow?.children[1];
    const tokens = valueCell?.textContent.split(/[\s,]+/).filter(Boolean) || [];
    const next = tokens.filter((token) => !PARAGRAPH_GLOBAL_STYLE_RE.test(token));
    if (next.length) setRow(section, 'style', next.join(', '));
    else styleRow?.remove();
  }
  removeEmptyMetadata(section);
}

/** Use live section classes when the editor folds section metadata into the section element. */
export function syncLiveSectionStyles(section, liveSection) {
  const liveStyles = [...liveSection.classList].filter((name) => SIZE_CLASS_RE.test(name));
  if (!liveStyles.length) return;
  const liveFamilies = new Set(liveStyles.map(styleFamily));
  const styleRow = findRow(section, 'style');
  const tokens = styleRow?.children[1]?.textContent.split(/[\s,]+/).filter(Boolean) || [];
  const next = [
    ...tokens.filter((token) => !liveFamilies.has(styleFamily(token))),
    ...liveStyles,
  ];

  if (next.length) setRow(section, 'style', [...new Set(next)].join(', '));
}

function defaultStyle(section, el) {
  const styleRow = findRow(section, 'style');
  const tokens = styleRow?.children[1]?.textContent.split(/[\s,]+/) || [];
  const tag = tagName(el);
  const key = defaultPositionKey(el, section);
  const specific = tokens.map((token) => (
    token.match(new RegExp(`^${key}-size-(${SIZE_PATTERN})$`))
  )).find(Boolean)?.[1];
  const general = tokens.map((token) => tagWideSize(tag, token)).find(Boolean);
  if (specific) return parseSizeClass(`${tag}-size-${specific}`);
  return general ? parseSizeClass(`${tag}-size-${general}`) : null;
}

function setDefaultStyle(section, el, size) {
  const key = defaultPositionKey(el, section);
  const styleRow = findRow(section, 'style');
  const valueCell = styleRow?.children[1];
  const tokens = valueCell?.textContent.split(/[\s,]+/).filter(Boolean) || [];
  const next = tokens.filter((token) => !token.startsWith(`${key}-size-`));
  if (size) next.push(`${key}-size-${size}`);

  if (next.length) {
    setRow(section, 'style', next.join(', '));
  } else {
    styleRow?.remove();
    removeEmptyMetadata(section);
  }
}

const sectionsOf = (doc) => [...doc.querySelectorAll('main > div')];
const entriesOf = (section) => [...(metaOf(section)?.children || [])]
  .filter((r) => KEY_RE.test(rowKey(r)))
  .map((row) => ({ key: rowKey(row), value: row.children[1]?.textContent.trim() || '', row }));

function positionalIndexBefore(el, tag, elements) {
  const index = elements.indexOf(el);
  return elements.slice(0, index).filter((element) => tagName(element) === tag).length + 1;
}

function prunePositionalClasses(container, elements) {
  const counts = new Map();
  elements.forEach((el) => counts.set(tagName(el), (counts.get(tagName(el)) || 0) + 1));
  const removed = [];
  [...container.classList].forEach((name) => {
    const match = name.match(POSITIONAL_CLASS_RE);
    if (match && Number(match[2]) > (counts.get(match[1]) || 0)) {
      container.classList.remove(name);
      removed.push(name);
    }
  });
  return removed;
}

function pruneStyleRow(section) {
  const styleRow = findRow(section, 'style');
  const valueCell = styleRow?.children[1];
  if (!valueCell) return [];
  const tokens = valueCell.textContent.split(/[\s,]+/).filter(Boolean);
  const elements = HEADINGS.split(',').flatMap((tag) => defaultElements(section, tag));
  const counts = new Map();
  elements.forEach((el) => counts.set(tagName(el), (counts.get(tagName(el)) || 0) + 1));
  const removed = [];
  const kept = tokens.filter((token) => {
    const match = token.match(POSITIONAL_CLASS_RE);
    const stale = match && Number(match[2]) > (counts.get(match[1]) || 0);
    if (stale) removed.push(token);
    return !stale;
  });
  if (removed.length) {
    if (kept.length) valueCell.textContent = kept.join(', ');
    else styleRow.remove();
    removeEmptyMetadata(section);
  }
  return removed;
}

function pruneSectionStyles(section) {
  const removed = [];
  const sectionElements = [...section.querySelectorAll(HEADINGS)]
    .filter((el) => !el.closest('.section-metadata'));
  removed.push(...prunePositionalClasses(section, sectionElements));
  section.querySelectorAll(':scope > div[class]').forEach((block) => {
    removed.push(...prunePositionalClasses(block, [...block.querySelectorAll(HEADINGS)]));
  });
  removed.push(...pruneStyleRow(section));
  return removed;
}

function removePositionStyle(container, tag, index) {
  const prefix = `${tag}-${index}-`;
  const removed = [...container.classList].filter((name) => name.startsWith(prefix));
  removed.forEach((name) => container.classList.remove(name));
  return removed;
}

function removeRetaggedStyles(section) {
  const entries = entriesOf(section);
  const headings = [...section.querySelectorAll(HEADINGS)];
  const current = headings.map((el) => ({ el, key: parseHeadingKey(headingKey(el, section)) }));
  const oldKeys = entries.map(({ key }) => parseHeadingKey(key));
  const removed = [];

  current.forEach(({ el, key }) => {
    const sameText = (parts) => parts && !parts.legacy && parts.text === key.text;
    const oldLevels = oldKeys.filter((parts) => parts && !parts.legacy
      && parts.level !== key.level && sameText(parts));
    const newMatches = current.filter((candidate) => candidate.key.level === key.level
      && sameText(candidate.key));
    if (oldLevels.length !== 1 || newMatches.length !== 1) return;

    const oldTag = oldLevels[0].level;
    const sectionElements = [...section.querySelectorAll(HEADINGS)]
      .filter((heading) => !heading.closest('.section-metadata'));
    const sectionIndex = positionalIndexBefore(el, oldTag, sectionElements);
    removed.push(...removePositionStyle(section, oldTag, sectionIndex));

    const block = blockOf(el);
    if (block) {
      const blockElements = [...block.querySelectorAll(HEADINGS)];
      const blockIndex = positionalIndexBefore(el, oldTag, blockElements);
      removed.push(...removePositionStyle(block, oldTag, blockIndex));
    } else {
      const defaultHeadings = HEADINGS.split(',').flatMap((tag) => defaultElements(section, tag));
      const defaultIndex = positionalIndexBefore(el, oldTag, defaultHeadings);
      const styleRow = findRow(section, 'style');
      const valueCell = styleRow?.children[1];
      if (valueCell) {
        const tokens = valueCell.textContent.split(/[\s,]+/).filter(Boolean);
        const prefix = `${oldTag}-${defaultIndex}-`;
        const kept = tokens.filter((token) => {
          const match = token.startsWith(prefix);
          if (match) removed.push(token);
          return !match;
        });
        if (kept.length !== tokens.length) {
          if (kept.length) valueCell.textContent = kept.join(', ');
          else styleRow.remove();
          removeEmptyMetadata(section);
        }
      }
    }
  });
  return removed;
}

const matchOf = (section, el) => matchHeadings(section, entriesOf(section))
  .matched.find((m) => m.el === el);

/** Section key and block position for a heading or paragraph in the source document. */
export function headingInfo(el) {
  const section = el.closest('main > div');
  const sectionIndex = sectionsOf(el.ownerDocument).indexOf(section) + 1;
  const block = blockOf(el);
  return {
    el,
    section,
    sectionIndex,
    key: headingKey(el, section),
    block,
    blockName: (block && [...block.classList].find((name) => name !== 'block')) || '',
    position: block ? positionKey(el, block) : '',
    defaultPosition: block ? '' : defaultPositionKey(el, section),
  };
}

/** Current heading/paragraph style; empty strings when unstyled. */
export function currentStyle(section, el) {
  return blockStyle(blockOf(el), el)
    || defaultStyle(section, el)
    || parseSizeClass(matchOf(section, el)?.entry.value);
}

/** Returns the shared tag-wide paragraph size only when it is applied to every paragraph. */
export function paragraphAllSize(paragraphs, pendingSizes) {
  if (!paragraphs.length) return '';
  if (pendingSizes && paragraphs.some(({ sectionIndex, key }) => (
    pendingSizes.has(`${sectionIndex}:${key}`)
      && !pendingSizes.get(`${sectionIndex}:${key}`)
  ))) return '';
  const sizes = paragraphs.map(({ section, el }) => {
    const block = blockOf(el);
    if (block) return [...block.classList].map((name) => tagWideSize('p', name)).find(Boolean) || '';
    const tokens = findRow(section, 'style')?.children[1]?.textContent.split(/[\s,]+/) || [];
    return tokens.map((token) => tagWideSize('p', token)).find(Boolean) || '';
  });
  return sizes[0] && sizes.every((size) => size === sizes[0]) ? sizes[0] : '';
}

export function setParagraphAllEnabled(sdk, paragraphs, enabled) {
  return editDoc(sdk, (doc) => {
    // eslint-disable-next-line no-use-before-define
    const found = resolveTargets(doc, paragraphs);
    if (!found.length) throw new Error('Section moved since selection. Refresh the plugin.');
    if (!enabled) return clearParagraphAllStyles(found);
    // eslint-disable-next-line no-use-before-define
    clearSizes(doc, paragraphs);
    if (found.every(({ el }) => blockOf(el))) return undefined;
    return setRow(found[0].section, PARAGRAPH_ALL_KEY, 'true');
  });
}

function resolveTargets(doc, targets) {
  return targets.map(({ sectionIndex, key, defaultEditable }) => {
    const section = sectionsOf(doc)[sectionIndex - 1];
    const el = section && [...section.querySelectorAll(HEADINGS)]
      .find((h) => headingKey(h, section) === key);
    if (el && !blockOf(el) && defaultEditable === false) return null;
    return el && { section, el };
  }).filter(Boolean);
}

function applySizes(doc, targets, size) {
  const found = resolveTargets(doc, targets);
  found.forEach(({ section, el }) => {
    const block = blockOf(el);
    matchOf(section, el)?.entry.row.remove();
    if (block) {
      setBlockStyle(block, el, size);
      removeEmptyMetadata(section);
    } else {
      setDefaultStyle(section, el, size);
    }
  });
  return found.length;
}

// Tag-wide and positional styles, so applying to all replaces any per-element size.
const tagStyleRe = (tag) => (tag === 'p' ? /^(?:p(?:-[0-9]+)?-(?:size|as)-|body-(?:l|m|s|xs|xxs)$)/ : new RegExp(
  `^${tag}(?:-[0-9]+)?-(?:size|as)-`,
));

function applyTagSize(doc, targets, size) {
  const found = resolveTargets(doc, targets);
  found.forEach(({ section, el }) => matchOf(section, el)?.entry.row.remove());
  const blocks = new Set(found.map(({ el }) => blockOf(el)).filter(Boolean));
  const sections = new Set(found.filter(({ el }) => !blockOf(el)).map(({ section }) => section));
  const tags = new Set(found.map(({ el }) => tagName(el)));
  tags.forEach((tag) => {
    const re = tagStyleRe(tag);
    blocks.forEach((block) => {
      [...block.classList].filter((name) => re.test(name))
        .forEach((name) => block.classList.remove(name));
      block.classList.add(tagWideClass(tag, size));
    });
    sections.forEach((section) => {
      const tokens = findRow(section, 'style')?.children[1]?.textContent
        .split(/[\s,]+/).filter(Boolean) || [];
      const next = [...tokens.filter((token) => !re.test(token)), tagWideClass(tag, size)];
      setRow(section, 'style', next.join(', '));
    });
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

function clearSizes(doc, targets) {
  const found = resolveTargets(doc, targets);
  found.forEach(({ section, el }) => matchOf(section, el)?.entry.row.remove());
  found.forEach(({ section }) => findRow(section, PARAGRAPH_ALL_KEY)?.remove());
  const tags = new Set(found.map(({ el }) => tagName(el)));
  const matchesTagStyle = (name) => [...tags].some((tag) => tagStyleRe(tag).test(name));
  new Set(found.map(({ el }) => blockOf(el)).filter(Boolean)).forEach((block) => {
    [...block.classList].filter(matchesTagStyle)
      .forEach((name) => block.classList.remove(name));
  });
  const sections = new Set(found.filter(({ el }) => !blockOf(el)).map(({ section }) => section));
  sections.forEach((section) => {
    const styleRow = findRow(section, 'style');
    const tokens = styleRow?.children[1]?.textContent.split(/[\s,]+/).filter(Boolean) || [];
    const next = tokens.filter((token) => !matchesTagStyle(token));
    if (next.length) setRow(section, 'style', next.join(', '));
    else styleRow?.remove();
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

/** Re-reads the source before writing so edits made since the selection aren't overwritten. */
export function setHeadingSize(sdk, target, size) {
  return editDoc(sdk, (doc) => {
    if (!applySizes(doc, [target], size)) {
      throw new Error('Element moved since selection. Reselect it.');
    }
  });
}

export function setHeadingSizes(sdk, targets, size) {
  return editDoc(sdk, (doc) => {
    const count = applyTagSize(doc, targets, size);
    if (!count) throw new Error('Elements moved since selection. Reselect them.');
    return count;
  });
}

/** Removes every applied size from the targets' blocks and default content in a single save. */
export function clearHeadingSizes(sdk, targets) {
  return editDoc(sdk, (doc) => {
    const count = clearSizes(doc, targets);
    if (!count) throw new Error('Elements moved since selection. Reselect them.');
    return count;
  });
}

/** Re-keys edited or moved headings, saves if changed, returns orphaned entries. */
export async function repairAll(sdk) {
  const total = { rekeyed: [], orphaned: [], cleaned: [] };
  await editDoc(sdk, (doc) => {
    sectionsOf(doc).forEach((section, i) => {
      total.cleaned.push(...removeRetaggedStyles(section)
        .map((key) => ({ sectionIndex: i + 1, key })));
      total.cleaned.push(...pruneSectionStyles(section)
        .map((key) => ({ sectionIndex: i + 1, key })));
      const { matched, orphans } = matchHeadings(section, entriesOf(section));
      matched.filter((m) => m.entry.key !== m.key).forEach((m) => {
        m.entry.row.children[0].textContent = m.key;
        total.rekeyed.push({ from: m.entry.key, to: m.key });
      });
      total.orphaned.push(...orphans.map((o) => ({ sectionIndex: i + 1, key: o.key })));
    });
    return Boolean(total.rekeyed.length || total.cleaned.length);
  });
  return total;
}

export function removeOrphan(sdk, { sectionIndex, key }) {
  return editDoc(sdk, (doc) => {
    findRow(sectionsOf(doc)[sectionIndex - 1], key)?.remove();
  });
}
