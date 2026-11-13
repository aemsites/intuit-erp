// eslint-disable-next-line import/no-unresolved -- SDK is loaded directly from DA's hosted module.
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { sizesFor } from '../../../scripts/heading-key.js';
import { blockNameOf } from '../../../scripts/utils.js';
import {
  headingInfo, currentStyle, setHeadingSize, setHeadingSizes, clearHeadingSizes,
  syncLiveSectionStyles, paragraphAllSize, paragraphAllEnabled,
  setParagraphAllEnabled, clearParagraphAllStyles, cacheDoc, memo, sourceUrl,
  clearBlockParagraphAll, clearBlockParagraphAllStyles, clearBlockSizes,
} from './heading-styler.js';
import { loadEditableBlocks, isEditable, editableKey } from './editable-blocks.js';

const POLL_MS = 1000;
const SELECTION_TIMEOUT_MS = 900;
const ACTIVE_REFRESH_MS = 2000;
const IDLE_REFRESH_MS = 3000;
const ACTIVE_WINDOW_MS = 10000;
const CONFIG_REFRESH_MS = 10000;
// Longest the loader waits for authoring to show a saved change before giving up.
const LIVE_TIMEOUT_MS = 10000;
const METADATA = '.section-metadata, .metadata, .library-metadata';
const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';
const DEFAULT_GROUP = 'Default content';
const CHEVRON = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
const RESET_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22.719 12A10.719 10.719 0 0 1 1.28 12h.838a9.916 9.916 0 1 0 1.373-5H8v1H2V2h1v4.2A10.71 10.71 0 0 1 22.719 12z"/></svg>';

// eslint-disable-next-line no-console
const log = (...args) => console.log('[sematic-styler]', ...args);
const compact = (s) => s.replace(/\s+/g, '');
const sameInputs = (a, b) => Boolean(a && b) && a.every((value, i) => value === b[i]);

const idOf = ({ sectionIndex, key }) => `${sectionIndex}:${key}`;
const paragraphsIn = (groups) => groups.flatMap((g) => g.elements)
  .filter((h) => h.el.tagName === 'P');
const blockGroupCount = (groups) => groups.filter((g) => g.title !== DEFAULT_GROUP).length;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A size dropdown; a current value outside the scale is kept as an extra option. */
function sizeSelect(sizes, value, placeholder) {
  const select = document.createElement('select');
  const options = value && !sizes.includes(value) ? [...sizes, value] : sizes;
  select.append(placeholder, ...options.map((size) => new Option(size, size)));
  select.value = value;
  return select;
}

/** Sets `ids` to `size` in `pending`; returns a function that restores their previous state. */
function setPending(pending, ids, size) {
  const previous = new Map(ids.filter((id) => pending.has(id)).map((id) => [id, pending.get(id)]));
  ids.forEach((id) => pending.set(id, size));
  return () => ids.forEach((id) => {
    if (previous.has(id)) pending.set(id, previous.get(id));
    else pending.delete(id);
  });
}

/* ------------------------------------------------------------- documents */

/** Raw source HTML (null on failure); callers parse it only when it changed. */
async function loadSource({ actions, context }) {
  const resp = await actions.daFetch(sourceUrl(context), { cache: 'no-store' });
  if (!resp.ok) { log('source fetch failed', resp.status); return null; }
  return resp.text();
}

/** The live editor document, with source section metadata filled in where the editor drops it. */
function liveTreeDoc(liveHtml, sourceDoc) {
  const doc = new DOMParser().parseFromString(liveHtml, 'text/html');
  const liveSections = [...doc.querySelectorAll('main > div')];
  const sourceSections = [...sourceDoc.querySelectorAll('main > div')];
  if (liveSections.length !== sourceSections.length) return doc;
  liveSections.forEach((section, i) => {
    if (!section.querySelector(':scope > .section-metadata')) {
      const sourceMeta = sourceSections[i].querySelector(':scope > .section-metadata');
      if (sourceMeta) section.append(doc.importNode(sourceMeta, true));
    }
    syncLiveSectionStyles(section, section);
  });
  return doc;
}

/* ------------------------------------------------------------- selection */

function readSelection(actions) {
  return Promise.race([
    actions.getSelection().catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), SELECTION_TIMEOUT_MS); }),
  ]);
}

/** Text runs (with their tag, when known) in the selection HTML, descending into block tables. */
function selectionNodes(container) {
  const kids = [...container.children];
  if (!kids.length) {
    const full = container.textContent.trim();
    return full ? [{ full }] : [];
  }
  return kids.flatMap((kid) => (kid.tagName === 'TABLE'
    // eslint-disable-next-line no-use-before-define
    ? tableNodes(kid)
    : [{ tag: kid.tagName.toLowerCase(), full: kid.textContent.trim() }]));
}

/** Cells of a DA block table, skipping its block-name row. */
function tableNodes(table) {
  const rows = [...table.querySelectorAll('tr')];
  const hasName = rows.length > 1 && rows[0].querySelectorAll('td, th').length === 1;
  return rows.slice(hasName ? 1 : 0)
    .flatMap((row) => [...row.querySelectorAll('td, th')].flatMap(selectionNodes));
}

const compactText = (el) => memo(el, 'compact', () => compact(el.textContent));

