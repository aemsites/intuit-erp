/**
 * form — "Let's connect" static lead form (accounting, compare, erp-solutions).
 * Heading / subtext / accountant link / consent are authored as default content
 * (a trailing default-content paragraph becomes the reCAPTCHA note). The block
 * renders the fixed 5-field form. CSP-safe: no inline handlers — the submit
 * handler is attached in JS. On submit with a valid business email it fires an
 * identity sendEvent (Act 2 RTCDP stitch), then shows a confirmation.
 *
 * Variants: (default) underline inputs (accounting) · .boxed labelled boxes
 * (compare) · .sky sky band + hidden labels (erp-solutions).
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

  const note = document.createElement('p');
  note.className = 'form-note';
  note.setAttribute('aria-live', 'polite');

  btn.addEventListener('click', () => {
    const fields = Object.fromEntries(
      Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]),
    );
    if (!isValidBusinessEmail(fields.email)) {
      note.textContent = 'Please enter a valid business email.';
      return;
    }
    // Fire the identity event (fail-open — never block the confirmation).
    try { sendEvent(buildIdentityXdm(fields)).catch(() => {}); } catch (e) { /* non-fatal */ }
    note.textContent = 'Thanks — we’ll be in touch shortly.';
    btn.disabled = true;
  });

  block.replaceChildren(form, note);
}
