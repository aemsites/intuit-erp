/* eslint-disable no-use-before-define */
// The panel is event-driven: render → Tag → popup → mode → save → render is a
// deliberate mutual-recursion cycle, so definitions cannot be strictly ordered.
// eslint-disable-next-line import/no-unresolved, import/extensions
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  parseExperience,
  setSectionTag,
  clearSectionTag,
  setPageExperiment,
  clearPageExperiment,
  buildFormData,
} from './experience.js';
import { pickFragment, promptPath } from './picker.js';

const DA_ADMIN = 'https://admin.da.live';
const MAX_VARIANTS = 5;

/** Author-facing labels per mode. */
const MODE_LABEL = { exp: 'Experimentation', pzn: 'Personalization' };

/** Minimal element builder. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  children.forEach((c) => node.appendChild(c));
  return node;
}

const state = {
  sdk: null, // { context, token }
  source: '', // stored page source HTML
  root: null, // panel container
};

/** The source URL for the current page in the DA admin Source API. */
function sourceUrl() {
  const { org, repo, path } = state.sdk.context;
  return `${DA_ADMIN}/source/${org}/${repo}${path}.html`;
}

/** GET the stored page source. */
async function fetchSource() {
  const res = await fetch(sourceUrl(), {
    headers: { Authorization: `Bearer ${state.sdk.token}` },
  });
  if (!res.ok) throw new Error(`Could not load page source (${res.status})`);
  return res.text();
}

let statusEl = null;
function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `pzn-status pzn-status-${kind || ''}`;
}

