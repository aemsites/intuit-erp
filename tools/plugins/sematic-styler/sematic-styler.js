// eslint-disable-next-line import/no-unresolved -- SDK is loaded directly from DA's hosted module.
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { sizesFor } from '../../../scripts/heading-key.js';
import {
  headingInfo, currentStyle, setHeadingSize, setHeadingSizes, clearHeadingSizes,
  syncLiveSectionStyles, paragraphAllSize, paragraphAllEnabled,
  setParagraphAllEnabled, clearParagraphAllStyles,
} from './heading-styler.js';
import {
  loadEditableBlocks, isEditable, editableKey,
} from './editable-blocks.js';
import { blockNameOf } from '../../../scripts/utils.js';

const POLL_MS = 1000;
const TIMEOUT_MS = 900;
const ACTIVE_REFRESH_MS = 2000;
const IDLE_REFRESH_MS = 3000;
const ACTIVE_WINDOW_MS = 10000;
const CONFIG_REFRESH_MS = 10000;
const METADATA = '.section-metadata, .metadata, .library-metadata';
const ROLES = {
  h1: 'heading 1',
  h2: 'heading 2',
  h3: 'heading 3',
  h4: 'heading 4',
  h5: 'heading 5',
  h6: 'heading 6',
  p: 'paragraph',
  a: 'link',
  img: 'image',
  picture: 'image',
  ul: 'bulleted list',
  ol: 'numbered list',
  li: 'list item',
  strong: 'bold',
  em: 'italic',
};

// eslint-disable-next-line no-console
const log = (...args) => console.log('[sematic-styler]', ...args);
const compact = (s) => s.replace(/\s+/g, '');

