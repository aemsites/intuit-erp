// eslint-disable-next-line import/no-unresolved -- SDK is loaded directly from DA's hosted module.
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { sizesFor } from '../../../scripts/heading-key.js';
import {
  headingInfo, currentStyle, setHeadingSize, setHeadingSizes, clearHeadingSizes, repairAll,
  removeOrphan,
} from './heading-styler.js';

const POLL_MS = 1000;
const TIMEOUT_MS = 900;
// DA persists editor changes to the source with a delay, so check the source more often for a
// while after any change is seen, and back off once the page is idle.
const ACTIVE_REFRESH_MS = 2000;
const IDLE_REFRESH_MS = 3000;
const ACTIVE_WINDOW_MS = 10000;
const CONFIG_REFRESH_MS = 10000;
// The library sheet row that registers this plugin in the site config.
const PLUGIN_ROW = /sem(?:an)?tic[\s-]*styler/i;
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
  const name = [...block.classList]
    .find((className) => !/^(?:h[1-6]|p)(?:-\d+)?-(?:size|as)-/.test(className)) || 'block';
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

function describeNode(el) {
  const tag = el.tagName.toLowerCase();
  const full = el.textContent.trim();
  return {
    title: `${ROLES[tag] || tag} <${tag}>`, detail: full.slice(0, 80), tag, full,
  };
}

// Selections inside a block come back wrapped in a table, so report the cell contents instead.
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
  // A name row only exists when the whole block (header + content) is selected.
  const hasName = rows.length > 1 && first?.length === 1;
  const out = hasName ? [{ title: `block: ${first[0].textContent.trim()}`, detail: '' }] : [];
  rows.slice(hasName ? 1 : 0).forEach((row) => {
    row.querySelectorAll('td, th').forEach((cell) => out.push(...describeContainer(cell)));
  });
  return out;
}