/** Elements in `doc` whose text matches a selected text run. */
function findElements(doc, { tag, full }) {
  const needle = compact(full || '');
  if (!needle) return [];
  const selector = tag ? `main ${tag}` : 'main *';
  const pool = memo(doc, `pool:${selector}`, () => [...doc.querySelectorAll(selector)]);
  const hits = pool.filter((e) => compactText(e).includes(needle));
  if (tag) {
    const exact = hits.filter((e) => compactText(e) === needle);
    return exact.length ? exact : hits;
  }
  // Without a tag, keep only the innermost matches.
  const hitSet = new Set(hits);
  return hits.filter((e) => ![...e.children].some((c) => hitSet.has(c)));
}

/**
 * Blocks in document order, as the editor counts them for `selection.blockIndex`: tables other
 * than (section) metadata. The live document marks them with `data-block-index`.
 */
const blocksInOrder = (doc) => memo(doc, 'blocks', () => {
  const marked = [...doc.querySelectorAll('main [data-block-index]')];
  return marked.length ? marked : [...doc.querySelectorAll('main > div > div[class]')]
    .filter((div) => !div.matches('.default-content-wrapper, .metadata, .section-metadata'));
});

/**
 * Where the editor cursor is: inside block `blockIndex`, or in default content when it is null.
 * `undefined` (no live document) means unknown.
 */
function cursorScope(doc, blockIndex) {
  if (blockIndex === undefined) return null;
  const blocks = blocksInOrder(doc);
  if (blockIndex === null) return (el) => !blocks.some((block) => block.contains(el));
  const block = blocks[blockIndex];
  return block ? (el) => block.contains(el) : null;
}

// Rows highlighted last time, so an ambiguous match keeps pointing at the same row.
let lastSelectedKeys = new Set();

/**
 * Keys of the headings/paragraphs the editor selection covers. The selection is only HTML, so
 * duplicate text can match several elements; each selected text run resolves to one element,
 * preferring the cursor's block (or default content), then the row already highlighted.
 */
function selectedKeysOf(html, doc, blockIndex) {
  const last = memo(doc, 'selection', () => ({}));
  if (last.html === html && last.blockIndex === blockIndex) return last.keys;
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  const inCursor = cursorScope(doc, blockIndex);
  const taken = new Set();
  selectionNodes(body).forEach((node) => {
    const matches = findElements(doc, node)
      .filter((el) => /^(H[1-6]|P)$/.test(el.tagName) && !taken.has(el));
    const near = inCursor ? matches.filter(inCursor) : [];
    const pool = near.length ? near : matches;
    const pick = pool.find((el) => lastSelectedKeys.has(headingInfo(el).key)) || pool[0];
    if (pick) taken.add(pick);
  });
  last.keys = new Set([...taken].map((el) => headingInfo(el).key));
  last.html = html;
  last.blockIndex = blockIndex;
  lastSelectedKeys = last.keys;
  return last.keys;
}

/* ------------------------------------------------------------------ tree */

