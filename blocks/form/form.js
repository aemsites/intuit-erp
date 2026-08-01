/**
 * form — "Let's connect" static lead form (accounting, compare, erp-solutions).
 * Heading / subtext / accountant link / consent are authored as default content
 * (a trailing default-content paragraph becomes the reCAPTCHA note). The block
 * renders the fixed 5-field form. CSP-safe: no inline handlers — the submit
 * handler is attached in JS. On submit with a valid business email it fires an
 * identity sendEvent (Act 2 RTCDP stitch), then shows a confirmation.
 *
 * Variants: (default) underline inputs (accounting) · .boxed labelled boxes
 * (compare) · .sky sky band + hidden labels (erp-solutions) · .hero embedded
 * in a dark hero band · .card white overlay card (accountant).
 *
 * Optional leading config rows (Marketo / ChiliPiper, authored before the
 * fixed fields, parsed by `parseFormConfig`): `formId`, `munchkin`,
 * `chiliPiperSubDomain`, `chiliPiperRouter`, `header`, `subheader`,
 * `disclaimer`. These are stamped as `data-mkto-form-id` / `data-mkto-munchkin`
 * / `data-cp-subdomain` / `data-cp-router` on the rendered form element and
 * used to render an optional header/subheader/disclaimer. Live Marketo Forms2 + ChiliPiper
 * submission are DEFERRED — see `loadMarketoForm()` below — so no network
 * calls are made for these yet; the fixed 5-field form + identity sendEvent
 * remain the only working submission path.
 * CSS: blocks/form/form.css
 */
// Vendored via git subtree at plugins/martech (see its README), not an
// installed npm package, so this necessarily crosses a package.json boundary.
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../../plugins/martech/src/index.js';
import { OF1_SIGNAL } from '../../scripts/of1-rtcdp-signal.js';

const FIELDS = [
  ['First name*', 'text', 'firstName'],
  ['Last name*', 'text', 'lastName'],
  ['Business name*', 'text', 'businessName'],
  ['Business email*', 'email', 'email'],
  ['Business phone*', 'tel', 'phone'],
];

// Known keys for the optional leading config rows (Marketo/ChiliPiper). Any
// `:scope > div` row whose first cell matches one of these exactly is
// consumed as config; everything else is left alone (the fixed fields below
// don't read block content at all, so there's no ambiguity to resolve).
const CONFIG_KEYS = [
  'formId',
  'munchkin',
  'chiliPiperSubDomain',
  'chiliPiperRouter',
  'header',
  'subheader',
  'disclaimer',
];

// Parses the optional leading config rows into a plain object. Missing keys
// are `undefined` (not omitted) so callers can destructure without guards.
// Pure — reads the block's current DOM, no mutation, no network.
export function parseFormConfig(block) {
  const found = {};
  [...block.querySelectorAll(':scope > div')].forEach((row) => {
    const [keyCell, valueCell] = row.children;
    const key = keyCell?.textContent.trim();
    if (key && CONFIG_KEYS.includes(key)) {
      found[key] = valueCell ? valueCell.textContent.trim() : undefined;
    }
  });
  return {
    formId: found.formId,
    munchkin: found.munchkin,
    chiliPiperSubDomain: found.chiliPiperSubDomain,
    chiliPiperRouter: found.chiliPiperRouter,
    header: found.header,
    subheader: found.subheader,
    disclaimer: found.disclaimer,
  };
}

