/* eslint-disable no-use-before-define */
// The preview/list/editor handlers intentionally call each other; keeping each
// section cohesive is clearer than ordering the file around handler references.
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  OVERRIDE_FIELDS,
  applyOverride,
  buildSheetFormData,
  findOverride,
  mergeOverride,
  validateOverride,
} from './model.js';

const DA_ADMIN = 'https://admin.da.live';
const LIVE_SOURCE = '/tracking.json';
const SANDBOX_SOURCE = '/drafts/tracking-editor-poc.json';
const TARGET_SELECTOR = '[data-track-as], a[href], button, summary, [role="button"]';

const FIELD_LABELS = {
  object: 'Object',
  'object-detail': 'Object detail',
  action: 'Action',
  'ui-object': 'UI object',
  'ui-object-detail': 'UI object detail',
  'ui-action': 'UI action',
  'wa-link': 'WA link / campaign code',
  'custom-properties': 'Custom properties',
  survey: 'Survey properties',
};

const app = document.getElementById('app');
const state = {
  sdk: null,
  path: '/',
  sheet: null,
  base: null,
  sandboxExists: false,
  inventory: [],
  selected: null,
  selectedElement: null,
  scope: '/',
  frame: null,
  inspector: null,
};

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  }
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  children.filter(Boolean).forEach((child) => node.appendChild(child));
  return node;
}

let statusEl;
function setStatus(text, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `tracking-status${kind ? ` tracking-status-${kind}` : ''}`;
}

function cleanPagePath(value) {
  const raw = String(value || '/').trim().split(/[?#]/)[0];
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

function sourceUrl(path) {
  const { org, repo } = state.sdk.context;
  return `${DA_ADMIN}/source/${org}/${repo}${path}`;
}

async function fetchSheet(path) {
  const response = await fetch(sourceUrl(path), {
    headers: { Authorization: `Bearer ${state.sdk.token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

async function putSheet(sheet, exists) {
  const response = await fetch(sourceUrl(SANDBOX_SOURCE), {
    method: exists ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${state.sdk.token}` },
    body: buildSheetFormData(sheet),
  });
  if (!response.ok) throw new Error(`Sandbox save failed (${response.status})`);
}

function pairsToText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Object.entries(value).map(([key, val]) => `${key}=${val}`).join('\n');
}

function displayValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return pairsToText(value) || '—';
  return String(value);
}

function inventoryKey(item, index) {
  if (item.id) return `${item.path}|${item.id}`;
  return `derived|${item.block}|${item.label}|${item.href}|${index}`;
}

function uniqueInventory(items) {
  const seen = new Set();
  return items.reduce((result, item, index) => {
    const key = inventoryKey(item, index);
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...item, editorKey: key });
    }
    return result;
  }, []);
}

function previewUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('tracking-editor', '1');
  url.searchParams.set('martech', 'off');
  return url.href;
}

function waitForInspector(frame) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts += 1;
      try {
        const inspector = frame.contentWindow?.hlx?.trackingInspector;
        if (inspector) {
          resolve(inspector);
          return;
        }
      } catch {
        reject(new Error('The rendered preview is not on the same branch origin as the editor.'));
        return;
      }
      if (attempts >= 80) {
        reject(new Error('The rendered page did not expose its tracking inventory.'));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

function clearPreviewHighlight() {
  if (state.selectedElement) state.selectedElement.classList.remove('tracking-editor-selected');
  state.selectedElement = null;
}

function highlightPreview(target) {
  clearPreviewHighlight();
  const candidate = target?.closest?.(TARGET_SELECTOR);
  if (!candidate) return;
  candidate.classList.add('tracking-editor-selected');
  state.selectedElement = candidate;
}

function bindPreviewSelection() {
  const doc = state.frame.contentDocument;
  if (!doc || doc.getElementById('tracking-editor-poc-style')) return;
  const style = doc.createElement('style');
  style.id = 'tracking-editor-poc-style';
  style.textContent = '.tracking-editor-selected{outline:4px solid #6d4aff!important;'
    + 'outline-offset:3px!important;}';
  doc.head.appendChild(style);
  doc.addEventListener('click', (event) => {
    const item = state.inspector.describe(event.target, state.sheet.data);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    highlightPreview(event.target);
    selectInventoryItem(item);
  }, true);
}

async function collectInventory() {
  state.inventory = uniqueInventory(state.inspector.collect(state.sheet.data));
  renderTargetList();
  if (state.selected?.id) {
    const refreshed = state.inventory.find((item) => item.id === state.selected.id);
    if (refreshed) selectInventoryItem(refreshed);
  }
}

async function loadPreview(path) {
  state.path = cleanPagePath(path);
  state.selected = null;
  clearPreviewHighlight();
  setStatus(`Loading rendered preview for ${state.path}…`, 'pending');
  state.frame.src = previewUrl(state.path);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview load timed out.')), 30000);
    state.frame.onload = () => { clearTimeout(timer); resolve(); };
  });
  state.inspector = await waitForInspector(state.frame);
  bindPreviewSelection();
  await collectInventory();
  setStatus(
    `Found ${state.inventory.length} trackable targets. Click the preview or choose one from the list.`,
    'ok',
  );
}