function blockLabel(block) {
  const name = blockNameOf(block) || 'block';
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

/** The selection-independent tree, memoized per document and editable-block config. */
function baseTree(doc, editableBlocks) {
  return memo(doc, `tree:${editableKey(editableBlocks)}`, () => {
    const defaultEditable = isEditable(null, editableBlocks);
    return [...doc.querySelectorAll('main > div')].map((section, index) => {
      const groups = [...section.children].flatMap((child, childIndex) => {
        if (child.matches(METADATA)) return [];
        const isBlock = child.matches('div[class]')
          && !child.classList.contains('default-content-wrapper');
        if (!isEditable(isBlock ? child : null, editableBlocks)) return [];
        const elements = [
          ...(child.matches(HEADINGS) ? [child] : []),
          ...child.querySelectorAll(HEADINGS),
        ].filter((el) => !el.closest(METADATA)
          && (isBlock || !el.closest('main > div > div[class]')));
        if (!elements.length) return [];
        return [{
          title: isBlock ? blockLabel(child) : DEFAULT_GROUP,
          // Identifies the block for its own "apply to all paragraphs" state.
          blockKey: isBlock ? `${index + 1}/${childIndex}` : null,
          elements: elements.map((el) => ({
            ...headingInfo(el), selected: false, defaultEditable,
          })),
        }];
      });
      return { sectionIndex: index + 1, groups };
    }).filter(({ groups }) => groups.length);
  });
}

/** Sections → groups (block or default content) → headings/paragraphs, flagged when selected. */
function contentTree(html, doc, editableBlocks, blockIndex) {
  if (!doc) return [];
  const tree = baseTree(doc, editableBlocks);
  const keys = html ? selectedKeysOf(html, doc, blockIndex) : null;
  if (!keys?.size) return tree;
  return tree.map(({ sectionIndex, groups }) => ({
    sectionIndex,
    groups: groups.map((group) => ({
      ...group,
      elements: group.elements.map((h) => (keys.has(h.key) ? { ...h, selected: true } : h)),
    })),
  }));
}

/** First heading/paragraph in a section with the given key. */
function findByKey(section, key) {
  const byKey = memo(section, 'byKey', () => {
    const map = new Map();
    section.querySelectorAll(HEADINGS).forEach((el) => {
      const k = headingInfo(el).key;
      if (!map.has(k)) map.set(k, el);
    });
    return map;
  });
  return byKey.get(key);
}

/** Drops pending sizes whose element is gone or already shows the pending size. */
function prunePending(pendingSizes, sections) {
  pendingSizes.forEach((size, id) => {
    const [sectionIndex, key] = id.split(':');
    const section = sections[Number(sectionIndex) - 1];
    const el = section && findByKey(section, key);
    if (!el || currentStyle(section, el).size === size) pendingSizes.delete(id);
  });
}

/* -------------------------------------------------------------- controls */

/** One heading/paragraph row: title, text preview, size dropdown and reset button. */
function headingControl(h, ui, locked) {
  const {
    sdk, status, setLoading, pendingSizes,
  } = ui;
  const tag = h.el.tagName.toLowerCase();
  const id = idOf(h);
  const target = h.block ? `${h.blockName} · ${h.position}` : `default content · ${h.defaultPosition}`;
  const text = h.el.textContent.trim();

  const wrap = element('div', h.selected ? 'tree-item is-selected' : 'tree-item');
  if (h.selected) wrap.setAttribute('aria-current', 'true');
  const content = element('div', 'tree-item-content');
  content.append(
    element('div', 'tree-item-title', `${tag.toUpperCase()} · ${target}`),
    element('div', 'tree-item-preview', text),
  );

  const value = pendingSizes.has(id) ? pendingSizes.get(id) : currentStyle(h.section, h.el).size;
  const select = sizeSelect(sizesFor(tag), value, new Option('Default size', ''));
  select.dataset.focusKey = id;
  select.setAttribute('aria-label', `Size for ${tag}: ${text.slice(0, 40)}`);
  let selectedSize = select.value;

  const remove = element('button', 'remove-class');
  remove.type = 'button';
  remove.title = 'Remove applied size';
  remove.setAttribute('aria-label', `Remove applied size from ${tag}`);
  remove.innerHTML = RESET_ICON;
  remove.disabled = !select.value;
  if (locked) {
    wrap.classList.add('is-locked');
    select.disabled = true;
    remove.disabled = true;
  }

  const save = async (size) => {
    pendingSizes.set(id, size);
    setLoading(true);
    try {
      await setHeadingSize(sdk, h, size);
      selectedSize = size;
      remove.disabled = !select.value;
      status.textContent = size ? `Saved ${target}` : `Removed applied size from ${target}`;
    } catch (e) {
      log('save error', e);
      status.textContent = e.message;
      if (pendingSizes.get(id) === size) {
        pendingSizes.set(id, selectedSize);
        select.value = selectedSize;
      }
    } finally {
      setLoading(false);
    }
  };
  select.addEventListener('change', () => save(select.value));
  remove.addEventListener('click', () => { select.value = ''; save(''); });

  const controls = element('div', 'tree-item-controls');
  controls.append(select, remove);
  wrap.append(content, controls);
  return wrap;
}

/**
 * Whether the section-level "apply to all paragraphs" is on: an explicit choice in this session,
 * else the section's `paragraph-all` row. (A shared tag-wide size alone may be block-level.)
 */
function applyAllOn(sectionIndex, paragraphs, paragraphAll) {
  if (paragraphAll.has(sectionIndex)) return paragraphAll.get(sectionIndex) !== null;
  return paragraphAllEnabled(paragraphs[0]?.section);
}

/** Whether a block's own "apply to all paragraphs" is on: explicit choice, else a shared size. */
function blockAllOn(blockKey, paragraphs, { blockAll, pendingSizes }) {
  if (blockAll.has(blockKey)) return blockAll.get(blockKey) !== null;
  return Boolean(paragraphAllSize(paragraphs, pendingSizes));
}

/** The "Apply to all …" row: a checkbox and a paragraph size dropdown. */
function applyAllRow({
  focusKey, labelText, checked, value, ariaLabel,
}) {
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.focusKey = `${focusKey}-toggle`;
  checkbox.checked = checked;
  const label = element('label', 'apply-all-label');
  label.append(checkbox, labelText);

  const placeholder = new Option('Default size', '');
  placeholder.disabled = true;
  const select = sizeSelect(sizesFor('p'), value, placeholder);
  select.dataset.focusKey = focusKey;
  select.disabled = !checked;
  select.setAttribute('aria-label', ariaLabel);

  const controls = element('div', 'tree-item-controls');
  controls.append(select);
  const wrap = element('div', 'tree-item apply-all-row');
  wrap.append(label, controls);
  return { wrap, checkbox, select };
}

/** The section's "Apply to all Paragraphs" checkbox and size dropdown. */
function paragraphAllControl(sectionIndex, paragraphs, ui) {
  const {
    sdk, status, setLoading, pendingSizes, paragraphAll, rerender, forgetDoc, paragraphsOf,
    clearBlockAll,
  } = ui;
  const ids = paragraphs.map(idOf);
  const common = paragraphAllSize(paragraphs, pendingSizes);
  const { wrap, checkbox, select } = applyAllRow({
    focusKey: `all:${sectionIndex}`,
    labelText: 'Apply to all Paragraphs',
    checked: applyAllOn(sectionIndex, paragraphs, paragraphAll),
    value: paragraphAll.get(sectionIndex) || common,
    ariaLabel: `Size for all paragraphs in section ${sectionIndex}`,
  });

  const apply = async (size) => {
    const restore = setPending(pendingSizes, ids, size);
    setLoading(true);
    try {
      const count = await setHeadingSizes(sdk, paragraphs, size);
      status.textContent = `Applied ${size} to ${count} P in section ${sectionIndex}`;
    } catch (e) {
      log('apply all error', e);
      status.textContent = e.message;
      restore();
    } finally {
      setLoading(false);
      rerender();
    }
  };

  const disable = async () => {
    // This row may be reused from an earlier render; act on the most recently rendered document.
    const latest = paragraphsOf(sectionIndex) || paragraphs;
    paragraphAll.set(sectionIndex, null);
    clearBlockAll(sectionIndex);
    setLoading(true);
    try {
      await setParagraphAllEnabled(sdk, latest, false);
      clearParagraphAllStyles(latest);
      // That edited the rendered document in place; re-read it fresh on the next render.
      forgetDoc(latest[0]?.section?.ownerDocument);
      latest.forEach((h) => pendingSizes.set(idOf(h), currentStyle(h.section, h.el).size));
      status.textContent = `Disabled apply to all paragraphs in section ${sectionIndex}`;
    } catch (e) {
      log('disable apply all error', e);
      status.textContent = e.message;
      paragraphAll.set(sectionIndex, common);
    } finally {
      setLoading(false);
      rerender();
    }
  };

  const enable = async () => {
    paragraphAll.set(sectionIndex, select.value);
    // The section-level size replaces any block-level one.
    clearBlockAll(sectionIndex);
    const restore = setPending(pendingSizes, ids, '');
    setLoading(true);
    const enabled = setParagraphAllEnabled(sdk, paragraphs, true);
    if (select.value) apply(select.value);
    try {
      await enabled;
      if (!select.value) status.textContent = `Reset paragraph sizes in section ${sectionIndex}; choose a size to apply to all`;
    } catch (e) {
      log('enable apply all error', e);
      status.textContent = e.message;
      paragraphAll.set(sectionIndex, null);
      checkbox.checked = false;
      restore();
    } finally {
      setLoading(false);
      if (!select.value) rerender();
    }
  };

  checkbox.addEventListener('change', () => (checkbox.checked ? enable() : disable()));
  select.addEventListener('change', () => {
    paragraphAll.set(sectionIndex, select.value);
    apply(select.value);
  });

  const item = element('li', 'tree-group');
  item.append(wrap);
  return item;
}

/**
 * A block's own "Apply to all Paragraphs in this block": a tag-wide P size on that block only.
 * Disabled while the section-level apply-all is on, since that already covers the block.
 */
function blockAllControl(group, paragraphs, ui, sectionOn) {
  const {
    sdk, status, setLoading, pendingSizes, blockAll, rerender, forgetDoc, blockParagraphsOf,
  } = ui;
  const { blockKey, title } = group;
  const ids = paragraphs.map(idOf);
  const common = paragraphAllSize(paragraphs, pendingSizes);
  const { wrap, checkbox, select } = applyAllRow({
    focusKey: `block-all:${blockKey}`,
    labelText: 'Apply to all Paragraphs in this block',
    checked: sectionOn || blockAllOn(blockKey, paragraphs, ui),
    value: blockAll.get(blockKey) || common,
    ariaLabel: `Size for all paragraphs in ${title}`,
  });
  if (sectionOn) {
    checkbox.disabled = true;
    select.disabled = true;
    wrap.classList.add('is-locked');
    wrap.title = 'Controlled by the section\'s Apply to all Paragraphs';
  }
  const previous = blockAll.has(blockKey) ? blockAll.get(blockKey) : undefined;
  const revert = () => {
    if (previous === undefined) blockAll.delete(blockKey);
    else blockAll.set(blockKey, previous);
  };

  /** Saves `save()` behind the loader, with pending sizes `size` and a redraw at the end. */
  const run = async (size, save, done, label) => {
    const restore = setPending(pendingSizes, ids, size);
    setLoading(true);
    try {
      status.textContent = done(await save());
    } catch (e) {
      log(`${label} error`, e);
      status.textContent = e.message;
      revert();
      restore();
    } finally {
      setLoading(false);
      rerender();
    }
  };
  const apply = (size) => {
    blockAll.set(blockKey, size);
    return run(size, () => setHeadingSizes(sdk, paragraphs, size), (count) => `Applied ${size} to ${count} P in ${title}`, 'block apply all');
  };

  const enable = () => {
    if (select.value) return apply(select.value);
    // Like the section-level one: clear per-paragraph sizes until a size is chosen.
    blockAll.set(blockKey, '');
    return run('', () => clearHeadingSizes(sdk, paragraphs), () => `Reset paragraph sizes in ${title}; choose a size to apply to all`, 'block enable apply all');
  };

  const disable = async () => {
    // This row may be reused from an earlier render; act on the most recently rendered document.
    const latest = blockParagraphsOf(blockKey) || paragraphs;
    blockAll.set(blockKey, null);
    setLoading(true);
    try {
      await clearBlockParagraphAll(sdk, latest);
      clearBlockParagraphAllStyles(latest);
      // That edited the rendered document in place; re-read it fresh on the next render.
      forgetDoc(latest[0]?.el.ownerDocument);
      latest.forEach((h) => pendingSizes.set(idOf(h), currentStyle(h.section, h.el).size));
      status.textContent = `Disabled apply to all paragraphs in ${title}`;
    } catch (e) {
      log('block disable apply all error', e);
      status.textContent = e.message;
      revert();
    } finally {
      setLoading(false);
      rerender();
    }
  };

  checkbox.addEventListener('change', () => (checkbox.checked ? enable() : disable()));
  select.addEventListener('change', () => apply(select.value));

  const item = element('li');
  item.append(wrap);
  return item;
}

/** Whether a row has a size, counting a change still being saved. */
const hasSize = (h, pendingSizes) => {
  const id = idOf(h);
  return pendingSizes.has(id) ? pendingSizes.get(id) : currentStyle(h.section, h.el).size;
};

/**
 * A block's "Reset all": clears the block's sizes and its block-level apply-all in one save. When
 * the section-level apply-all is on it owns the paragraphs, so only the other elements are reset.
 */
function resetBlockButton(group, ui, sectionOn) {
  const {
    sdk, status, setLoading, pendingSizes, blockAll, rerender,
  } = ui;
  const { blockKey, title } = group;
  const targets = sectionOn ? group.elements.filter((h) => h.el.tagName !== 'P') : group.elements;
  const button = element('button', 'da-ds-button da-ds-button-secondary reset-section', 'Reset all');
  button.type = 'button';
  button.setAttribute('aria-label', `Remove all applied sizes in ${title}`);
  button.disabled = !targets.some((h) => hasSize(h, pendingSizes));
  button.addEventListener('click', async () => {
    const restore = setPending(pendingSizes, targets.map(idOf), '');
    const wasAll = blockAll.has(blockKey) ? blockAll.get(blockKey) : undefined;
    if (!sectionOn) blockAll.set(blockKey, null);
    setLoading(true);
    try {
      await clearBlockSizes(sdk, targets);
      status.textContent = `Removed all applied sizes from ${title}`;
    } catch (err) {
      log('reset block error', err);
      status.textContent = err.message;
      if (wasAll === undefined) blockAll.delete(blockKey);
      else blockAll.set(blockKey, wasAll);
      restore();
    } finally {
      setLoading(false);
      rerender();
    }
  });
  return button;
}

/** The section's "Reset all" button, which clears every size (and apply-all) in one save. */
function resetSectionButton(sectionIndex, sectionElements, ui) {
  const {
    sdk, status, setLoading, pendingSizes, paragraphAll, rerender, clearBlockAll,
  } = ui;
  const button = element('button', 'da-ds-button da-ds-button-secondary reset-section', 'Reset all');
  button.type = 'button';
  button.setAttribute('aria-label', `Remove all applied sizes in section ${sectionIndex}`);
  button.disabled = !sectionElements.some((h) => hasSize(h, pendingSizes));
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const restore = setPending(pendingSizes, sectionElements.map(idOf), '');
    const wasAll = paragraphAll.has(sectionIndex) ? paragraphAll.get(sectionIndex) : undefined;
    // Reset turns apply-all off too, section- and block-level.
    paragraphAll.set(sectionIndex, null);
    clearBlockAll(sectionIndex);
    setLoading(true);
    try {
      await clearHeadingSizes(sdk, sectionElements);
      status.textContent = `Removed all applied sizes from section ${sectionIndex}`;
    } catch (err) {
      log('reset section error', err);
      status.textContent = err.message;
      if (wasAll === undefined) paragraphAll.delete(sectionIndex);
      else paragraphAll.set(sectionIndex, wasAll);
      restore();
    } finally {
      setLoading(false);
      rerender();
    }
  });
  return button;
}