function blockLabel(block) {
  const name = blockNameOf(block) || 'block';
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

function describeNode(el) {
  const tag = el.tagName.toLowerCase();
  const full = el.textContent.trim();
  return {
    title: `${ROLES[tag] || tag} <${tag}>`, detail: full.slice(0, 80), tag, full,
  };
}

function describeContainer(el) {
  const kids = [...el.children];
  if (!kids.length) {
    const text = el.textContent.trim();
    // eslint-disable-next-line no-use-before-define
    return text ? [{ title: 'inline text', detail: text.slice(0, 80), full: text }] : [];
  }
  // eslint-disable-next-line no-use-before-define
  return kids.flatMap((k) => (k.tagName === 'TABLE' ? describeTable(k) : [describeNode(k)]));
}

function describeTable(table) {
  const rows = [...table.querySelectorAll('tr')];
  const first = rows[0]?.querySelectorAll('td, th');
  const hasName = rows.length > 1 && first?.length === 1;
  const out = hasName ? [{ title: `block: ${first[0].textContent.trim()}`, detail: '' }] : [];
  rows.slice(hasName ? 1 : 0).forEach((row) => {
    row.querySelectorAll('td, th').forEach((cell) => out.push(...describeContainer(cell)));
  });
  return out;
}

async function loadSource({ actions, context }) {
  const path = (context.path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/index';
  const resp = await actions.daFetch(
    `https://admin.da.live/source/${context.org}/${context.repo}${path}.html`,
    { cache: 'no-store' },
  );
  if (!resp.ok) { log('source fetch failed', resp.status); return null; }
  const text = await resp.text();
  return { text, doc: new DOMParser().parseFromString(text, 'text/html') };
}

function findElements(doc, { tag, full }) {
  const needle = compact(full || '');
  if (!needle) return [];
  const pool = [...doc.querySelectorAll(tag ? `main ${tag}` : 'main *')];
  const hits = pool.filter((e) => compact(e.textContent).includes(needle));
  if (tag) {
    const exact = hits.filter((e) => compact(e.textContent) === needle);
    return exact.length ? exact : hits;
  }
  return hits.filter((e) => ![...e.children].some((c) => hits.includes(c)));
}

function contentTree(html, doc, editableBlocks) {
  if (!doc) return [];
  const body = html ? new DOMParser().parseFromString(html, 'text/html').body : null;
  const selectedKeys = new Set(body ? describeContainer(body)
    .flatMap((node) => findElements(doc, node))
    .filter((el) => /^(H[1-6]|P)$/.test(el.tagName))
    .map((el) => headingInfo(el).key) : []);
  return [...doc.querySelectorAll('main > div')].map((section, index) => {
    const groups = [];
    [...section.children].forEach((child) => {
      if (child.matches(METADATA)) return;
      const isBlock = child.matches('div[class]')
        && !child.classList.contains('default-content-wrapper');
      if (!isEditable(isBlock ? child : null, editableBlocks)) return;
      const elements = [
        ...(child.matches('h1,h2,h3,h4,h5,h6,p') ? [child] : []),
        ...child.querySelectorAll('h1,h2,h3,h4,h5,h6,p'),
      ].filter((el) => !el.closest(METADATA)
        && (isBlock || !el.closest('main > div > div[class]')));
      if (!elements.length) return;
      groups.push({
        title: isBlock ? blockLabel(child) : 'Default content',
        elements: elements.map((el) => {
          const heading = headingInfo(el);
          return { ...heading, selected: selectedKeys.has(heading.key) };
        }),
      });
    });
    return { sectionIndex: index + 1, groups };
  }).filter(({ groups }) => groups.length);
}

function headingControl(h, sdk, status, setLoading, pendingSizes, locked) {
  const wrap = document.createElement('div');
  const content = document.createElement('div');
  const name = document.createElement('div');
  const preview = document.createElement('div');
  const controls = document.createElement('div');
  const tag = h.el.tagName.toLowerCase();
  const target = h.block ? `${h.blockName} · ${h.position}` : `default content · ${h.defaultPosition}`;
  wrap.className = h.selected ? 'tree-item is-selected' : 'tree-item';
  if (h.selected) wrap.setAttribute('aria-current', 'true');
  content.className = 'tree-item-content';
  name.className = 'tree-item-title';
  name.textContent = `${tag.toUpperCase()} · ${target}`;
  preview.className = 'tree-item-preview';
  preview.textContent = h.el.textContent.trim();
  content.append(name, preview);
  controls.className = 'tree-item-controls';
  const id = `${h.sectionIndex}:${h.key}`;
  const cur = currentStyle(h.section, h.el);
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Size for ${tag}: ${preview.textContent.slice(0, 40)}`);
  const sizes = sizesFor(tag);
  const value = pendingSizes.has(id) ? pendingSizes.get(id) : cur.size;
  const options = value && !sizes.includes(value) ? [...sizes, value] : sizes;
  select.append(new Option('Default size', ''), ...options.map((size) => new Option(size, size)));
  select.value = value;
  let selectedSize = select.value;
  const remove = document.createElement('button');
  remove.className = 'remove-class';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove applied size from ${tag}`);
  remove.title = 'Remove applied size';
  remove.disabled = !select.value;
  if (locked) {
    wrap.classList.add('is-locked');
    select.disabled = true;
    remove.disabled = true;
  }
  remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22.719 12A10.719 10.719 0 0 1 1.28 12h.838a9.916 9.916 0 1 0 1.373-5H8v1H2V2h1v4.2A10.71 10.71 0 0 1 22.719 12z"/></svg>';
  const save = async (size) => {
    pendingSizes.set(id, size);
    setLoading(true);
    try {
      await setHeadingSize(sdk, h, size);
      selectedSize = size;
      pendingSizes.set(id, size);
      remove.disabled = !size;
      status.textContent = size ? `Saved ${target}` : `Removed applied size from ${target}`;
    } catch (e) {
      log('save error', e);
      status.textContent = e.message;
      pendingSizes.set(id, selectedSize);
      select.value = selectedSize;
    } finally {
      setLoading(false);
    }
  };
  select.addEventListener('change', () => save(select.value));
  remove.addEventListener('click', () => { select.value = ''; save(''); });
  controls.append(select, remove);
  wrap.append(content, controls);
  return wrap;
}

function paragraphAllControl(sectionIndex, paragraphs, ui) {
  const {
    sdk, status, setLoading, pendingSizes, paragraphAll, rerender,
  } = ui;
  const item = document.createElement('li');
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  const controls = document.createElement('div');
  const select = document.createElement('select');
  item.className = 'tree-group';
  wrap.className = 'tree-item apply-all-row';
  label.className = 'apply-all-label';
  checkbox.type = 'checkbox';
  label.append(checkbox, 'Apply to all Paragraphs');
  controls.className = 'tree-item-controls';
  const common = paragraphAllSize(paragraphs, pendingSizes);
  const value = paragraphAll.get(sectionIndex) || common;
  checkbox.checked = paragraphAll.has(sectionIndex)
    || paragraphAllEnabled(paragraphs[0]?.section);
  const sizes = sizesFor('p');
  const options = value && !sizes.includes(value) ? [...sizes, value] : sizes;
  const placeholder = new Option('Default size', '');
  placeholder.disabled = true;
  select.append(placeholder, ...options.map((size) => new Option(size, size)));
  select.value = value;
  select.disabled = !checkbox.checked;
  select.setAttribute('aria-label', `Size for all paragraphs in section ${sectionIndex}`);

  const apply = async (size) => {
    const ids = paragraphs.map((h) => `${h.sectionIndex}:${h.key}`);
    const previous = new Map(ids.filter((id) => pendingSizes.has(id))
      .map((id) => [id, pendingSizes.get(id)]));
    ids.forEach((id) => pendingSizes.set(id, size));
    setLoading(true);
    try {
      const count = await setHeadingSizes(sdk, paragraphs, size);
      status.textContent = `Applied ${size} to ${count} P in section ${sectionIndex}`;
    } catch (e) {
      log('apply all error', e);
      status.textContent = e.message;
      ids.forEach((id) => {
        if (previous.has(id)) pendingSizes.set(id, previous.get(id));
        else pendingSizes.delete(id);
      });
    } finally {
      setLoading(false);
      rerender();
    }
  };
  checkbox.addEventListener('change', async () => {
    if (!checkbox.checked) {
      const ids = paragraphs.map((h) => `${h.sectionIndex}:${h.key}`);
      paragraphAll.delete(sectionIndex);
      setLoading(true);
      try {
        await setParagraphAllEnabled(sdk, sectionIndex, false);
        clearParagraphAllStyles(paragraphs[0].section);
        ids.forEach((id) => pendingSizes.delete(id));
        status.textContent = `Disabled apply to all paragraphs in section ${sectionIndex}`;
      } catch (e) {
        log('disable apply all error', e);
        status.textContent = e.message;
        paragraphAll.set(sectionIndex, common);
      } finally {
        setLoading(false);
        rerender();
      }
      return;
    }
    paragraphAll.set(sectionIndex, select.value);
    setLoading(true);
    try {
      await setParagraphAllEnabled(sdk, sectionIndex, true);
    } catch (e) {
      log('enable apply all error', e);
      status.textContent = e.message;
      paragraphAll.delete(sectionIndex);
      checkbox.checked = false;
      setLoading(false);
      return;
    }
    setLoading(false);
    if (select.value) apply(select.value);
    else rerender();
  });
  select.addEventListener('change', () => {
    paragraphAll.set(sectionIndex, select.value);
    apply(select.value);
  });
  controls.append(select);
  wrap.append(label, controls);
  item.append(wrap);
  return item;
}

function render(list, tree, sdk, status, setLoading, selectionChanged, pendingSizes, paragraphAll) {
  if (!tree.length) {
    const empty = document.createElement('li');
    empty.className = 'tree-empty-state';
    empty.textContent = 'Add content to use the plugin.';
    list.replaceChildren(empty);
    return;
  }
  // eslint-disable-next-line max-len
  const rerender = () => render(list, tree, sdk, status, setLoading, false, pendingSizes, paragraphAll);
  const expanded = new Map([...list.querySelectorAll('.tree-section-details')]
    .map((details) => [Number(details.dataset.sectionIndex), details.open]));
  const card = document.createElement('li');
  const header = document.createElement('div');
  const title = document.createElement('div');
  const actions = document.createElement('div');
  const treeList = document.createElement('ul');
  const toggleAll = document.createElement('button');
  header.className = 'tree-header';
  title.className = 'tree-title';
  title.textContent = 'Content tree';
  actions.className = 'tree-actions';
  toggleAll.className = 'da-ds-button da-ds-button-secondary tree-toggle';
  toggleAll.type = 'button';
  treeList.className = 'content-tree';
  const updateToggle = () => {
    const sections = [...treeList.querySelectorAll('.tree-section-details')];
    const allExpanded = sections.length > 0 && sections.every((d) => d.open);
    toggleAll.setAttribute('aria-expanded', String(allExpanded));
    const lbl = `${allExpanded ? 'Collapse' : 'Expand'} all sections`;
    toggleAll.setAttribute('aria-label', lbl);
    toggleAll.title = lbl;
  };
  toggleAll.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
  toggleAll.addEventListener('click', () => {
    const sections = [...treeList.querySelectorAll('.tree-section-details')];
    const open = sections.some((d) => !d.open);
    sections.forEach((d) => { d.open = open; });
    updateToggle();
  });
  actions.append(toggleAll);
  header.append(title, actions);
  tree.forEach(({ sectionIndex, groups }) => {
    const sectionItem = document.createElement('li');
    const sectionDetails = document.createElement('details');
    const sectionName = document.createElement('summary');
    const sectionLabel = document.createElement('span');
    const sectionChevron = document.createElement('span');
    const groupList = document.createElement('ul');
    sectionItem.className = 'tree-section';
    sectionDetails.className = 'tree-section-details';
    sectionDetails.dataset.sectionIndex = sectionIndex;
    sectionDetails.addEventListener('toggle', updateToggle);
    const selected = groups.some((g) => g.elements.some((e) => e.selected));
    sectionDetails.open = expanded.has(sectionIndex)
      ? (expanded.get(sectionIndex) || (selectionChanged && selected))
      : selected;
    sectionName.className = 'tree-section-title';
    sectionLabel.textContent = `Section ${sectionIndex}`;
    sectionChevron.className = 'tree-section-chevron';
    sectionChevron.setAttribute('aria-hidden', 'true');
    sectionChevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
    groupList.className = 'tree-groups';
    const sectionElements = groups.flatMap((g) => g.elements);
    const resetSection = document.createElement('button');
    resetSection.className = 'da-ds-button da-ds-button-secondary reset-section';
    resetSection.type = 'button';
    resetSection.textContent = 'Reset all';
    resetSection.setAttribute('aria-label', `Remove all applied sizes in section ${sectionIndex}`);
    resetSection.disabled = !sectionElements.some((h) => {
      const id = `${h.sectionIndex}:${h.key}`;
      return pendingSizes.has(id) ? pendingSizes.get(id) : currentStyle(h.section, h.el).size;
    });
    resetSection.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = sectionElements.map((h) => `${h.sectionIndex}:${h.key}`);
      const previous = new Map(ids.filter((id) => pendingSizes.has(id))
        .map((id) => [id, pendingSizes.get(id)]));
      ids.forEach((id) => pendingSizes.set(id, ''));
      paragraphAll.delete(sectionIndex);
      setLoading(true);
      try {
        await clearHeadingSizes(sdk, sectionElements);
        status.textContent = `Removed all applied sizes from section ${sectionIndex}`;
      } catch (err) {
        log('reset section error', err);
        status.textContent = err.message;
        ids.forEach((id) => {
          if (previous.has(id)) pendingSizes.set(id, previous.get(id));
          else pendingSizes.delete(id);
        });
      } finally {
        setLoading(false);
        rerender();
      }
    });
    sectionName.append(sectionLabel, resetSection, sectionChevron);
    const paragraphs = sectionElements.filter((h) => h.el.tagName === 'P');
    const paragraphsLocked = paragraphAll.has(sectionIndex)
      || paragraphAllEnabled(paragraphs[0]?.section);
    if (paragraphs.length) {
      groupList.append(paragraphAllControl(sectionIndex, paragraphs, {
        sdk, status, setLoading, pendingSizes, paragraphAll, rerender,
      }));
    }
    groups.forEach(({ title: groupTitle, elements }) => {
      const groupItem = document.createElement('li');
      const groupName = document.createElement('div');
      const elementList = document.createElement('ul');
      groupItem.className = 'tree-group';
      groupName.className = 'tree-group-title';
      groupName.textContent = groupTitle;
      elementList.className = 'tree-elements';
      elements.forEach((h) => {
        const elementItem = document.createElement('li');
        const locked = paragraphsLocked && h.el.tagName === 'P';
        elementItem.append(headingControl(h, sdk, status, setLoading, pendingSizes, locked));
        elementList.append(elementItem);
      });
      groupItem.append(groupName, elementList);
      groupList.append(groupItem);
    });
    sectionDetails.append(sectionName, groupList);
    sectionItem.append(sectionDetails);
    treeList.append(sectionItem);
  });
  updateToggle();
  card.append(header, treeList);
  list.replaceChildren(card);
}