let listRoot;
let editorRoot;
let searchInput;

function renderTargetList() {
  if (!listRoot) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const visible = state.inventory.filter((item) => [item.label, item.id, item.href, item.block]
    .some((value) => String(value || '').toLowerCase().includes(query)));
  listRoot.replaceChildren();
  if (!visible.length) {
    listRoot.appendChild(el('p', { class: 'tracking-empty', text: 'No matching targets.' }));
    return;
  }
  visible.forEach((item) => {
    const overridden = Object.keys(item.override || {}).length > 0;
    let stateLabel = item.editable ? 'automatic' : 'derived only';
    if (overridden) stateLabel = `${item.scope || 'page'} override`;
    const button = el('button', {
      class: `tracking-target${state.selected?.editorKey === item.editorKey ? ' is-selected' : ''}`,
      onclick: () => selectInventoryItem(item),
    }, [
      el('span', { class: 'tracking-target-label', text: item.label || '(unlabelled interaction)' }),
      el('span', { class: 'tracking-target-meta', text: `${item.block} · ${item.href || item.tag}` }),
      el('span', {
        class: `tracking-target-state${overridden ? ' is-overridden' : ''}`,
        text: stateLabel,
      }),
    ]);
    listRoot.appendChild(button);
  });
}

function directRowValues(path, id) {
  const row = findOverride(state.sheet, path, id) || {};
  return Object.fromEntries(OVERRIDE_FIELDS.map((field) => [field, pairsToText(row[field])]));
}

function valueRows(title, values, fields) {
  return el('section', { class: 'tracking-values' }, [
    el('h3', { text: title }),
    ...fields.map((field) => el('div', { class: 'tracking-value-row' }, [
      el('span', { class: 'tracking-value-name', text: FIELD_LABELS[field] || field }),
      el('span', { class: 'tracking-value', text: displayValue(values[field]) }),
    ])),
  ]);
}

function changedValues(initial, controls) {
  const changed = {};
  OVERRIDE_FIELDS.forEach((field) => {
    const next = controls[field].value.trim();
    if (next !== (initial[field] || '')) changed[field] = next;
  });
  return changed;
}

