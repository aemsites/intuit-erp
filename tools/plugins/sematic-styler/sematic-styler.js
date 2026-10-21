import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { SIZES } from '../../scripts/heading-key.js';
import {
  headingInfo, currentStyle, setHeadingSize, repairAll, removeOrphan,
} from './heading-styler.js';

const POLL_MS = 1000;
const TIMEOUT_MS = 900;
const TREE_REFRESH_MS = 3000;
const ROLES = {
  h1: 'heading 1', h2: 'heading 2', h3: 'heading 3', h4: 'heading 4', h5: 'heading 5', h6: 'heading 6',
  p: 'paragraph', a: 'link', img: 'image', picture: 'image', ul: 'bulleted list', ol: 'numbered list',
  li: 'list item', strong: 'bold', em: 'italic',
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
  const resp = await actions.daFetch(`https://admin.da.live/source/${context.org}/${context.repo}${path}.html`);
  if (!resp.ok) {
    log('source fetch failed', resp.status);
    return null;
  }
  return new DOMParser().parseFromString(await resp.text(), 'text/html');
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

function contentTree(html, doc) {
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
      if (child.classList.contains('section-metadata')) return;
      const block = child.matches('div[class]') ? child : null;
      const elements = [
        ...(child.matches('h1,h2,h3,h4,h5,h6,p') ? [child] : []),
        ...child.querySelectorAll('h1,h2,h3,h4,h5,h6,p'),
      ].filter((el) => !el.closest('.section-metadata')
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
  });
}

function headingControl(h, sdk, status, setLoading) {
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
  const cur = currentStyle(h.section, h.el);
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Size for ${tag}: ${preview.textContent.slice(0, 40)}`);
  select.append(new Option('Default size', ''), ...SIZES.map((size) => new Option(size, size)));
  select.value = cur.size;
  let selectedSize = cur.size;
  const remove = document.createElement('button');
  remove.className = 'remove-class';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove applied size from ${tag}`);
  remove.title = 'Remove applied size';
  remove.disabled = !cur.size;
  remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.75h4V4m2 0-.5 9H4.5L4 4m2.5 2v5m3-5v5"/></svg>';
  const save = async (size) => {
    setLoading(true);
    try {
      await setHeadingSize(sdk, h, size);
      selectedSize = size;
      remove.disabled = !size;
      status.textContent = size ? `Saved ${target}` : `Removed applied size from ${target}`;
    } catch (e) {
      log('save error', e);
      status.textContent = e.message;
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

function render(list, tree, sdk, status, setLoading, selectionChanged) {
  if (!tree.length) { list.replaceChildren(); return; }
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
    sectionDetails.open = expanded.has(sectionIndex)
      ? (selectionChanged ? expanded.get(sectionIndex) || selected : expanded.get(sectionIndex))
      : selected;
    sectionName.className = 'tree-section-title';
    sectionLabel.textContent = `Section ${sectionIndex}`;
    sectionChevron.className = 'tree-section-chevron';
    sectionChevron.setAttribute('aria-hidden', 'true');
    sectionChevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
    sectionName.append(sectionLabel, sectionChevron);
    groupList.className = 'tree-groups';
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
        elementItem.append(headingControl(h, sdk, status, setLoading));
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

// getSelection never settles when the selection is empty, so race it with a timeout.
function readSelection(actions) {
  return Promise.race([
    actions.getSelection(),
    new Promise((resolve) => { setTimeout(() => resolve(null), TIMEOUT_MS); }),
  ]);
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

  let lastSelection;
  let lastTreeRefresh = 0;
  let sourceDoc;
  let busy = false;
  setInterval(async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const html = await readSelection(sdk.actions);
      const selectionChanged = html !== lastSelection;
      if (selectionChanged) lastSelection = html;
      const refreshSource = !sourceDoc || Date.now() - lastTreeRefresh >= TREE_REFRESH_MS;
      if (!selectionChanged && !refreshSource) return;
      if (refreshSource) {
        const freshDoc = await loadSource(sdk);
        lastTreeRefresh = Date.now();
        if (freshDoc) sourceDoc = freshDoc;
        else {
          status.textContent = 'Unable to refresh the source. Retrying...';
          if (!sourceDoc) return;
        }
      }
      const tree = contentTree(html, sourceDoc);
      log('selection and document tree', { html, tree });
      render(list, tree, sdk, status, setLoading, selectionChanged);
      if (html === null) status.textContent = 'Select content in the document.';
      else status.textContent = tree.length ? 'Content tree loaded' : 'No sections found.';
    } catch (e) {
      log('error', e);
    } finally {
      busy = false;
    }
  }, POLL_MS);
}

init();