async function loadSource({ actions, context }) {
  const path = (context.path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/index';
  const resp = await actions.daFetch(`https://admin.da.live/source/${context.org}/${context.repo}${path}.html`, { cache: 'no-store' });
  if (!resp.ok) {
    log('source fetch failed', resp.status);
    return null;
  }
  const text = await resp.text();
  return { text, doc: new DOMParser().parseFromString(text, 'text/html') };
}

// `Cards (wide)` -> `cards`: variants don't matter, only the block name.
const blockName = (name) => name.replace(/\(.*\)/, '').trim().toLowerCase().replace(/\s+/g, '-');

/**
 * Block names listed in the `include` column of this plugin's row in the site config's
 * `library` sheet (the one with `title`, `path` and `ref`). Only those blocks are editable.
 * Returns null, leaving every block editable, when the column is empty, and undefined when the
 * config can't be read so callers can retry instead of briefly showing every block.
 */
async function loadEditableBlocks({ actions, context }) {
  try {
    const resp = await actions.daFetch(`https://admin.da.live/config/${context.org}/${context.repo}/`, { cache: 'no-store' });
    if (!resp.ok) {
      log('config fetch failed', resp.status);
      return undefined;
    }
    const config = await resp.json();
    // Sheet names and column headers keep the author's casing, so match them case-insensitively.
    const sheet = Object.entries(config).find(([name]) => name.toLowerCase() === 'library')?.[1];
    const rows = (sheet?.data || []).map((r) => Object.fromEntries(Object.entries(r)
      .map(([k, v]) => [k.trim().toLowerCase(), v])));
    const row = rows.find((r) => PLUGIN_ROW.test(`${r.path || ''} ${r.ref || ''} ${r.title || ''}`));
    if (!row) log('no library row for this plugin', { sheets: Object.keys(config), rows });
    const include = String(row?.include ?? '').split(/[,\n]/).map(blockName).filter(Boolean);
    return include.length ? new Set(include) : null;
  } catch (e) {
    log('config error', e);
    return undefined;
  }
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
  // Plain text: keep the deepest elements only.
  return hits.filter((e) => ![...e.children].some((c) => hits.includes(c)));
}

function contentTree(html, doc, editableBlocks) {
  if (!doc) return [];
  const body = html ? new DOMParser().parseFromString(html, 'text/html').body : null;
  const selectedKeys = new Set(body ? describeContainer(body)
    .flatMap((node) => findElements(doc, node))
    .filter((el) => /^(H[1-6]|P)$/.test(el.tagName))
    .map((el) => headingInfo(el).key) : []);
  const sections = [...doc.querySelectorAll('main > div')];
  return sections.map((section, index) => {
    const groups = [];
    [...section.children].forEach((child) => {
      if (child.classList.contains('section-metadata', 'metadata', 'library-metadata')) return;
      const block = child.matches('div[class]') ? child : null;
      // With an `include` list only those blocks are editable, so default content is left out too.
      // The first class of a source block is its name; the rest are variants.
      if (editableBlocks && !(block && editableBlocks.has(block.classList[0]))) return;
      const elements = [
        ...(child.matches('h1,h2,h3,h4,h5,h6,p') ? [child] : []),
        ...child.querySelectorAll('h1,h2,h3,h4,h5,h6,p'),
      ].filter((el) => !el.closest('section-metadata', 'metadata', 'library-metadata')
        && (block || !el.closest('main > div > div[class]')));
      if (block) {
        groups.push({
          title: blockLabel(block),
          elements: elements.map((el) => {
            const heading = headingInfo(el);
            return { ...heading, selected: selectedKeys.has(heading.key) };
          }),
        });
      } else if (elements.length) {
        groups.push({
          title: 'Default content',
          elements: elements.map((el) => {
            const heading = headingInfo(el);
            return { ...heading, selected: selectedKeys.has(heading.key) };
          }),
        });
      }
    });
    return { sectionIndex: index + 1, groups };
  }).filter(({ groups }) => !editableBlocks || groups.length);
}

function headingControl(h, sdk, status, setLoading, pendingSizes, peers, rerender) {
  const wrap = document.createElement('div');
  const content = document.createElement('div');
  const name = document.createElement('div');
  const preview = document.createElement('div');
  const controls = document.createElement('div');
  const tag = h.el.tagName.toLowerCase();
  const target = h.block ? `${h.blockName} \u00b7 ${h.position}` : `default content \u00b7 ${h.defaultPosition}`;
  wrap.className = h.selected ? 'tree-item is-selected' : 'tree-item';
  if (h.selected) wrap.setAttribute('aria-current', 'true');
  content.className = 'tree-item-content';
  name.className = 'tree-item-title';
  name.textContent = `${tag.toUpperCase()} \u00b7 ${target}`;
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
  // Keep a size from before the current scale (e.g. `p-size-m`) visible instead of hiding it.
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
  remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22.719 12A10.719 10.719 0 0 1 1.28 12h.838a9.916 9.916 0 1 0 1.373-5H8v1H2V2h1v4.2A10.71 10.71 0 0 1 22.719 12z"/></svg>';
  const applyAll = document.createElement('button');
  applyAll.className = 'apply-all';
  applyAll.type = 'button';
  const tagLabel = tag.toUpperCase();
  applyAll.setAttribute('aria-label', `Apply this size to every ${tagLabel} in this section`);
  applyAll.title = `Apply to all ${tagLabel}s in this section`;
  applyAll.disabled = !select.value;
  applyAll.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24">'
    + '<path d="M4 7h11M4 12h11M4 17h7M15 16l3 3 5-6"/></svg>';
  const save = async (size) => {
    pendingSizes.set(id, size);
    setLoading(true);
    try {
      await setHeadingSize(sdk, h, size);
      selectedSize = size;
      pendingSizes.set(id, size);
      remove.disabled = !size;
      applyAll.disabled = !size;
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
  applyAll.addEventListener('click', async () => {
    const size = select.value;
    if (!size) return;
    const ids = peers.map((peer) => `${peer.sectionIndex}:${peer.key}`);
    const previous = new Map(ids.filter((peerId) => pendingSizes.has(peerId))
      .map((peerId) => [peerId, pendingSizes.get(peerId)]));
    ids.forEach((peerId) => pendingSizes.set(peerId, size));
    setLoading(true);
    try {
      const count = await setHeadingSizes(sdk, peers, size);
      status.textContent = `Applied ${size} to ${count} ${tagLabel} in section ${h.sectionIndex}`;
    } catch (e) {
      log('apply all error', e);
      status.textContent = e.message;
      ids.forEach((peerId) => {
        if (previous.has(peerId)) pendingSizes.set(peerId, previous.get(peerId));
        else pendingSizes.delete(peerId);
      });
    } finally {
      setLoading(false);
      rerender();
    }
  });
  controls.append(select, remove, applyAll);
  wrap.append(content, controls);
  return wrap;
}

function render(list, tree, sdk, status, setLoading, selectionChanged, pendingSizes) {
  if (!tree.length) { list.replaceChildren(); return; }
  const rerender = () => render(list, tree, sdk, status, setLoading, false, pendingSizes);
  const expanded = new Map([...list.querySelectorAll('.tree-section-details')]
    .map((details) => [Number(details.dataset.sectionIndex), details.open]));
  const card = document.createElement('li');
  const title = document.createElement('div');
  const treeList = document.createElement('ul');
  title.className = 'tree-title';
  title.textContent = 'Content tree';
  treeList.className = 'content-tree';
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
    const selected = groups.some((group) => group.elements.some((element) => element.selected));
    if (expanded.has(sectionIndex)) {
      sectionDetails.open = expanded.get(sectionIndex);
      if (selectionChanged && selected) sectionDetails.open = true;
    } else {
      sectionDetails.open = selected;
    }
    sectionName.className = 'tree-section-title';
    sectionLabel.textContent = `Section ${sectionIndex}`;
    sectionChevron.className = 'tree-section-chevron';
    sectionChevron.setAttribute('aria-hidden', 'true');
    sectionChevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
    groupList.className = 'tree-groups';
    const sectionElements = groups.flatMap((group) => group.elements);
    const resetSection = document.createElement('button');
    resetSection.className = 'da-ds-button da-ds-button-secondary reset-section';
    resetSection.type = 'button';
    resetSection.textContent = 'Reset all';
    resetSection.setAttribute('aria-label', `Remove all applied sizes in section ${sectionIndex}`);
    resetSection.disabled = !sectionElements.some((h) => {
      const id = `${h.sectionIndex}:${h.key}`;
      return pendingSizes.has(id) ? pendingSizes.get(id) : currentStyle(h.section, h.el).size;
    });
    // The button sits in the summary, so keep its clicks from toggling the section.
    resetSection.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = sectionElements.map((h) => `${h.sectionIndex}:${h.key}`);
      const previous = new Map(ids.filter((id) => pendingSizes.has(id))
        .map((id) => [id, pendingSizes.get(id)]));
      ids.forEach((id) => pendingSizes.set(id, ''));
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
        const peers = sectionElements.filter((peer) => peer.el.tagName === h.el.tagName);
        elementItem.append(
          headingControl(h, sdk, status, setLoading, pendingSizes, peers, rerender),
        );
        elementList.append(elementItem);
      });
      groupItem.append(groupName, elementList);
      groupList.append(groupItem);
    });
    sectionDetails.append(sectionName, groupList);
    sectionItem.append(sectionDetails);
    treeList.append(sectionItem);
  });
  card.append(title, treeList);
  list.replaceChildren(card);
}

