import {
  headingKey, parseSizeClass, matchHeadings, KEY_RE,
} from '../../scripts/heading-key.js';

const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';
const POSITIONAL_CLASS_RE = /^(h[1-6]|p)-(\d+)-(?:size-(?:xxl|xl|l|m|s|xs)|as-(?:h[1-6]|p))$/;
const rowKey = (row) => row.children[0]?.textContent.trim().toLowerCase();
const blockOf = (el) => el.closest('main > div > div[class]');
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
  const specificPattern = new RegExp(`^${key}-size-(xxl|xl|l|m|s|xs)$`);
  const allPattern = new RegExp(`^${tag}-size-(xxl|xl|l|m|s|xs)$`);
  const names = [...block.classList];
  const specific = names.map((name) => name.match(specificPattern)).find(Boolean)?.[1];
  const all = names.map((name) => name.match(allPattern)).find(Boolean)?.[1];
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

async function loadDoc({ actions, context }) {
  const resp = await actions.daFetch(sourceUrl(context));
  if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
  return new DOMParser().parseFromString(await resp.text(), 'text/html');
}

async function saveDoc({ actions, context }, doc) {
  const body = new FormData();
  body.append('data', new Blob([doc.documentElement.outerHTML], { type: 'text/html' }));
  const resp = await actions.daFetch(sourceUrl(context), { method: 'PUT', body });
  if (!resp.ok) throw new Error(`Save failed (${resp.status})`);
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

function defaultStyle(section, el) {
  const styleRow = findRow(section, 'style');
  const tokens = styleRow?.children[1]?.textContent.split(/[\s,]+/) || [];
  const tag = tagName(el);
  const key = defaultPositionKey(el, section);
  const specific = tokens.find((token) => (
    new RegExp(`^${key}-size-(xxl|xl|l|m|s|xs)$`).test(token)
  ));
  const general = tokens.find((token) => (
    new RegExp(`^${tag}-size-(xxl|xl|l|m|s|xs)$`).test(token)
  ));
  const className = specific || general;
  return className ? parseSizeClass(className) : null;
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
  const current = headings.map((el) => ({ el, key: headingKey(el, section).split('-') }));
  const oldKeys = entries.map(({ key }) => key.split('-'));
  const removed = [];

  current.forEach(({ el, key }) => {
    const sameText = (parts) => parts[2] === key[2];
    const oldLevels = oldKeys.filter((parts) => parts[0] !== key[0] && sameText(parts));
    const newMatches = current.filter((candidate) => candidate.key[0] === key[0]
      && sameText(candidate.key));
    if (oldLevels.length !== 1 || newMatches.length !== 1) return;

    const oldTag = oldLevels[0][0];
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

/** Re-reads the source before writing so edits made since the selection aren't overwritten. */
export async function setHeadingSize(sdk, { sectionIndex, key }, size) {
  const doc = await loadDoc(sdk);
  const section = sectionsOf(doc)[sectionIndex - 1];
  const el = section && [...section.querySelectorAll(HEADINGS)]
    .find((h) => headingKey(h, section) === key);
  if (!el) throw new Error('Element moved since selection. Reselect it.');
  const block = blockOf(el);
  matchOf(section, el)?.entry.row.remove();
  if (block) {
    setBlockStyle(block, el, size);
    removeEmptyMetadata(section);
  } else {
    setDefaultStyle(section, el, size);
  }
  await saveDoc(sdk, doc);
}

/** Re-keys edited or moved headings, saves if changed, returns orphaned entries. */
export async function repairAll(sdk) {
  const doc = await loadDoc(sdk);
  const total = { rekeyed: [], orphaned: [], cleaned: [] };
  sectionsOf(doc).forEach((section, i) => {
    total.cleaned.push(...removeRetaggedStyles(section)
      .map((key) => ({ sectionIndex: i + 1, key })));
    total.cleaned.push(...pruneSectionStyles(section).map((key) => ({ sectionIndex: i + 1, key })));
    const { matched, orphans } = matchHeadings(section, entriesOf(section));
    matched.filter((m) => m.entry.key !== m.key).forEach((m) => {
      m.entry.row.children[0].textContent = m.key;
      total.rekeyed.push({ from: m.entry.key, to: m.key });
    });
    total.orphaned.push(...orphans.map((o) => ({ sectionIndex: i + 1, key: o.key })));
  });
  if (total.rekeyed.length || total.cleaned.length) await saveDoc(sdk, doc);
  return total;
}

export async function removeOrphan(sdk, { sectionIndex, key }) {
  const doc = await loadDoc(sdk);
  const section = sectionsOf(doc)[sectionIndex - 1];
  findRow(section, key)?.remove();
  await saveDoc(sdk, doc);
}
