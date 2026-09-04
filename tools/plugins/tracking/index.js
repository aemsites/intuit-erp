/* eslint-disable no-use-before-define, import/no-unresolved */
// The preview/list/editor handlers intentionally call each other; keeping each
// section cohesive is clearer than ordering the file around handler references.
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  createTrackingInspectorClient,
  trackingPreviewOrigin,
  trackingProbeUrl,
} from './bridge.js?v=20260904.4';
import {
  TRACKING_SOURCE_PATH,
  createTrackingApi,
  resolveTrackingRef,
} from './api.js?v=20260904.4';
import { publishReviewedSheet, saveAndPreviewOverride } from './delivery.js?v=20260904.4';
import {
  OVERRIDE_FIELDS,
  applyOverride,
  comparisonRows,
  findOverride,
  resolveEditorPath,
  validateOverride,
} from './model.js?v=20260904.4';

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

const COMPARISON_FIELDS = [
  'object',
  'object-detail',
  'action',
  'ui-object',
  'ui-object-detail',
  'ui-action',
  'ui-access-point',
  'wa-link',
  'custom-properties',
];

const app = document.getElementById('app');
const state = {
  path: '/',
  sheet: null,
  base: null,
  etag: '',
  api: null,
  context: {},
  ref: 'main',
  inventory: [],
  selected: null,
  scope: '/',
  inspector: null,
  probe: null,
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

async function collectInventory() {
  state.inventory = uniqueInventory(await state.inspector.collect(state.sheet.data));
  renderTargetList();
  if (state.selected?.id) {
    const refreshed = state.inventory.find((item) => item.id === state.selected.id
      && item.label === state.selected.label && item.block === state.selected.block);
    if (refreshed) selectInventoryItem(refreshed);
    else {
      state.selected = null;
      renderEditor(null);
    }
  }
}

async function loadProbe() {
  state.selected = null;
  setStatus(`Rendering tracking properties for ${state.path}…`, 'pending');
  const targetOrigin = trackingPreviewOrigin({
    context: state.context,
    ref: state.ref,
    location: window.location,
  });
  state.probe = el('iframe', {
    class: 'tracking-probe',
    attrs: {
      src: trackingProbeUrl({
        context: state.context,
        ref: state.ref,
        location: window.location,
      }),
      title: 'Tracking preview probe',
      'aria-hidden': 'true',
      tabindex: '-1',
      loading: 'eager',
      referrerpolicy: 'no-referrer',
      sandbox: 'allow-scripts allow-same-origin',
    },
  });
  app.appendChild(state.probe);
  state.inspector = createTrackingInspectorClient({
    targetOrigin,
    getTarget: () => state.probe?.contentWindow,
  });
  await collectInventory();
  setStatus(
    `Found ${state.inventory.length} trackable interactions for ${state.path}.`,
    'ok',
  );
}

let listRoot;
let editorRoot;
let searchInput;
let inventoryCount;

function renderTargetList() {
  if (!listRoot) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const visible = state.inventory.filter((item) => [item.label, item.id, item.href, item.block]
    .some((value) => String(value || '').toLowerCase().includes(query)));
  if (inventoryCount) {
    inventoryCount.textContent = query
      ? `${visible.length} of ${state.inventory.length}`
      : `${state.inventory.length} interactions`;
  }
  listRoot.replaceChildren();
  if (!visible.length) {
    listRoot.appendChild(el('p', {
      class: 'tracking-empty',
      text: query ? 'No matching interactions.' : 'No trackable interactions found on this page.',
    }));
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

function comparisonFields(automatic, effective) {
  const surveys = [...new Set([...Object.keys(automatic || {}), ...Object.keys(effective || {})]
    .filter((field) => field.startsWith('survey-')))];
  return [...COMPARISON_FIELDS, ...surveys];
}

function comparisonTable(automatic, effective) {
  const rows = comparisonRows(automatic, effective, comparisonFields(automatic, effective));
  const body = el('tbody', {}, rows.map((row) => el('tr', {}, [
    el('th', { text: FIELD_LABELS[row.field] || row.field, attrs: { scope: 'row' } }),
    el('td', { class: 'tracking-automatic', text: displayValue(row.automatic) }),
    el('td', {
      class: `tracking-effective${row.changed ? ' is-changed' : ''}`,
      text: displayValue(row.effective),
    }),
  ])));
  return el('section', { class: 'tracking-comparison' }, [
    el('div', { class: 'tracking-section-heading' }, [
      el('h3', { text: 'Resolved tracking values' }),
      el('p', { text: 'Effective values include applicable overrides. Changes are highlighted.' }),
    ]),
    el('div', { class: 'tracking-table-wrap' }, [
      el('table', { class: 'tracking-comparison-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Field', attrs: { scope: 'col' } }),
          el('th', { text: 'Automatic', attrs: { scope: 'col' } }),
          el('th', { text: 'Effective', attrs: { scope: 'col' } }),
        ])]),
        body,
      ]),
    ]),
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
      text: 'Select an interaction to inspect its automatic and effective values.',
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
    editorRoot.appendChild(comparisonTable(item.automatic, item.effective));
    editorRoot.appendChild(el('p', {
      class: 'tracking-note',
      text: 'This interaction is pure-derived and has no sheet identity.',
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
    const errorId = `tracking-${field}-error`;
    const control = el(multiline ? 'textarea' : 'input', {
      class: 'tracking-input',
      attrs: {
        id: `tracking-${field}`,
        'aria-describedby': errorId,
        ...(multiline ? { rows: '3', placeholder: 'one key=value pair per line' } : { type: 'text' }),
      },
    });
    controls[field] = control;
    form.appendChild(el('label', { class: 'tracking-field', attrs: { for: `tracking-${field}` } }, [
      el('span', { text: FIELD_LABELS[field] }),
      control,
      el('small', {
        class: 'tracking-field-error',
        attrs: { id: errorId, 'data-error-for': field },
      }),
    ]));
  });

  const comparisonRoot = el('div');
  const formValues = () => Object.fromEntries(OVERRIDE_FIELDS
    .map((field) => [field, controls[field].value.trim()]));
  let comparisonGeneration = 0;
  const updateEffective = async () => {
    comparisonGeneration += 1;
    const generation = comparisonGeneration;
    const values = formValues();
    const simulated = applyOverride(state.sheet, { path: state.scope, id: overrideId, values });
    const refreshedInventory = await state.inspector.collect(simulated.data);
    if (generation !== comparisonGeneration) return;
    const refreshed = refreshedInventory
      .find((candidate) => candidate.id === item.id && candidate.label === item.label);
    comparisonRoot.replaceChildren(comparisonTable(
      item.automatic,
      refreshed?.effective || item.effective,
    ));
  };

  const save = el('button', { class: 'tracking-save', text: 'Save & preview' });
  const publish = el('button', {
    class: 'tracking-publish',
    text: 'Publish',
    attrs: { type: 'button' },
  });
  const reset = el('button', {
    class: 'tracking-reset',
    text: 'Reset fields',
    attrs: { type: 'button' },
  });
  let busy = false;
  const syncActions = () => {
    const dirty = Object.keys(changedValues(initial, controls)).length > 0;
    save.disabled = busy;
    reset.disabled = busy;
    publish.disabled = busy || dirty;
    publish.title = dirty ? 'Save and preview these changes before publishing.' : '';
  };

  Object.entries(controls).forEach(([field, control]) => control.addEventListener('input', () => {
    control.removeAttribute('aria-invalid');
    form.querySelector(`[data-error-for="${field}"]`).textContent = '';
    updateEffective().catch((error) => setStatus(error.message, 'error'));
    syncActions();
  }));
  scopeSelect.addEventListener('change', () => {
    state.scope = scopeSelect.value;
    setFormValues();
    updateEffective().catch((error) => setStatus(error.message, 'error'));
    syncActions();
  });
  reset.addEventListener('click', () => {
    setFormValues();
    updateEffective().catch((error) => setStatus(error.message, 'error'));
    syncActions();
  });
  form.appendChild(el('div', { class: 'tracking-actions' }, [reset, save, publish]));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = formValues();
    const errors = validateOverride(current);
    form.querySelectorAll('.tracking-field-error').forEach((error) => {
      const { errorFor } = error.dataset;
      const message = errors[errorFor] || '';
      error.textContent = message;
      if (message) controls[errorFor].setAttribute('aria-invalid', 'true');
      else controls[errorFor].removeAttribute('aria-invalid');
    });
    if (Object.keys(errors).length) {
      setStatus('Fix the highlighted override fields before saving.', 'error');
      controls[Object.keys(errors)[0]]?.focus();
      return;
    }

    const values = changedValues(initial, controls);
    if (!Object.keys(values).length) {
      setStatus('No tracking sheet changes to save.', 'pending');
      return;
    }

    busy = true;
    syncActions();
    setStatus(`Checking ${TRACKING_SOURCE_PATH} for concurrent changes…`, 'pending');
    try {
      const result = await saveAndPreviewOverride({
        api: state.api,
        base: state.base,
        change: { path: state.scope, id: overrideId, values },
      });
      if (result.conflicts.length) {
        setStatus(`Save stopped: ${result.conflicts.join(', ')} changed in another session. Refresh and review it.`, 'error');
        return;
      }
      state.sheet = result.sheet;
      state.base = result.sheet;
      state.etag = result.etag;
      initial = directRowValues(state.scope, overrideId);
      await collectInventory();
      setStatus(`Saved and previewed ${TRACKING_SOURCE_PATH}. Publish when the change is ready for live traffic.`, 'ok');
    } catch (error) {
      if (error.sourceSaved && error.sheet) {
        state.sheet = error.sheet;
        state.base = error.sheet;
        state.etag = error.etag;
        initial = directRowValues(state.scope, overrideId);
        await collectInventory();
      }
      setStatus(error.message, 'error');
    } finally {
      busy = false;
      syncActions();
    }
  });

  publish.addEventListener('click', async () => {
    if (Object.keys(changedValues(initial, controls)).length) {
      setStatus('Save and preview these changes before publishing.', 'error');
      return;
    }

    busy = true;
    syncActions();
    try {
      // eslint-disable-next-line no-alert -- live publishing requires explicit author confirmation.
      if (!window.confirm(`Publish ${TRACKING_SOURCE_PATH} to live traffic?`)) {
        setStatus('Publish cancelled.', 'pending');
        return;
      }
      setStatus(`Refreshing the ${state.ref} preview before publish…`, 'pending');
      const result = await publishReviewedSheet({
        api: state.api,
        reviewed: state.base,
        etag: state.etag,
      });
      if (result.stale) {
        setStatus('Publish stopped: the tracking sheet changed in another session. Reload and review the latest source.', 'error');
        return;
      }
      setStatus(`Published ${TRACKING_SOURCE_PATH} to live traffic.`, 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      busy = false;
      syncActions();
    }
  });

  setFormValues();
  editorRoot.append(comparisonRoot, form);
  updateEffective().catch((error) => setStatus(error.message, 'error'));
  syncActions();
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

  searchInput = el('input', {
    class: 'tracking-search',
    attrs: {
      type: 'search',
      placeholder: 'Search interactions…',
      'aria-label': 'Search tracking interactions',
    },
  });
  searchInput.addEventListener('input', renderTargetList);
  listRoot = el('div', { class: 'tracking-targets' });
  inventoryCount = el('span', { class: 'tracking-count', text: '0 interactions' });
  editorRoot = el('div', { class: 'tracking-editor' });
  renderEditor(null);

  const inventory = el('section', { class: 'tracking-inventory' }, [
    el('div', { class: 'tracking-inventory-head' }, [
      el('h2', { text: 'Interactions' }),
      inventoryCount,
    ]),
    searchInput,
    listRoot,
  ]);
  app.append(
    statusEl,
    inventory,
    editorRoot,
    el('p', {
      class: 'tracking-storage-note',
      text: `Edits ${TRACKING_SOURCE_PATH}. Saving updates preview; publishing requires confirmation.`,
    }),
  );
}

async function loadInitialSheet() {
  const live = await state.api.readSourceRevision();
  state.sheet = live.sheet;
  state.base = state.sheet;
  state.etag = live.etag;
}

async function init() {
  try {
    const { context, actions } = await DA_SDK;
    const params = new URLSearchParams(window.location.search);
    const explicitRef = params.get('ref') || '';
    state.ref = resolveTrackingRef({
      ref: explicitRef,
      context,
      hostname: window.location.hostname,
    });
    state.context = { ...context, path: params.get('path') || context.path };
    state.api = createTrackingApi({ daFetch: actions.daFetch, context, ref: state.ref });
    state.path = resolveEditorPath({ contextPath: context.path, search: window.location.search });
    await loadInitialSheet();
    renderShell();
    await loadProbe();
  } catch (error) {
    app.replaceChildren(el('div', { class: 'tracking-status tracking-status-error', text: error.message }));
  }
}

init();