function renderOrphans(list, orphans, sdk, status, setLoading) {
  const card = document.createElement('li');
  const title = document.createElement('div');
  const disclosure = document.createElement('details');
  const summary = document.createElement('summary');
  title.className = 'role';
  title.textContent = `Orphaned heading keys (${orphans.length})`;
  disclosure.className = 'result-details';
  disclosure.open = true;
  summary.textContent = 'Show keys and actions';
  disclosure.append(summary);
  orphans.forEach((orphan) => {
    const row = document.createElement('div');
    const label = document.createElement('div');
    const button = document.createElement('button');
    row.className = 'orphan-row';
    label.className = 'role';
    label.textContent = `Section ${orphan.sectionIndex}: ${orphan.key}`;
    button.className = 'da-ds-button da-ds-button-secondary';
    button.textContent = 'Remove key';
    button.addEventListener('click', async () => {
      setLoading(true);
      try {
        await removeOrphan(sdk, orphan);
        row.remove();
        if (!disclosure.querySelector('.orphan-row')) card.remove();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        setLoading(false);
      }
    });
    row.append(label, button);
    disclosure.append(row);
  });
  card.append(title, disclosure);
  list.replaceChildren(card);
}

// Older hosts never settle getSelection on an empty selection and newer ones reject, so treat
// both as "nothing selected".
function readSelection(actions) {
  return Promise.race([
    actions.getSelection().catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), TIMEOUT_MS); }),
  ]);
}