function readSelection(actions) {
  return Promise.race([
    actions.getSelection().catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), TIMEOUT_MS); }),
  ]);
}

function liveTreeDoc(liveHtml, sourceDoc) {
  const doc = new DOMParser().parseFromString(liveHtml, 'text/html');
  const liveSections = [...doc.querySelectorAll('main > div')];
  const sourceSections = [...sourceDoc.querySelectorAll('main > div')];
  if (liveSections.length !== sourceSections.length) return doc;
  liveSections.forEach((section, i) => {
    const liveMeta = section.querySelector(':scope > .section-metadata');
    if (!liveMeta) {
      const sourceMeta = sourceSections[i].querySelector(':scope > .section-metadata');
      if (sourceMeta) section.append(doc.importNode(sourceMeta, true));
    }
    syncLiveSectionStyles(section, section);
  });
  return doc;
}

export default async function init() {
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  const loading = document.getElementById('loading');
  const setLoading = (visible) => {
    loading.hidden = !visible;
    loading.setAttribute('aria-hidden', String(!visible));
  };
  const sdk = await DA_SDK;
  log('SDK ready', sdk.context, Object.keys(sdk.actions));

  // Undefined until first config read; the tree stays empty until then.
  let editableBlocks;
  let selection = null;
  let lastChange = 0;
  let sourceDoc;
  let sourceText;
  let liveHtml = null;
  const pendingSizes = new Map();
  const paragraphAll = new Map();

  const update = (selectionChanged) => {
    if (!sourceDoc || editableBlocks === undefined) return;
    const doc = liveHtml ? liveTreeDoc(liveHtml, sourceDoc) : sourceDoc;
    const tree = contentTree(selection, doc, editableBlocks);
    render(list, tree, sdk, status, setLoading, selectionChanged, pendingSizes, paragraphAll);
    if (editableBlocks?.size === 0) {
      status.textContent = 'No blocks are editable. List them in the include column of the library config, or use "all".';
    } else if (selection === null) {
      status.textContent = tree.length ? 'Select content in the document.' : '';
    }
  };

  let sourceBusy = false;
  const checkSource = async () => {
    if (sourceBusy || document.hidden) return;
    sourceBusy = true;
    try {
      const fresh = await loadSource(sdk);
      if (!fresh) { status.textContent = 'Unable to refresh the source. Retrying...'; return; }
      if (fresh.text === sourceText) return;
      lastChange = Date.now();
      sourceDoc = fresh.doc;
      if (sourceText !== undefined) { liveHtml = null; paragraphAll.clear(); }
      const sections = [...sourceDoc.querySelectorAll('main > div')];
      pendingSizes.forEach((size, id) => {
        const [sectionIndex, key] = id.split(':');
        const section = sections[Number(sectionIndex) - 1];
        const el = section && [...section.querySelectorAll('h1,h2,h3,h4,h5,h6,p')]
          .find((candidate) => headingInfo(candidate).key === key);
        if (!el || currentStyle(section, el).size === size) pendingSizes.delete(id);
      });
      update(false);
      sourceText = fresh.text;
    } catch (e) {
      log('source error', e);
    } finally {
      sourceBusy = false;
    }
  };
  const watchSource = async () => {
    await checkSource();
    setTimeout(watchSource, Date.now() - lastChange < ACTIVE_WINDOW_MS
      ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
  };
  watchSource();

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
  document.addEventListener('visibilitychange', checkConfig);

  if (sdk.capabilities?.liveDocument && sdk.actions.subscribeLiveDocument) {
    sdk.actions.subscribeLiveDocument(({ html }) => {
      if (html === liveHtml) return;
      liveHtml = html;
      lastChange = Date.now();
      try { update(false); } catch (e) { log('live document error', e); }
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