/* ---------------------------------------------------------------- render */

/** Everything a section's rendered output depends on; equal signatures render identically. */
function sectionSignature(sectionIndex, groups, { pendingSizes, paragraphAll, blockAll }) {
  const paragraphs = paragraphsIn(groups);
  const pending = (h) => (pendingSizes.has(idOf(h)) ? [pendingSizes.get(idOf(h))] : 0);
  const blockState = ({ blockKey, elements }) => (blockKey ? [
    blockAll.has(blockKey) ? [blockAll.get(blockKey)] : 0,
    paragraphAllSize(paragraphsIn([{ elements }]), pendingSizes),
  ] : 0);
  return JSON.stringify([
    paragraphAll.has(sectionIndex) ? [paragraphAll.get(sectionIndex)] : 0,
    paragraphs.length
      ? [paragraphAllEnabled(paragraphs[0].section), paragraphAllSize(paragraphs, pendingSizes)]
      : 0,
    groups.map((group) => [group.title, blockState(group), group.elements.map((h) => [
      h.key, h.el.tagName, h.blockName, h.position, h.defaultPosition, Boolean(h.block),
      h.el.textContent.trim(), h.selected, h.defaultEditable,
      currentStyle(h.section, h.el).size, pending(h),
    ])]),
  ]);
}