// The canvas host pushes the editor's live HTML in its preview form, which folds section
// metadata into section classes. Graft the source's section metadata back so sizes and heading
// keys still resolve; skip it while the section count differs and the source is catching up.
function liveTreeDoc(liveHtml, sourceDoc) {
  const doc = new DOMParser().parseFromString(liveHtml, 'text/html');
  const liveSections = [...doc.querySelectorAll('main > div')];
  const sourceSections = [...sourceDoc.querySelectorAll('main > div')];
  if (liveSections.length !== sourceSections.length) return doc;
  liveSections.forEach((section, i) => {
    const meta = sourceSections[i].querySelector(':scope > .section-metadata');
    if (meta) section.append(doc.importNode(meta, true));
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
  // Undefined until the config has been read; the tree stays empty until then.
  let editableBlocks;
  log('SDK ready', sdk.context, Object.keys(sdk.actions));

  document.getElementById('repair').addEventListener('click', async () => {
    setLoading(true);
    try {
      const r = await repairAll(sdk);
      log('repair', r);
      status.textContent = `${r.cleaned.length} obsolete classes removed, `
        + `${r.rekeyed.length} re-keyed, ${r.orphaned.length} orphaned`;
      renderOrphans(list, r.orphaned, sdk, status, setLoading);
    } catch (e) {
      log('repair error', e);
      status.textContent = e.message;
    } finally {
      setLoading(false);
    }
  });

  let selection = null;
  let lastChange = 0;
  let sourceDoc;
  let sourceText;
  let liveHtml = null;
  const pendingSizes = new Map();

  const update = (selectionChanged) => {
    if (!sourceDoc || editableBlocks === undefined) return;
    const doc = liveHtml ? liveTreeDoc(liveHtml, sourceDoc) : sourceDoc;
    const tree = contentTree(selection, doc, editableBlocks);
    log('selection and document tree', { html: selection, tree });
    render(list, tree, sdk, status, setLoading, selectionChanged, pendingSizes);
    if (selection === null) status.textContent = 'Select content in the document.';
    else status.textContent = tree.length ? 'Content tree loaded' : 'No sections found.';
  };

  // Content watcher: re-keys headings and refreshes the tree whenever the source changes,
  // independent of the editor selection.
  let sourceBusy = false;
  const checkSource = async () => {
    if (sourceBusy || document.hidden) return;
    sourceBusy = true;
    try {
      const fresh = await loadSource(sdk);
      if (!fresh) {
        status.textContent = 'Unable to refresh the source. Retrying...';
        return;
      }
      if (fresh.text === sourceText) return;
      lastChange = Date.now();
      try {
        await repairAll(sdk, fresh.doc);
      } catch (e) {
        log('repair error', e);
      }
      sourceDoc = fresh.doc;
      const sections = [...sourceDoc.querySelectorAll('main > div')];
      pendingSizes.forEach((size, id) => {
        const [sectionIndex, key] = id.split(':');
        const section = sections[Number(sectionIndex) - 1];
        const el = section && [...section.querySelectorAll('h1,h2,h3,h4,h5,h6,p')]
          .find((candidate) => headingInfo(candidate).key === key);
        if (!el || currentStyle(section, el).size === size) pendingSizes.delete(id);
      });
      update(false);
      // Only mark the source as seen once rendered, so a failure retries on the next check.
      sourceText = fresh.text;
    } catch (e) {
      log('source error', e);
    } finally {
      sourceBusy = false;
    }
  };
  const watchSource = async () => {
    await checkSource();
    const active = Date.now() - lastChange < ACTIVE_WINDOW_MS;
    setTimeout(watchSource, active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
  };
  watchSource();

  // Config watcher: picks up `include` changes without reopening the plugin. Retries quickly
  // until the first read succeeds, since nothing is rendered before then.
  const watchConfig = async () => {
    if (!document.hidden) {
      const fresh = await loadEditableBlocks(sdk);
      const key = (set) => (set ? [...set].sort().join() : '');
      if (fresh !== undefined
        && (editableBlocks === undefined || key(fresh) !== key(editableBlocks))) {
        editableBlocks = fresh;
        log('editable blocks', editableBlocks ? [...editableBlocks] : 'all');
        update(false);
      }
    }
    setTimeout(watchConfig, editableBlocks === undefined ? POLL_MS : CONFIG_REFRESH_MS);
  };
  await watchConfig();

  // Live watcher: hosts that support it (the canvas editor) push the editor HTML on every edit,
  // so the tree follows typing instead of waiting for DA to save the source.
  if (sdk.capabilities?.liveDocument && sdk.actions.subscribeLiveDocument) {
    sdk.actions.subscribeLiveDocument(({ html }) => {
      if (html === liveHtml) return;
      liveHtml = html;
      lastChange = Date.now();
      try {
        update(false);
      } catch (e) {
        log('live document error', e);
      }
    });
  }
  log('live document', sdk.capabilities?.liveDocument ? 'subscribed' : 'not supported by this editor');

  // Selection watcher: highlights the selected content and checks the source right away.
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