function renderEditor(item) {
  editorRoot.replaceChildren();
  if (!item) {
    editorRoot.appendChild(el('div', {
      class: 'tracking-empty tracking-empty-editor',
      text: 'Select a target to inspect its automatic and effective values.',
    }));
    return;
  }

  const overrideId = item.matchedId || item.id;

  const identity = el('section', { class: 'tracking-identity' }, [
    el('p', { class: 'tracking-eyebrow', text: `${item.block} · ${item.tag}` }),
    el('h2', { text: item.label || '(unlabelled interaction)' }),
    el('dl', {}, [
      el('div', {}, [el('dt', { text: 'ID' }), el('dd', { text: item.id || 'Not sheet-addressable' })]),
      item.matchedId && item.matchedId !== item.id
        ? el('div', {}, [el('dt', { text: 'Sheet row ID' }), el('dd', { text: item.matchedId })])
        : null,
      el('div', {}, [el('dt', { text: 'Destination' }), el('dd', { text: item.href || '—' })]),
      el('div', {}, [el('dt', { text: 'Effective event' }), el('dd', { text: item.effective.event || '—' })]),
      el('div', {}, [el('dt', { text: 'Access point' }), el('dd', { text: item.effective['ui-access-point'] || 'page' })]),
    ]),
  ]);
  editorRoot.appendChild(identity);

  if (!item.editable) {
    editorRoot.appendChild(valueRows('Automatic values', item.automatic, OVERRIDE_FIELDS));
    editorRoot.appendChild(el('p', {
      class: 'tracking-note',
      text: 'This interaction is intentionally pure-derived and has no sheet identity.',
    }));
    return;
  }

  const scopeSelect = el('select', { class: 'tracking-select', attrs: { 'aria-label': 'Override scope' } }, [
    el('option', { text: `This page (${item.path})`, attrs: { value: item.path } }),
    el('option', { text: 'All pages (shared chrome)', attrs: { value: '*' } }),
  ]);
  state.scope = item.scope === 'global' ? '*' : item.path;
  scopeSelect.value = state.scope;

  const form = el('form', { class: 'tracking-form' });
  const controls = {};
  let initial = directRowValues(state.scope, overrideId);

  const setFormValues = () => {
    initial = directRowValues(state.scope, overrideId);
    OVERRIDE_FIELDS.forEach((field) => { controls[field].value = initial[field] || ''; });
  };

  form.append(
    el('div', { class: 'tracking-form-head' }, [
      el('div', {}, [
        el('h3', { text: 'Overrides' }),
        el('p', { text: 'Leave a field blank to inherit its automatic value.' }),
      ]),
      scopeSelect,
    ]),
  );

  OVERRIDE_FIELDS.forEach((field) => {
    const multiline = ['custom-properties', 'survey'].includes(field);
    const control = el(multiline ? 'textarea' : 'input', {
      class: 'tracking-input',
      attrs: {
        id: `tracking-${field}`,
        ...(multiline ? { rows: '3', placeholder: 'one key=value pair per line' } : { type: 'text' }),
      },
    });
    controls[field] = control;
    form.appendChild(el('label', { class: 'tracking-field', attrs: { for: `tracking-${field}` } }, [
      el('span', { text: FIELD_LABELS[field] }),
      control,
      el('small', { class: 'tracking-field-error', attrs: { 'data-error-for': field } }),
    ]));
  });

  const effectiveRoot = el('div');
  const updateEffective = () => {
    const values = Object.fromEntries(OVERRIDE_FIELDS
      .map((field) => [field, controls[field].value.trim()]));
    const simulated = applyOverride(state.sheet, { path: state.scope, id: overrideId, values });
    const refreshed = state.inspector.collect(simulated.data)
      .find((candidate) => candidate.id === item.id && candidate.label === item.label);
    effectiveRoot.replaceChildren(valueRows('Simulated effective values', refreshed?.effective || item.effective, [
      'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
      'ui-action', 'ui-access-point', 'wa-link', 'custom-properties',
    ]));
  };

  Object.values(controls).forEach((control) => control.addEventListener('input', updateEffective));
  scopeSelect.addEventListener('change', () => {
    state.scope = scopeSelect.value;
    setFormValues();
    updateEffective();
  });

  const save = el('button', { class: 'tracking-save', text: 'Save to sandbox' });
  const reset = el('button', {
    class: 'tracking-reset',
    text: 'Reset fields',
    attrs: { type: 'button' },
    onclick: () => { setFormValues(); updateEffective(); },
  });
  form.appendChild(el('div', { class: 'tracking-actions' }, [reset, save]));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = Object.fromEntries(OVERRIDE_FIELDS
      .map((field) => [field, controls[field].value.trim()]));
    const errors = validateOverride(current);
    form.querySelectorAll('.tracking-field-error').forEach((error) => {
      error.textContent = errors[error.dataset.errorFor] || '';
    });
    if (Object.keys(errors).length) {
      setStatus('Fix the highlighted override fields before saving.', 'error');
      return;
    }

    const values = changedValues(initial, controls);
    if (!Object.keys(values).length) {
      setStatus('No sandbox changes to save.', 'pending');
      return;
    }

    save.disabled = true;
    setStatus(`Checking ${SANDBOX_SOURCE} for concurrent changes…`, 'pending');
    try {
      const latestSource = await fetchSheet(SANDBOX_SOURCE);
      const latest = latestSource?.json || state.base;
      const result = mergeOverride({
        base: state.base,
        latest,
        change: { path: state.scope, id: overrideId, values },
      });
      if (result.conflicts.length) {
        setStatus(`Save stopped: ${result.conflicts.join(', ')} changed in another session. Refresh and review it.`, 'error');
        return;
      }
      await putSheet(result.sheet, !!latestSource);
      const saved = await fetchSheet(SANDBOX_SOURCE);
      state.sheet = saved.json;
      state.base = saved.json;
      state.sandboxExists = true;
      initial = directRowValues(state.scope, overrideId);
      await collectInventory();
      setStatus(`Saved to sandbox ${SANDBOX_SOURCE}. The live site still uses ${LIVE_SOURCE}.`, 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      save.disabled = false;
    }
  });

  setFormValues();
  editorRoot.append(
    valueRows('Automatic values', item.automatic, [
      'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
      'ui-action', 'ui-access-point', 'custom-properties',
    ]),
    form,
    effectiveRoot,
  );
  updateEffective();
}