// DEFERRED — Marketo Forms2 + ChiliPiper submission. Intentionally defined
// but NOT invoked anywhere yet: this pass only authors/parses config and
// stamps data attributes (see `decorate`). Wiring live submission means
// loading the Marketo Forms2 script (CSP allowance required), rendering the
// real Marketo form against `data-mkto-form-id`/`data-mkto-munchkin`, and on
// its success handing off to ChiliPiper via `data-cp-subdomain`/
// `data-cp-router` instead of Marketo's default "thank you" redirect. Until
// that follow-up lands, the fixed 5-field form + identity sendEvent above
// remain the only working submission path.
// @param {HTMLElement} formEl element carrying the data-mkto-*/data-cp-* attrs
// @returns {object|null} the resolved config, or null when no Marketo config
//   was authored — never triggers a network call either way (see TODOs).
export function loadMarketoForm(formEl) {
  const {
    mktoFormId, mktoMunchkin, cpSubdomain, cpRouter,
  } = formEl.dataset;
  if (!mktoFormId || !mktoMunchkin) return null; // nothing authored — nothing to load
  // TODO(marketo): load `//<mktoMunchkin>.mktoweb.com/js/forms2/js/forms2.min.js`,
  //   then `MktoForms2.loadForm('//<mktoMunchkin>.mktoweb.com', mktoMunchkin, mktoFormId, ...)`.
  // TODO(chilipiper): on the Marketo form's onSuccess, call
  //   `ChiliPiper.submit(cpSubdomain, cpRouter, { ... })` instead of following
  //   the default Marketo redirect, when `cpSubdomain`/`cpRouter` are present.
  return {
    formId: mktoFormId,
    munchkin: mktoMunchkin,
    chiliPiperSubDomain: cpSubdomain,
    chiliPiperRouter: cpRouter,
  };
}

// Basic shape check — enough to gate the identity send without over-validating
// (demo lead form; not an auth boundary).
export function isValidBusinessEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Maps lead fields → an identity sendEvent XDM. Email goes in identityMap as
// 'ambiguous' (unverified). Pure — no DOM/network.
export function buildIdentityXdm(fields) {
  return {
    eventType: 'web.formFilledOut',
    identityMap: {
      Email: [{ id: fields.email, primary: true, authenticatedState: 'ambiguous' }],
    },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: { lead: { ...fields }, capturedAt: new Date().toISOString() },
    },
  };
}

export default function decorate(block) {
  // Config rows (if any) are read here, before the block's children are
  // wholly replaced below — they never reach the fixed-field rendering,
  // so there's no risk of a config row being mistaken for a field.
  const config = parseFormConfig(block);

  // Stamp Marketo/ChiliPiper config as data attributes on the block itself
  // (the block IS "the form" — CSS/JS already scope off its `.form` class).
  // Only set when authored; `loadMarketoForm` (deferred, unused today) reads
  // these later once live submission is wired up.
  if (config.formId) block.dataset.mktoFormId = config.formId;
  if (config.munchkin) block.dataset.mktoMunchkin = config.munchkin;
  if (config.chiliPiperSubDomain) block.dataset.cpSubdomain = config.chiliPiperSubDomain;
  if (config.chiliPiperRouter) block.dataset.cpRouter = config.chiliPiperRouter;

  const children = [];

  if (config.header) {
    const header = document.createElement('h3');
    header.className = 'form-header';
    header.textContent = config.header;
    children.push(header);
  }
  if (config.subheader) {
    const subheader = document.createElement('p');
    subheader.className = 'form-subheader';
    subheader.textContent = config.subheader;
    children.push(subheader);
  }

  const form = document.createElement('div');
  form.className = 'lead-fields';
  const inputs = {};
  FIELDS.forEach(([label, type, key]) => {
    const l = document.createElement('label');
    l.className = 'ff';
    l.innerHTML = `<span>${label}</span><input type="${type}" placeholder="${label}" aria-label="${label.replace('*', '')}">`;
    inputs[key] = l.querySelector('input');
    form.append(l);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'form-submit';
  btn.textContent = 'Schedule a call';
  form.append(btn);
  children.push(form);

  const note = document.createElement('p');
  note.className = 'form-note';
  note.setAttribute('aria-live', 'polite');
  children.push(note);

  if (config.disclaimer) {
    const disclaimer = document.createElement('p');
    disclaimer.className = 'form-disclaimer';
    disclaimer.textContent = config.disclaimer;
    children.push(disclaimer);
  }

  btn.addEventListener('click', () => {
    const fields = Object.fromEntries(
      Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]),
    );
    if (!isValidBusinessEmail(fields.email)) {
      note.textContent = 'Please enter a valid business email.';
      return;
    }
    // Fire the identity event (fail-open — never block the confirmation).
    try {
      sendEvent({ xdm: buildIdentityXdm(fields) }).catch(() => {});
    } catch (e) { /* non-fatal */ }
    note.textContent = 'Thanks — we’ll be in touch shortly.';
    btn.disabled = true;
  });

  block.replaceChildren(...children);
}
