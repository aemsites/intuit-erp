/* eslint-disable no-use-before-define */
// The panel is event-driven: render → chip → popup → mode → save → render is a
// deliberate mutual-recursion cycle, so definitions cannot be strictly ordered.
// eslint-disable-next-line import/no-unresolved, import/extensions
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  parseExperience,
  setBlockTag,
  clearBlockTag,
  setSectionTag,
  clearSectionTag,
  setPageExperiment,
  clearPageExperiment,
  slugify,
  buildFormData,
} from './experience.js';

const DA_ADMIN = 'https://admin.da.live';

/** Author-facing labels per mode. */
const MODE_LABEL = { exp: 'Experimentation', pzn: 'Personalization' };

/** Minimal element builder. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  if (opts.oninput) node.addEventListener('input', opts.oninput);
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

/* -------------------------------------------------------------- mutation glue */

/** Apply a set for the given target + mode + id(s). */
function applySet(target, mode, values) {
  if (target.kind === 'page') {
    return setPageExperiment(state.source, values);
  }
  if (target.kind === 'section') {
    return setSectionTag(state.source, target.sectionIndex, mode, values.id);
  }
  return setBlockTag(state.source, target.sectionIndex, target.blockIndex, mode, values.id);
}

/** Apply a clear for the given target + mode. */
function applyClear(target, mode) {
  if (target.kind === 'page') return clearPageExperiment(state.source);
  if (target.kind === 'section') return clearSectionTag(state.source, target.sectionIndex, mode);
  return clearBlockTag(state.source, target.sectionIndex, target.blockIndex, mode);
}

/* --------------------------------------------------------------------- popup */

function closePopup() {
  const existing = state.root.querySelector('.pzn-popup');
  if (existing) existing.remove();
}

/** Form body for a chosen mode. Page-exp gets id + label; others get id + preview. */
function modeForm(target, mode) {
  const wrap = el('div', { class: 'pzn-form' });

  if (target.kind === 'page') {
    const idInput = el('input', {
      class: 'pzn-input',
      attrs: { type: 'text', placeholder: 'Experiment ID', value: target.experimentId || '' },
    });
    const labelInput = el('input', {
      class: 'pzn-input',
      attrs: { type: 'text', placeholder: 'Experiment label (optional)', value: target.experimentLabel || '' },
    });
    wrap.append(
      el('label', { class: 'pzn-field-label', text: 'Experiment ID' }),
      idInput,
      el('label', { class: 'pzn-field-label', text: 'Experiment label (optional)' }),
      labelInput,
      el('button', {
        class: 'pzn-save',
        text: 'Save',
        onclick: () => {
          const id = idInput.value.trim();
          if (!id) { idInput.focus(); return; }
          save(applySet(target, mode, { id, label: labelInput.value.trim() }));
        },
      }),
    );
    return wrap;
  }

  // section / block: single id → `<mode>-<slug>` token
  const current = mode === 'exp' ? target.exp : target.pzn;
  const currentId = current ? current.replace(new RegExp(`^${mode}-`), '') : '';
  const preview = el('div', { class: 'pzn-preview', text: current || `${mode}-…` });
  const idInput = el('input', {
    class: 'pzn-input',
    attrs: { type: 'text', placeholder: `${MODE_LABEL[mode]} ID`, value: currentId },
    oninput: (e) => {
      const slug = slugify(e.target.value);
      preview.textContent = slug ? `${mode}-${slug}` : `${mode}-…`;
    },
  });
  wrap.append(
    el('label', { class: 'pzn-field-label', text: `${MODE_LABEL[mode]} ID` }),
    idInput,
    el('div', { class: 'pzn-preview-row' }, [
      el('span', { class: 'pzn-preview-caption', text: 'Class token:' }),
      preview,
    ]),
    el('button', {
      class: 'pzn-save',
      text: 'Save',
      onclick: () => {
        const id = idInput.value.trim();
        if (!slugify(id)) { idInput.focus(); return; }
        save(applySet(target, mode, { id }));
      },
    }),
  );
  return wrap;
}

/** Current-tag rows with per-mode Clear buttons. */
function currentTags(target) {
  const modes = target.kind === 'page' ? ['exp'] : ['exp', 'pzn'];
  const set = modes
    .map((mode) => ({ mode, value: target.kind === 'page' ? pageTag(target) : target[mode] }))
    .filter((t) => t.value);
  if (set.length === 0) return null;

  const list = el('div', { class: 'pzn-current' });
  set.forEach(({ mode, value }) => {
    list.appendChild(el('div', { class: 'pzn-current-row' }, [
      el('span', { class: `pzn-tag pzn-tag-${mode}`, text: value }),
      el('button', {
        class: 'pzn-clear',
        text: 'Clear',
        onclick: () => save(applyClear(target, mode)),
      }),
    ]));
  });
  return list;
}

