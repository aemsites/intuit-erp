/* eslint-disable no-use-before-define */
// The panel is event-driven: render → chip → popup → assign → save → render is a
// deliberate mutual-recursion cycle, so definitions cannot be strictly ordered.
// eslint-disable-next-line import/no-unresolved, import/extensions
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  parseSlots,
  setBlockSlot,
  clearBlockSlot,
  setSectionSlot,
  clearSectionSlot,
  collectPageSlots,
  buildFormData,
} from './slots.js';

const DA_ADMIN = 'https://admin.da.live';

/** Placement sentence derived from a map row's action + fidelity. */
const PLACEMENT_VERB = {
  replace: 'replaces this',
  above: 'is inserted above this',
  below: 'is inserted below this',
};

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
  mapRows: [], // rows from the (mock) pzn map.json
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

/** GET the mock pzn map. Non-fatal: any failure yields []. */
async function fetchMap() {
  const { org, repo } = state.sdk.context;
  const url = `https://main--${repo}--${org}.aem.live/pzn/map.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

/** The map row for a slot id, or null. */
function mapRowFor(slot) {
  return state.mapRows.find((r) => r.location === slot) || null;
}

/** Slot ids the author may assign: union of map locations + slots on the page. */
function assignableSlots() {
  const fromMap = state.mapRows.map((r) => r.location).filter(Boolean);
  const fromPage = collectPageSlots(state.source);
  return Array.from(new Set([...fromMap, ...fromPage]))
    .filter((s) => /^slot-[a-z0-9-]+$/.test(s))
    .sort();
}

/** PUT the whole updated source back, then refresh from the server. */
async function save(newHtml) {
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

/** Apply a slot to a target (section or block), then save. */
function assign(target, slotId) {
  const next = target.kind === 'section'
    ? setSectionSlot(state.source, target.sectionIndex, slotId)
    : setBlockSlot(state.source, target.sectionIndex, target.blockIndex, slotId);
  closePopup();
  save(next);
}

/** Clear a target's slot, then save. */
function clear(target) {
  const next = target.kind === 'section'
    ? clearSectionSlot(state.source, target.sectionIndex)
    : clearBlockSlot(state.source, target.sectionIndex, target.blockIndex);
  closePopup();
  save(next);
}

/** Human-readable placement line from a map row. */
function placementLine(row) {
  const verb = PLACEMENT_VERB[row.action] || 'targets this';
  return `Fragment ${verb} ${row.fidelity} (${row.fidelity})`;
}

function closePopup() {
  const existing = state.root.querySelector('.pzn-popup');
  if (existing) existing.remove();
}

/** Detail popup for a chip: map info for the current slot + assign buttons + Clear. */
function openPopup(target, label) {
  closePopup();
  const row = target.slot ? mapRowFor(target.slot) : null;

  const detail = el('div', { class: 'pzn-popup-detail' });
  if (target.slot && row) {
    detail.appendChild(el('div', { class: 'pzn-kv', text: `Page: ${row.path}` }));
    detail.appendChild(el('div', { class: 'pzn-kv', text: `Fragment: ${row.fragment}` }));
    detail.appendChild(el('div', { class: 'pzn-kv', text: placementLine(row) }));
  } else {
    detail.appendChild(el('div', { class: 'pzn-muted', text: 'No mapping found for this slot.' }));
  }

  const buttons = el('div', { class: 'pzn-popup-buttons' });
  assignableSlots().forEach((slotId) => {
    buttons.appendChild(el('button', {
      class: `pzn-slot-btn${slotId === target.slot ? ' is-current' : ''}`,
      text: slotId,
      onclick: () => assign(target, slotId),
    }));
  });

  const clearBtn = el('button', { class: 'pzn-clear', text: 'Clear', onclick: () => clear(target) });
  clearBtn.disabled = !target.slot;
  const footer = el('div', { class: 'pzn-popup-footer' }, [
    clearBtn,
    el('button', { class: 'pzn-close', text: 'Close', onclick: closePopup }),
  ]);

  state.root.appendChild(el('div', { class: 'pzn-popup' }, [
    el('div', { class: 'pzn-popup-title', text: label }),
    detail,
    el('div', { class: 'pzn-popup-label', text: 'Assign slot' }),
    buttons,
    footer,
  ]));
}

/** A slot chip. Faint/outlined "none" when unset; solid when set. */
function chip(target, label) {
  return el('button', {
    class: `pzn-chip${target.slot ? ' is-set' : ''}`,
    text: target.slot || 'none',
    attrs: { 'aria-label': `${label}: ${target.slot || 'no slot'}` },
    onclick: () => openPopup(target, label),
  });
}

let statusEl = null;
function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `pzn-status pzn-status-${kind}`;
}

/** Rebuild the whole panel from current state. */
function render() {
  const { sections } = parseSlots(state.source);
  state.root.replaceChildren();

  statusEl = el('div', { class: 'pzn-status' });
  state.root.appendChild(statusEl);

  if (sections.length === 0) {
    state.root.appendChild(el('div', { class: 'pzn-muted', text: 'No sections found on this page.' }));
    return;
  }

  sections.forEach((section) => {
    const sectionTarget = { kind: 'section', sectionIndex: section.index, slot: section.sectionSlot };
    const header = el('div', { class: 'pzn-section-head' }, [
      el('span', { class: 'pzn-section-title', text: `Section ${section.index + 1}` }),
      chip(sectionTarget, `Section ${section.index + 1}`),
    ]);

    const blocks = section.blocks.map((block) => {
      const blockTarget = {
        kind: 'block', sectionIndex: section.index, blockIndex: block.index, slot: block.slot,
      };
      return el('div', { class: 'pzn-block-row' }, [
        el('span', { class: 'pzn-block-name', text: block.name }),
        chip(blockTarget, block.name),
      ]);
    });

    state.root.appendChild(el('div', { class: 'pzn-section' }, [header, ...blocks]));
  });
}

async function init() {
  state.root = document.getElementById('app');
  try {
    const { context, token } = await DA_SDK;
    state.sdk = { context, token };
    [state.source, state.mapRows] = await Promise.all([fetchSource(), fetchMap()]);
    render();
  } catch (err) {
    state.root.replaceChildren(
      el('div', { class: 'pzn-status pzn-status-error', text: err.message || 'Failed to load.' }),
    );
  }
}

init();
