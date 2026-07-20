/**
 * form — "Let's connect" static lead form (accounting, compare, erp-solutions).
 * Heading / subtext / accountant link / consent are authored as default content
 * (a trailing default-content paragraph becomes the reCAPTCHA note). The block
 * renders the fixed 5-field form. Rendered non-submitting (EDS CSP blocks inline
 * handlers) — a <div> wrapper with <button type="button">.
 *
 * Variants: (default) underline inputs (accounting) · .boxed labelled boxes
 * (compare) · .sky sky band + hidden labels (erp-solutions).
 * CSS: blocks/form/form.css
 */
const FIELDS = [
  ['First name*', 'text'],
  ['Last name*', 'text'],
  ['Business name*', 'text'],
  ['Business email*', 'email'],
  ['Business phone*', 'tel'],
];

export default function decorate(block) {
  const form = document.createElement('div');
  form.className = 'lead-fields';
  FIELDS.forEach(([label, type]) => {
    const l = document.createElement('label');
    l.className = 'ff';
    l.innerHTML = `<span>${label}</span><input type="${type}" placeholder="${label}" aria-label="${label.replace('*', '')}">`;
    form.append(l);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'form-submit';
  btn.textContent = 'Schedule a call';
  form.append(btn);
  block.replaceChildren(form);
}