/** PUT the whole updated source back, then refresh from the server. */
async function save(newHtml) {
  closePopup();
  setStatus('Saving…', 'pending');
  try {
    const res = await fetch(sourceUrl(), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${state.sdk.token}` },
      body: buildFormData(newHtml),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    state.source = await fetchSource();
    render();
    setStatus('Saved. Note: a save can conflict with an open live edit.', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

/* --------------------------------------------------------------- variant list */

/**
 * Editable list of up to MAX_VARIANTS paths. `onAdd` returns a Promise<path|null>
 * (the fragment picker for sections, a manual prompt for pages).
 */
function variantList(initial, onAdd) {
  const values = Array.isArray(initial) ? [...initial] : [];
  const wrap = el('div', { class: 'pzn-variants' });

  const rerender = () => {
    wrap.replaceChildren();
    values.forEach((path, i) => {
      wrap.appendChild(el('div', { class: 'pzn-variant-row' }, [
        el('span', { class: 'pzn-variant-path', text: path }),
        el('button', {
          class: 'pzn-variant-remove',
          text: '✕',
          attrs: { 'aria-label': `Remove ${path}` },
          onclick: () => { values.splice(i, 1); rerender(); },
        }),
      ]));
    });
    const atMax = values.length >= MAX_VARIANTS;
    const addBtn = el('button', {
      class: 'pzn-add-variant',
      text: atMax ? `Max ${MAX_VARIANTS} variants` : '+ Add variant',
      onclick: async () => {
        if (values.length >= MAX_VARIANTS) return;
        const path = await onAdd();
        if (path && !values.includes(path)) { values.push(path); rerender(); }
      },
    });
    addBtn.disabled = atMax;
    wrap.appendChild(addBtn);
  };

  rerender();
  return { element: wrap, get: () => [...values] };
}

/* ----------------------------------------------------------------- popup body */

/**
 * Inline required-field error tied to an input. Returns the message element plus
 * a `show()`; the message clears (and the input un-highlights) as soon as the
 * author edits the field.
 */
function fieldError(input) {
  const element = el('div', { class: 'pzn-error-msg', attrs: { role: 'alert' } });
  const clear = () => {
    element.textContent = '';
    input.classList.remove('is-invalid');
  };
  input.addEventListener('input', clear);
  return {
    element,
    show: (msg) => {
      element.textContent = msg;
      input.classList.add('is-invalid');
      input.focus();
    },
  };
}

/** Section form for a chosen mode: id + scope + variants. */
function sectionForm(target, mode) {
  const cur = mode === 'pzn'
    ? { id: target.pzn, block: target.pznBlock, variants: target.pznVariants }
    : { id: target.exp, block: target.expBlock, variants: target.expVariants };

  const idInput = el('input', {
    class: 'pzn-input',
    attrs: { type: 'text', placeholder: `${MODE_LABEL[mode]} ID`, value: cur.id || '' },
  });
  const err = fieldError(idInput);

  const scope = el('select', { class: 'pzn-select' }, [
    el('option', { text: 'Whole section', attrs: { value: '' } }),
  ]);
  target.blocks.forEach((b) => {
    const opt = el('option', { text: b.name, attrs: { value: b.name } });
    if (b.name === cur.block) opt.selected = true;
    scope.appendChild(opt);
  });

  const variants = variantList(cur.variants, () => pickFragment(state.sdk));

  const saveBtn = el('button', {
    class: 'pzn-save',
    text: 'Save',
    onclick: () => {
      const id = idInput.value.trim();
      if (!id) { err.show(`${MODE_LABEL[mode]} ID is required`); return; }
      save(setSectionTag(state.source, target.sectionIndex, mode, {
        id, block: scope.value, variants: variants.get(),
      }));
    },
  });

  return el('div', { class: 'pzn-form' }, [
    el('label', { class: 'pzn-field-label', text: `${MODE_LABEL[mode]} ID` }),
    idInput,
    err.element,
    el('label', { class: 'pzn-field-label', text: 'Scope' }),
    scope,
    el('label', { class: 'pzn-field-label', text: `Variants — fragments (max ${MAX_VARIANTS})` }),
    variants.element,
    saveBtn,
  ]);
}

/** Page form: experiment id + label + page variants. */
function pageForm(target) {
  const idInput = el('input', {
    class: 'pzn-input',
    attrs: { type: 'text', placeholder: 'Experiment ID', value: target.experimentId || '' },
  });
  const err = fieldError(idInput);
  const labelInput = el('input', {
    class: 'pzn-input',
    attrs: { type: 'text', placeholder: 'Experiment label (optional)', value: target.experimentLabel || '' },
  });
  const variants = variantList(
    target.experimentVariants,
    () => promptPath({ label: 'Add a page variant', placeholder: '/path/to/variant-page' }),
  );

  const saveBtn = el('button', {
    class: 'pzn-save',
    text: 'Save',
    onclick: () => {
      const id = idInput.value.trim();
      if (!id) { err.show('Experiment ID is required'); return; }
      save(setPageExperiment(state.source, {
        id, label: labelInput.value.trim(), variants: variants.get(),
      }));
    },
  });

  return el('div', { class: 'pzn-form' }, [
    el('label', { class: 'pzn-field-label', text: 'Experiment ID' }),
    idInput,
    err.element,
    el('label', { class: 'pzn-field-label', text: 'Experiment label (optional)' }),
    labelInput,
    el('label', { class: 'pzn-field-label', text: `Variants — pages (max ${MAX_VARIANTS})` }),
    variants.element,
    saveBtn,
  ]);
}

/* ---------------------------------------------------------------------- popup */

function closePopup() {
  const existing = state.root.querySelector('.pzn-popup');
  if (existing) existing.remove();
}

/** Current-tag rows with per-mode Clear. Returns null when nothing is set. */
function sectionCurrent(target) {
  const rows = [];
  ['exp', 'pzn'].forEach((mode) => {
    const id = target[mode];
    if (!id) return;
    rows.push(el('div', { class: 'pzn-current-row' }, [
      el('span', { class: `pzn-tag pzn-tag-${mode}`, text: tagSummary(mode, target) }),
      el('button', {
        class: 'pzn-clear',
        text: 'Clear',
        onclick: () => save(clearSectionTag(state.source, target.sectionIndex, mode)),
      }),
    ]));
  });
  if (rows.length === 0) return null;
  return el('div', { class: 'pzn-current' }, rows);
}

/** Section popup: current tags, a mode selector, and the chosen mode's form. */
function openSectionPopup(target) {
  closePopup();
  const body = el('div', { class: 'pzn-popup-body' });
  const selector = el('div', { class: 'pzn-mode-select' });

  const showMode = (mode) => {
    Array.from(selector.children).forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
    const old = body.querySelector('.pzn-form');
    if (old) old.remove();
    body.appendChild(sectionForm(target, mode));
  };

  ['exp', 'pzn'].forEach((mode) => {
    selector.appendChild(el('button', {
      class: 'pzn-mode-btn',
      text: MODE_LABEL[mode],
      attrs: { 'data-mode': mode },
      onclick: () => showMode(mode),
    }));
  });

  const popup = el('div', { class: 'pzn-popup' }, [
    el('div', { class: 'pzn-popup-title', text: target.label }),
  ]);
  const current = sectionCurrent(target);
  if (current) popup.appendChild(current);
  popup.append(
    el('div', { class: 'pzn-popup-label', text: 'Add / edit tag' }),
    selector,
    body,
    el('div', { class: 'pzn-popup-footer' }, [
      el('button', { class: 'pzn-close', text: 'Close', onclick: closePopup }),
    ]),
  );
  state.root.appendChild(popup);
  showMode('exp');
}

/** Page popup: experimentation only. */
function openPagePopup(target) {
  closePopup();
  const popup = el('div', { class: 'pzn-popup' }, [
    el('div', { class: 'pzn-popup-title', text: 'Page — Experimentation' }),
  ]);
  if (target.experimentId) {
    popup.appendChild(el('div', { class: 'pzn-current' }, [
      el('div', { class: 'pzn-current-row' }, [
        el('span', { class: 'pzn-tag pzn-tag-exp', text: pageSummary(target) }),
        el('button', {
          class: 'pzn-clear',
          text: 'Clear',
          onclick: () => save(clearPageExperiment(state.source)),
        }),
      ]),
    ]));
  }
  popup.append(
    pageForm(target),
    el('div', { class: 'pzn-popup-footer' }, [
      el('button', { class: 'pzn-close', text: 'Close', onclick: closePopup }),
    ]),
  );
  state.root.appendChild(popup);
}

/* --------------------------------------------------------------------- render */

/** One-line summary of a section's tag for a mode. */
function tagSummary(mode, section) {
  const id = section[mode];
  if (!id) return '';
  const block = mode === 'pzn' ? section.pznBlock : section.expBlock;
  const variants = mode === 'pzn' ? section.pznVariants : section.expVariants;
  let text = `${mode}: ${id}`;
  text += block ? ` · block: ${block}` : ' · whole section';
  if (variants.length) text += ` · ${variants.length} variant${variants.length > 1 ? 's' : ''}`;
  return text;
}

/** One-line summary of the page experiment. */
function pageSummary(page) {
  if (!page.experimentId) return '';
  let text = `exp: ${page.experimentId}`;
  if (page.experimentLabel) text += ` (${page.experimentLabel})`;
  if (page.experimentVariants.length) {
    text += ` · ${page.experimentVariants.length} variant${page.experimentVariants.length > 1 ? 's' : ''}`;
  }
  return text;
}

/** A read-only state chip. */
function chip(mode, text) {
  return el('span', {
    class: `pzn-chip pzn-chip-${mode}${text ? ' is-set' : ''}`,
    text: text || `${mode}: none`,
  });
}

function tagButton(onclick) {
  return el('button', { class: 'pzn-tag-btn', text: 'Tag', onclick });
}

/** Rebuild the whole panel from current state. */
function render() {
  const { page, sections } = parseExperience(state.source);
  state.root.replaceChildren();

  statusEl = el('div', { class: 'pzn-status' });
  state.root.appendChild(statusEl);

  // page-level experimentation
  state.root.appendChild(el('div', { class: 'pzn-section pzn-page' }, [
    el('div', { class: 'pzn-section-head' }, [
      el('span', { class: 'pzn-section-title', text: 'Page' }),
      tagButton(() => openPagePopup(page)),
    ]),
    el('div', { class: 'pzn-chips' }, [chip('exp', pageSummary(page))]),
  ]));

  const targetable = sections.filter((s) => !s.hasPageMeta);
  if (targetable.length === 0) {
    state.root.appendChild(el('div', { class: 'pzn-muted', text: 'No sections found on this page.' }));
    return;
  }

  targetable.forEach((section) => {
    const target = { ...section, label: `Section ${section.index + 1}`, sectionIndex: section.index };
    const head = el('div', { class: 'pzn-section-head' }, [
      el('span', { class: 'pzn-section-title', text: `Section ${section.index + 1}` }),
      tagButton(() => openSectionPopup(target)),
    ]);
    const chips = el('div', { class: 'pzn-chips' }, [
      chip('exp', tagSummary('exp', section)),
      chip('pzn', tagSummary('pzn', section)),
    ]);
    const blockNote = section.blocks.length
      ? el('div', { class: 'pzn-block-note', text: `Blocks: ${section.blocks.map((b) => b.name).join(', ')}` })
      : null;

    const card = el('div', { class: 'pzn-section' }, [head, chips]);
    if (blockNote) card.appendChild(blockNote);
    state.root.appendChild(card);
  });
}

async function init() {
  state.root = document.getElementById('app');
  try {
    const { context, token } = await DA_SDK;
    state.sdk = { context, token };
    state.source = await fetchSource();
    render();
  } catch (err) {
    state.root.replaceChildren(
      el('div', { class: 'pzn-status pzn-status-error', text: err.message || 'Failed to load.' }),
    );
  }
}

init();
