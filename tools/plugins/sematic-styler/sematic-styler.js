import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { SIZES } from '../../scripts/heading-key.js';
import {
  headingInfo, currentStyle, setHeadingSize, repairAll, removeOrphan,
} from './heading-styler.js';

const POLL_MS = 1000;
const TIMEOUT_MS = 900;
const MAX_HITS = 5;
const ROLES = {
  h1: 'heading 1', h2: 'heading 2', h3: 'heading 3', h4: 'heading 4', h5: 'heading 5', h6: 'heading 6',
  p: 'paragraph', a: 'link', img: 'image', picture: 'image', ul: 'bulleted list', ol: 'numbered list',
  li: 'list item', strong: 'bold', em: 'italic',
};

// eslint-disable-next-line no-console
const log = (...args) => console.log('[sematic-styler]', ...args);
const compact = (s) => s.replace(/\s+/g, '');

function blockLabel(block) {
  const [name, ...variants] = [...block.classList];
  return variants.length ? `${name} (${variants.join(', ')})` : name;
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

function findEnclosingBlocks(doc, text) {
  const needle = compact(text);
  if (!needle) return [];
  const sections = [...doc.querySelectorAll('main > div')];
  return [...doc.querySelectorAll('main > div > div[class]')]
    .filter((b) => compact(b.textContent).includes(needle))
    .map((b) => ({ label: blockLabel(b), section: sections.indexOf(b.parentElement) + 1 }));
}

const nth = (el) => [...el.parentElement.children].indexOf(el) + 1;

// Source layout: main > section > block > row > cell > element (default content has no block).
function positionOf(el) {
  const section = el.closest('main > div');
  if (!section) return 'outside any section';
  const parts = [`section ${nth(section)}`];
  const block = el.closest('main > div > div[class]');
  if (block) {
    parts.push(`block ${blockLabel(block)} (#${nth(block)} in section)`);
    const row = el.closest('main > div > div[class] > div');
    const cell = el.closest('main > div > div[class] > div > div');
    if (row && cell) parts.push(`row ${nth(row)}`, `col ${nth(cell)}`);
  } else {
    parts.push('default content');
  }
  const parent = el.parentElement;
  parts.push(`child ${nth(el)} of ${parent.children.length} in <${parent.tagName.toLowerCase()}>`);
  return parts.join(' › ');
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

function buildRows(html, blocks, doc) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const rows = [];
  if (blocks.length) {
    const detail = blocks.map((b) => `${b.label} · section ${b.section}`).join('\n');
    rows.push({ title: [...new Set(blocks.map((b) => b.label))].join(', '), detail, isScope: true });
  } else if (body.textContent.trim()) {
    rows.push({ title: 'Default content', detail: 'Selection is outside a block.', isScope: true });
  }
  // The editor only returns the selected content, so positions come from the saved source.
  const nodes = describeContainer(body).map((n) => {
    const hits = doc ? findElements(doc, n) : [];
    if (!hits.length) return n;
    const label = hits.length > 1 ? `position (${hits.length} matches)` : 'position';
    const lines = hits.slice(0, MAX_HITS).map(positionOf).join('\n');
    const headings = hits.slice(0, MAX_HITS).filter((e) => /^(H[1-6]|P)$/.test(e.tagName)).map(headingInfo);
    return { ...n, detail: `${n.detail}\n${label}: ${lines}`, headings };
  });
  return [...rows, ...nodes];
}

function headingControl(h, sdk, status, setLoading) {
  const wrap = document.createElement('label');
  wrap.className = 'size';
  const target = h.block ? `${h.blockName} \u00b7 ${h.position}` : `default content \u00b7 ${h.defaultPosition}`;
  wrap.append(`${target} `);
  const cur = currentStyle(h.section, h.el);
  const select = document.createElement('select');
  select.append(new Option('no size', ''), ...SIZES.map((s) => new Option(s, s)));
  select.value = cur.size;
  const save = async () => {
    setLoading(true);
    try {
      await setHeadingSize(sdk, h, select.value);
      status.textContent = `Saved ${target}`;
    } catch (e) {
      log('save error', e);
      status.textContent = e.message;
    } finally {
      setLoading(false);
    }
  };
  select.addEventListener('change', save);
  wrap.append(select);
  return wrap;
}

function render(list, rows, sdk, status, setLoading) {
  const card = document.createElement('li');
  const title = document.createElement('div');
  const disclosure = document.createElement('details');
  const summary = document.createElement('summary');
  const scope = rows.find((row) => row.isScope);
  title.className = 'role';
  title.textContent = scope ? scope.title : 'Default content';
  disclosure.className = 'result-details';
  disclosure.open = true;
  summary.textContent = 'Show selection details';
  disclosure.append(summary);

  rows.filter((row) => row !== scope).forEach(({ title: nodeTitle, detail, headings = [] }) => {
    const group = document.createElement('div');
    const heading = document.createElement('div');
    group.className = 'detail-group';
    heading.className = 'role';
    heading.textContent = nodeTitle;
    group.append(heading);
    if (detail) {
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = detail;
      group.append(text);
    }
    group.append(...headings.map((h) => headingControl(h, sdk, status, setLoading)));
    disclosure.append(group);
  });

  if (scope?.detail) {
    const text = document.createElement('div');
    text.className = 'text detail-group';
    text.textContent = scope.detail;
    disclosure.append(text);
  }
  card.append(title, disclosure);
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

  let last;
  let busy = false;
  setInterval(async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const html = await readSelection(sdk.actions);
      if (html === last) return;
      last = html;
      if (html === null) {
        log('no selection');
        list.replaceChildren();
        status.textContent = 'Select content in the document.';
        return;
      }
      const text = new DOMParser().parseFromString(html, 'text/html').body.textContent;
      const doc = await loadSource(sdk);
      const blocks = doc ? findEnclosingBlocks(doc, text) : [];
      const rows = buildRows(html, blocks, doc);
      log('selection', { html, blocks, rows });
      render(list, rows, sdk, status, setLoading);
      status.textContent = 'Selection found';
    } catch (e) {
      log('error', e);
    } finally {
      busy = false;
    }
  }, POLL_MS);
}

init();

