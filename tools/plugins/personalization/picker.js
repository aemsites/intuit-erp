/**
 * Variant picker — a modal that reuses the adobe-rnd DA "fragments" plugin to
 * pick a fragment, with a manual paste-path fallback.
 *
 * The fragments plugin is a DA library built on the DA SDK: it expects a host to
 * complete a handshake (a `postMessage` carrying `{ ready, context, token }` and
 * a transferred MessagePort), then on Insert it posts `{ action: 'sendHTML',
 * details: '<a href="…aem.page/<path>">' }` back over that port and asks the host
 * to `closeLibrary`. We impersonate that host inside our own modal iframe.
 *
 * This handshake is a DA-internal contract and may change; the module is
 * isolated for exactly that reason, and the manual input guarantees the feature
 * works even if the embedded picker fails to load or hand back a selection.
 */
import { toPath } from './experience.js';

const PICKER_ORIGIN = 'https://main--aem-apps--adobe-rnd.aem.live';
const PICKER_URL = `${PICKER_ORIGIN}/tools/plugins/fragments/fragments.html`;

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

/** Recover a fragment path from the picker's insert payload (anchor or text). */
function extractPath(details) {
  if (!details) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = String(details);
  const a = tmp.querySelector('a[href]');
  const raw = a ? a.getAttribute('href') : tmp.textContent;
  return toPath(raw);
}

/**
 * Open the picker modal. Resolves to a fragment path (from the embedded picker
 * or the manual input) or `null` if cancelled.
 * @param {{ context: object, token: string }} sdk
 * @returns {Promise<string|null>}
 */
export function pickFragment({ context, token } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let channel = null;

    const overlay = el('div', { class: 'pzn-modal-overlay' });

    const cleanup = () => {
      if (channel) channel.port1.onmessage = null;
      overlay.remove();
    };
    const finish = (path) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(path || null);
    };

    // Embedded fragments plugin
    const iframe = el('iframe', {
      class: 'pzn-picker-frame',
      attrs: { src: PICKER_URL, title: 'Fragment picker' },
    });
    iframe.addEventListener('load', () => {
      try {
        channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          const { action, details } = e.data || {};
          if (action === 'sendHTML' || action === 'sendText') {
            const path = extractPath(details);
            if (path) finish(path);
          } else if (action === 'closeLibrary') {
            finish(null);
          }
        };
        iframe.contentWindow.postMessage(
          { ready: true, context, token },
          PICKER_ORIGIN,
          [channel.port2],
        );
      } catch {
        // handshake failed — the manual input below still works
      }
    });

    // Manual fallback
    const manualInput = el('input', {
      class: 'pzn-input',
      attrs: { type: 'text', placeholder: '/fragments/pzn/…' },
    });
    const useManual = () => {
      const path = toPath(manualInput.value);
      if (path) finish(path);
      else manualInput.focus();
    };
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); useManual(); }
    });

    const modal = el('div', { class: 'pzn-modal' }, [
      el('div', { class: 'pzn-modal-head' }, [
        el('span', { class: 'pzn-modal-title', text: 'Select a fragment' }),
        el('button', { class: 'pzn-close', text: 'Cancel', onclick: () => finish(null) }),
      ]),
      iframe,
      el('div', { class: 'pzn-modal-manual' }, [
        el('label', { class: 'pzn-field-label', text: 'Or paste a fragment path' }),
        el('div', { class: 'pzn-manual-row' }, [
          manualInput,
          el('button', { class: 'pzn-save', text: 'Use path', onclick: useManual }),
        ]),
      ]),
    ]);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

/**
 * A minimal modal that asks for a single path (used for page-level variants,
 * which are pages — the fragments picker only browses `/fragments`). Resolves to
 * a pathname or `null` if cancelled.
 * @returns {Promise<string|null>}
 */
export function promptPath({ label = 'Add a page variant', placeholder = '/path/to/page' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const overlay = el('div', { class: 'pzn-modal-overlay' });
    const finish = (path) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(path || null);
    };

    const input = el('input', { class: 'pzn-input', attrs: { type: 'text', placeholder } });
    const submit = () => {
      const path = toPath(input.value);
      if (path) finish(path);
      else input.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    const modal = el('div', { class: 'pzn-modal pzn-modal-sm' }, [
      el('div', { class: 'pzn-modal-head' }, [
        el('span', { class: 'pzn-modal-title', text: label }),
        el('button', { class: 'pzn-close', text: 'Cancel', onclick: () => finish(null) }),
      ]),
      el('div', { class: 'pzn-modal-manual' }, [
        el('div', { class: 'pzn-manual-row' }, [
          input,
          el('button', { class: 'pzn-save', text: 'Add', onclick: submit }),
        ]),
      ]),
    ]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 0);
  });
}