/** One collapsible section: reset button, apply-all row and a group per block. */
function sectionNode(sectionIndex, groups, ui, open, updateToggle) {
  const { paragraphAll } = ui;
  const sectionElements = groups.flatMap((g) => g.elements);
  const paragraphs = paragraphsIn(groups);

  const details = element('details', 'tree-section-details');
  details.dataset.sectionIndex = sectionIndex;
  details.open = open;
  details.addEventListener('toggle', updateToggle);
  const chevron = element('span', 'tree-section-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = CHEVRON;
  const summary = element('summary', 'tree-section-title');
  summary.append(
    element('span', '', `Section ${sectionIndex}`),
    resetSectionButton(sectionIndex, sectionElements, ui),
    chevron,
  );

  const groupList = element('ul', 'tree-groups');
  if (paragraphs.length) groupList.append(paragraphAllControl(sectionIndex, paragraphs, ui));
  const sectionOn = applyAllOn(sectionIndex, paragraphs, paragraphAll);
  groups.forEach((group) => {
    const elementList = element('ul', 'tree-elements');
    const blockParagraphs = paragraphsIn([group]);
    let locked = sectionOn;
    if (group.blockKey && blockParagraphs.length) {
      elementList.append(blockAllControl(group, blockParagraphs, ui, sectionOn));
      locked = sectionOn || blockAllOn(group.blockKey, blockParagraphs, ui);
    }
    group.elements.forEach((h) => {
      const item = element('li');
      item.append(headingControl(h, ui, locked && h.el.tagName === 'P'));
      elementList.append(item);
    });
    const groupTitle = element('div', 'tree-group-title', group.title);
    if (group.blockKey) groupTitle.append(resetBlockButton(group, ui, sectionOn));
    const groupItem = element('li', 'tree-group');
    groupItem.append(groupTitle, elementList);
    groupList.append(groupItem);
  });

  details.append(summary, groupList);
  const node = element('li', 'tree-section');
  node.append(details);
  return { node, details };
}

// Per list: the persistent tree card and, per section, its rendered node and data signature.
const views = new WeakMap();

/** The tree card (header + section list), created once and kept while the tree is non-empty. */
function treeView(list) {
  const existing = views.get(list);
  if (existing && existing.card.parentNode === list) return existing;
  const treeList = element('ul', 'content-tree');
  const toggleAll = element('button', 'da-ds-button da-ds-button-secondary tree-toggle');
  toggleAll.type = 'button';
  toggleAll.innerHTML = CHEVRON;
  const allDetails = () => [...treeList.querySelectorAll('.tree-section-details')];
  const updateToggle = () => {
    const sections = allDetails();
    const allExpanded = sections.length > 0 && sections.every((d) => d.open);
    const label = `${allExpanded ? 'Collapse' : 'Expand'} all sections`;
    toggleAll.setAttribute('aria-expanded', String(allExpanded));
    toggleAll.setAttribute('aria-label', label);
    toggleAll.title = label;
  };
  toggleAll.addEventListener('click', () => {
    const sections = allDetails();
    const open = sections.some((d) => !d.open);
    sections.forEach((d) => { d.open = open; });
    updateToggle();
  });

  const actions = element('div', 'tree-actions');
  actions.append(toggleAll);
  const header = element('div', 'tree-header');
  header.append(element('div', 'tree-title', 'Content tree'), actions);
  const card = element('li');
  card.append(header, treeList);
  list.replaceChildren(card);
  const view = {
    card, treeList, updateToggle, sections: new Map(),
  };
  views.set(list, view);
  return view;
}

/**
 * Updates the panel in place: sections whose data is unchanged keep their existing DOM (and any
 * focus or open dropdown); only changed sections are rebuilt. `rerender` rebuilds from the current
 * documents, so a finished save never redraws stale data.
 */
function render(list, tree, ui, selectionChanged) {
  if (!tree.length) {
    list.replaceChildren(element('li', 'tree-empty-state', 'Add content to use the plugin.'));
    return;
  }
  const { focusKey } = document.activeElement?.dataset || {};
  const { treeList, updateToggle, sections } = treeView(list);
  const nodes = tree.map(({ sectionIndex, groups }) => {
    const selected = groups.some((g) => g.elements.some((e) => e.selected));
    const signature = sectionSignature(sectionIndex, groups, ui);
    const prev = sections.get(sectionIndex);
    if (prev && prev.signature === signature) {
      if (selectionChanged && selected && !prev.details.open) prev.details.open = true;
      return prev.node;
    }
    const open = prev ? (prev.details.open || (selectionChanged && selected)) : selected;
    const entry = { signature, ...sectionNode(sectionIndex, groups, ui, open, updateToggle) };
    // Author input changes control state the signature can't see, so rebuild on the next render.
    const touched = (e) => {
      if (e.type === 'change' || e.target.closest('button')) entry.signature = null;
    };
    entry.node.addEventListener('change', touched, true);
    entry.node.addEventListener('click', touched, true);
    sections.set(sectionIndex, entry);
    return entry.node;
  });

  nodes.forEach((node, i) => {
    const at = treeList.children[i];
    if (at !== node) treeList.insertBefore(node, at || null);
  });
  while (treeList.children.length > nodes.length) treeList.lastElementChild.remove();
  const shown = new Set(tree.map(({ sectionIndex }) => sectionIndex));
  [...sections.keys()].forEach((index) => { if (!shown.has(index)) sections.delete(index); });
  updateToggle();
  if (focusKey && !list.contains(document.activeElement)) {
    list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

/* ------------------------------------------------------------------ init */

export default async function init() {
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  const loading = document.getElementById('loading');
  const sdk = await DA_SDK;
  log('SDK ready', sdk.context, Object.keys(sdk.actions));
  const hasLive = Boolean(sdk.capabilities?.liveDocument && sdk.actions.subscribeLiveDocument);

  // Undefined until first config read; the tree stays empty until then.
  let editableBlocks;
  let selection = null;
  let lastChange = 0;
  let sourceDoc;
  let sourceText;
  let liveHtml = null;
  let liveSeen = null;
  const pendingSizes = new Map();
  // Explicit "apply to all paragraphs" choices this session: per section, and per block
  // (`{sectionIndex}/{childIndex}`). A size turns it on, null turns it off.
  const paragraphAll = new Map();
  const blockAll = new Map();
  // Block the editor cursor is in (null: default content; undefined: unknown).
  let cursorBlock;

  let rendered = null;
  let picking = false;
  let deferred = false;
  // The tree last drawn, for handlers on section rows that were reused rather than rebuilt.
  let lastTree = [];

  // Parsed documents are cached by the HTML they came from, so each distinct markup is parsed once.
  let treeCache = null;
  const treeDoc = () => {
    if (!liveHtml) return sourceDoc;
    if (treeCache?.liveHtml !== liveHtml || treeCache.sourceDoc !== sourceDoc) {
      treeCache = { liveHtml, sourceDoc, doc: cacheDoc(liveTreeDoc(liveHtml, sourceDoc)) };
    }
    return treeCache.doc;
  };
  const forgetDoc = (doc) => { if (doc && treeCache?.doc === doc) treeCache = null; };

  let seenCache = null;
  /** The editor's markup as is, without the source metadata liveTreeDoc fills in. */
  const seenSections = () => {
    if (seenCache?.html !== liveSeen) {
      const doc = cacheDoc(new DOMParser().parseFromString(liveSeen, 'text/html'));
      const sections = [...doc.querySelectorAll('main > div')];
      sections.forEach((section) => syncLiveSectionStyles(section, section));
      seenCache = { html: liveSeen, sections };
    }
    return seenCache.sections;
  };

  const paragraphsOf = (sectionIndex) => {
    const section = lastTree.find((s) => s.sectionIndex === sectionIndex);
    const paragraphs = section && paragraphsIn(section.groups);
    return paragraphs?.length ? paragraphs : null;
  };
  const blockParagraphsOf = (blockKey) => {
    const group = lastTree.flatMap((s) => s.groups).find((g) => g.blockKey === blockKey);
    const paragraphs = group && paragraphsIn([group]);
    return paragraphs?.length ? paragraphs : null;
  };
  const clearBlockAll = (sectionIndex) => [...blockAll.keys()]
    .filter((key) => key.startsWith(`${sectionIndex}/`))
    .forEach((key) => blockAll.delete(key));

  /**
   * The section-level apply-all size, or '' when it is off: the explicit choice this session,
   * else the section's `paragraph-all` row. A tag-wide size alone may be block-level.
   */
  const sectionAllSize = (sectionIndex, groups) => {
    if (paragraphAll.has(sectionIndex)) return paragraphAll.get(sectionIndex) || '';
    if (!paragraphAllEnabled(groups[0].elements[0].section)) return '';
    return paragraphsIn(groups).map((h) => paragraphAllSize([h])).find(Boolean) || '';
  };

  /* -------------------------------------------------------- loader */

  let writing = 0;
  let writeCount = 0;
  let awaitingSince = 0;
  // Sections where authoring shows more blocks than the source while apply-all is on.
  const blocksAdded = new Map();
  let blocksAddedSince = 0;
  let checkedBlocks = null;

  /** Watches for blocks added in the editor to an apply-all section, keeping the loader up. */
  const trackAddedBlocks = () => {
    const inputs = [editableKey(editableBlocks || new Set()), sourceText, liveHtml];
    if (!liveHtml || !sourceDoc || editableBlocks === undefined
      || sameInputs(inputs, checkedBlocks)) return;
    checkedBlocks = inputs;
    const liveTree = baseTree(treeDoc(), editableBlocks);
    baseTree(sourceDoc, editableBlocks).forEach(({ sectionIndex, groups }) => {
      const on = Boolean(sectionAllSize(sectionIndex, groups));
      const saved = blockGroupCount(groups);
      const live = liveTree.find((s) => s.sectionIndex === sectionIndex);
      const shown = live ? blockGroupCount(live.groups) : 0;
      if (!on || shown <= saved) {
        blocksAdded.delete(sectionIndex);
        return;
      }
      if (!blocksAdded.size) {
        blocksAddedSince = Date.now();
        // eslint-disable-next-line no-use-before-define
        setTimeout(() => setLoading(), LIVE_TIMEOUT_MS);
      }
      blocksAdded.set(sectionIndex, shown);
    });
  };

  /** `true`/`false` start/end a write; no argument just re-evaluates the loader. */
  const setLoading = (visible) => {
    if (visible === true) {
      writing += 1;
      writeCount += 1;
      status.style.color = '';
    } else if (visible === false) {
      writing = Math.max(0, writing - 1);
      if (!writing) {
        // eslint-disable-next-line no-use-before-define
        checkSource();
        awaitingSince = Date.now();
        if (hasLive) setTimeout(() => setLoading(), LIVE_TIMEOUT_MS);
      }
    }
    if (hasLive && liveSeen && pendingSizes.size) prunePending(pendingSizes, seenSections());
    if (hasLive && !writing && pendingSizes.size
      && Date.now() - awaitingSince >= LIVE_TIMEOUT_MS) {
      status.textContent = 'Something went wrong applying the changes; please try again.';
      status.style.color = 'var(--s2-red-800)';
      pendingSizes.clear();
      rendered = null;
      // eslint-disable-next-line no-use-before-define
      update(false);
    }
    trackAddedBlocks();
    if (blocksAdded.size && Date.now() - blocksAddedSince >= LIVE_TIMEOUT_MS) blocksAdded.clear();

    const awaiting = hasLive && pendingSizes.size > 0;
    const busy = writing > 0 || awaiting || blocksAdded.size > 0;
    loading.hidden = !busy;
    loading.setAttribute('aria-hidden', String(!busy));
    loading.setAttribute('aria-label', (writing && 'Changes in progress')
      || (awaiting && 'Updating the page') || 'Applying styles to the new block');
  };

  /* -------------------------------------------------------- update */

  const ui = {
    sdk,
    status,
    setLoading,
    pendingSizes,
    paragraphAll,
    blockAll,
    forgetDoc,
    paragraphsOf,
    blockParagraphsOf,
    clearBlockAll,
    // eslint-disable-next-line no-use-before-define
    rerender: () => { rendered = null; update(false); },
  };

  const update = (selectionChanged) => {
    if (!sourceDoc || editableBlocks === undefined) return;
    // Rebuilding while a dropdown is open would close it; redraw once the pick is done.
    deferred = picking;
    if (deferred) return;
    const inputs = [editableKey(editableBlocks), selection, cursorBlock, liveHtml ?? sourceText];
    if (sameInputs(inputs, rendered)) return;
    rendered = inputs;
    lastTree = contentTree(selection, treeDoc(), editableBlocks, cursorBlock);
    render(list, lastTree, ui, selectionChanged);
    if (editableBlocks?.size === 0) {
      status.textContent = 'No blocks are editable. List them in the include column of the library config, or use "all".';
    } else if (selection === null) {
      status.textContent = lastTree.length ? 'Select content in the document.' : '';
    }
  };

  list.addEventListener('pointerdown', (e) => { picking = e.target.matches('select'); });
  ['change', 'focusout'].forEach((type) => list.addEventListener(type, () => {
    picking = false;
    if (deferred) setTimeout(() => update(false));
  }));

  /* -------------------------------------------------------- source */

  /** Applies a section's apply-all size to paragraphs that don't have it yet (new blocks). */
  const applyAllToNewParagraphs = () => {
    baseTree(sourceDoc, editableBlocks).forEach(({ sectionIndex, groups }) => {
      const paragraphs = paragraphsIn(groups);
      const size = sectionAllSize(sectionIndex, groups);
      const missing = paragraphs.filter((h) => paragraphAllSize([h]) !== size);
      // The source has caught up with the block authoring showed; the write below (if any)
      // keeps the loader up from here.
      const saved = blockGroupCount(groups);
      if (blocksAdded.get(sectionIndex) <= saved) blocksAdded.delete(sectionIndex);
      if (!size || !missing.length) return;
      missing.forEach((h) => pendingSizes.set(idOf(h), size));
      setLoading(true);
      setHeadingSizes(sdk, missing, size)
        .then((count) => {
          status.textContent = `Applied ${size} to ${count} new P in section ${sectionIndex}`;
        })
        .catch((e) => {
          log('apply all to new block error', e);
          missing.forEach((h) => pendingSizes.delete(idOf(h)));
        })
        .finally(() => setLoading(false));
    });
  };

  let sourceBusy = false;
  const checkSource = async () => {
    if (sourceBusy || writing || document.hidden) return;
    sourceBusy = true;
    const writesBefore = writeCount;
    let stale = false;
    try {
      const text = await loadSource(sdk);
      // A save started meanwhile, so this read may predate it; read again once it's done.
      stale = writing > 0 || writeCount !== writesBefore;
      if (stale) return;
      if (text === null) { status.textContent = 'Unable to refresh the source. Retrying...'; return; }
      // Unchanged source (the common poll result): skip parsing entirely.
      if (text === sourceText) return;
      lastChange = Date.now();
      const doc = cacheDoc(new DOMParser().parseFromString(text, 'text/html'));
      const sections = [...doc.querySelectorAll('main > div')];
      if (sourceText !== undefined) {
        liveHtml = null;
        if (sections.length !== sourceDoc.querySelectorAll('main > div').length) {
          paragraphAll.clear();
          blockAll.clear();
        }
      }
      sourceDoc = doc;
      sourceText = text;
      if (!hasLive) prunePending(pendingSizes, sections);
      if (editableBlocks !== undefined) {
        applyAllToNewParagraphs();
        setLoading();
      }
      update(false);
    } catch (e) {
      log('source error', e);
    } finally {
      sourceBusy = false;
      if (stale) checkSource();
    }
  };
  const watchSource = async () => {
    await checkSource();
    setTimeout(watchSource, Date.now() - lastChange < ACTIVE_WINDOW_MS
      ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
  };
  watchSource();

  /* -------------------------------------------------------- config */

  // Re-reads the library config's `include` column and rebuilds the tree when it changes.
  let configBusy = false;
  const checkConfig = async () => {
    if (configBusy || document.hidden) return;
    configBusy = true;
    try {
      const fresh = await loadEditableBlocks(sdk, window.location.pathname);
      if (fresh === undefined
        || (editableBlocks !== undefined && editableKey(fresh) === editableKey(editableBlocks))) {
        return;
      }
      editableBlocks = fresh;
      log('editable blocks', editableKey(editableBlocks) || 'none');
      update(false);
    } finally {
      configBusy = false;
    }
  };
  const watchConfig = async () => {
    await checkConfig();
    setTimeout(watchConfig, editableBlocks === undefined ? POLL_MS : CONFIG_REFRESH_MS);
  };
  await watchConfig();
  // Authors edit the config in another tab, so pick up changes as soon as they come back.
  document.addEventListener('visibilitychange', () => {
    checkConfig();
    // Polls skip while hidden; catch up on the source right away instead of at the next tick.
    if (!document.hidden) checkSource();
  });

  /* ------------------------------------------ live document & selection */

  if (hasLive) {
    sdk.actions.subscribeLiveDocument(({ html, selection: cursor }) => {
      // Fires on cursor moves between blocks too; that is what tells duplicate text apart.
      const blockIndex = cursor?.blockIndex;
      const cursorMoved = blockIndex !== cursorBlock;
      cursorBlock = blockIndex;
      if (html === liveHtml) {
        if (cursorMoved && selection !== null) update(true);
        return;
      }
      liveHtml = html;
      liveSeen = html;
      lastChange = Date.now();
      try {
        update(false);
        setLoading();
        if (blocksAdded.size) checkSource();
      } catch (e) { log('live document error', e); }
    });
  }

  let selectionBusy = false;
  setInterval(async () => {
    if (selectionBusy || document.hidden) return;
    selectionBusy = true;
    try {
      const html = await readSelection(sdk.actions);
      if (html === selection) return;
      selection = html;
      lastChange = Date.now();
      update(true);
      checkSource();
    } catch (e) {
      log('selection error', e);
    } finally {
      selectionBusy = false;
    }
  }, POLL_MS);
}

init();