function selectInventoryItem(candidate) {
  const match = state.inventory.find((item) => item.id === candidate.id
    && item.label === candidate.label && item.block === candidate.block) || candidate;
  state.selected = match;
  renderTargetList();
  renderEditor(match);
}

function renderShell() {
  app.replaceChildren();
  statusEl = el('div', {
    class: 'tracking-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });

  const pathInput = el('input', {
    class: 'tracking-path',
    attrs: { type: 'text', value: state.path, 'aria-label': 'Page path' },
  });
  const loadButton = el('button', { class: 'tracking-load', text: 'Load page' });
  loadButton.addEventListener('click', () => loadPreview(pathInput.value).catch((error) => setStatus(error.message, 'error')));
  pathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadButton.click();
  });

  const toolbar = el('div', { class: 'tracking-toolbar' }, [
    el('div', { class: 'tracking-path-group' }, [pathInput, loadButton]),
    el('p', { text: `Reads ${LIVE_SOURCE}; writes only ${SANDBOX_SOURCE}.` }),
  ]);

  state.frame = el('iframe', {
    class: 'tracking-preview',
    attrs: { title: 'Rendered page preview', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' },
  });
  searchInput = el('input', {
    class: 'tracking-search',
    attrs: { type: 'search', placeholder: 'Search targets…', 'aria-label': 'Search tracking targets' },
  });
  searchInput.addEventListener('input', renderTargetList);
  listRoot = el('div', { class: 'tracking-targets' });
  editorRoot = el('aside', { class: 'tracking-editor' });
  renderEditor(null);

  const inventory = el('section', { class: 'tracking-inventory' }, [
    el('div', { class: 'tracking-inventory-head' }, [el('h2', { text: 'Interactions' }), searchInput]),
    listRoot,
  ]);
  const workspace = el('div', { class: 'tracking-workspace' }, [
    el('section', { class: 'tracking-canvas' }, [state.frame, inventory]),
    editorRoot,
  ]);
  app.append(statusEl, toolbar, workspace);
}

async function loadInitialSheet() {
  const sandbox = await fetchSheet(SANDBOX_SOURCE);
  if (sandbox) {
    state.sheet = sandbox.json;
    state.base = sandbox.json;
    state.sandboxExists = true;
    return;
  }
  const live = await fetchSheet(LIVE_SOURCE);
  state.sheet = live?.json || { ':type': 'sheet', total: 0, data: [] };
  state.base = state.sheet;
  state.sandboxExists = false;
}

async function init() {
  try {
    const { context, token } = await DA_SDK;
    state.sdk = { context, token };
    state.path = cleanPagePath(new URLSearchParams(window.location.search).get('path') || '/');
    await loadInitialSheet();
    renderShell();
    await loadPreview(state.path);
    if (!state.sandboxExists) {
      setStatus(`Sandbox not created yet. Values are seeded read-only from ${LIVE_SOURCE} until the first save.`, 'ok');
    }
  } catch (error) {
    app.replaceChildren(el('div', { class: 'tracking-status tracking-status-error', text: error.message }));
  }
}

init();