/** The page's experiment display value (id, plus label in parens). */
function pageTag(target) {
  if (!target.experimentId) return '';
  return target.experimentLabel
    ? `${target.experimentId} (${target.experimentLabel})`
    : target.experimentId;
}

/** Popup: current tags, a mode selector, and the chosen mode's form. */
function openPopup(target) {
  closePopup();
  const modes = target.kind === 'page' ? ['exp'] : ['exp', 'pzn'];

  const body = el('div', { class: 'pzn-popup-body' });
  const selector = el('div', { class: 'pzn-mode-select' });

  const showMode = (mode) => {
    Array.from(selector.children).forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
    const old = body.querySelector('.pzn-form');
    if (old) old.remove();
    body.appendChild(modeForm(target, mode));
  };

  modes.forEach((mode) => {
    const btn = el('button', {
      class: 'pzn-mode-btn',
      text: MODE_LABEL[mode],
      attrs: { 'data-mode': mode },
      onclick: () => showMode(mode),
    });
    selector.appendChild(btn);
  });

  const popup = el('div', { class: 'pzn-popup' }, [
    el('div', { class: 'pzn-popup-title', text: target.label }),
  ]);
  const tags = currentTags(target);
  if (tags) popup.appendChild(tags);
  popup.append(
    el('div', { class: 'pzn-popup-label', text: 'Add / edit tag' }),
    selector,
    body,
    el('div', { class: 'pzn-popup-footer' }, [
      el('button', { class: 'pzn-close', text: 'Close', onclick: closePopup }),
    ]),
  );
  state.root.appendChild(popup);
  showMode(modes[0]);
}

/* -------------------------------------------------------------------- render */

/** A tag chip: faint/dashed when unset, solid when set. */
function chip(mode, value) {
  return el('span', {
    class: `pzn-chip pzn-chip-${mode}${value ? ' is-set' : ''}`,
    text: value || `${mode}: none`,
  });
}

/** The "Tag" action button that opens the popup for a target. */
function tagButton(target) {
  return el('button', { class: 'pzn-tag-btn', text: 'Tag', onclick: () => openPopup(target) });
}

/** Rebuild the whole panel from current state. */
function render() {
  const { page, sections } = parseExperience(state.source);
  state.root.replaceChildren();

  statusEl = el('div', { class: 'pzn-status' });
  state.root.appendChild(statusEl);

  // page-level experimentation
  const pageTarget = {
    kind: 'page',
    label: 'Page',
    experimentId: page.experimentId,
    experimentLabel: page.experimentLabel,
  };
  state.root.appendChild(el('div', { class: 'pzn-section pzn-page' }, [
    el('div', { class: 'pzn-section-head' }, [
      el('span', { class: 'pzn-section-title', text: 'Page' }),
      tagButton(pageTarget),
    ]),
    el('div', { class: 'pzn-chips' }, [chip('exp', pageTag(pageTarget))]),
  ]));

  const targetable = sections.filter((s) => !s.hasPageMeta);
  if (targetable.length === 0) {
    state.root.appendChild(el('div', { class: 'pzn-muted', text: 'No sections found on this page.' }));
    return;
  }

  targetable.forEach((section) => {
    const sectionTarget = {
      kind: 'section', sectionIndex: section.index, label: `Section ${section.index + 1}`, exp: section.exp, pzn: section.pzn,
    };
    const head = el('div', { class: 'pzn-section-head' }, [
      el('span', { class: 'pzn-section-title', text: `Section ${section.index + 1}` }),
      tagButton(sectionTarget),
    ]);
    const sectionChips = el('div', { class: 'pzn-chips' }, [
      chip('exp', section.exp),
      chip('pzn', section.pzn),
    ]);

    const blockRows = section.blocks.map((block) => {
      const blockTarget = {
        kind: 'block',
        sectionIndex: section.index,
        blockIndex: block.index,
        label: block.name,
        exp: block.exp,
        pzn: block.pzn,
      };
      return el('div', { class: 'pzn-block-row' }, [
        el('div', { class: 'pzn-block-head' }, [
          el('span', { class: 'pzn-block-name', text: block.name }),
          tagButton(blockTarget),
        ]),
        el('div', { class: 'pzn-chips' }, [chip('exp', block.exp), chip('pzn', block.pzn)]),
      ]);
    });

    state.root.appendChild(el('div', { class: 'pzn-section' }, [head, sectionChips, ...blockRows]));
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
