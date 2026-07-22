/**
 * download-form — gated-content CTA band for research guides/whitepapers:
 * dark split band with promotional copy on the left and a lead-gen form
 * card on the right, matching erp.intuit.com's "Download the full report"
 * band. The 5-field form itself reuses blocks/form/form.js (imported and
 * invoked directly on a scratch element) rather than re-implementing it —
 * that block's CSS is loaded on demand since this block builds a `.form`
 * element dynamically, so it's never in the initial per-page block scan
 * that would otherwise pick up its stylesheet automatically.
 *
 * Authoring: one row, two cells —
 *   1. left copy (h2/h3 + paragraph + optional <ul>), dark background
 *   2. card heading (e.g. "Download the full report")
 *
 * There's no real backend to email a PDF to, so "submitting" validates the
 * fields are filled in, then generates and downloads a small text summary
 * client-side — a real file download, not just a simulated success state.
 * CSS: blocks/download-form/download-form.css
 */
import { loadCSS } from '../../scripts/aem.js';
import formDecorate from '../form/form.js';

function triggerDownload(title) {
  const slug = window.location.pathname.split('/').pop() || 'report';
  const content = `${title}\n\n`
    + 'Thanks for your interest in this Intuit Enterprise Suite research report.\n'
    + 'This is a placeholder download standing in for the full PDF report.\n';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireSubmit(formEl, card) {
  const btn = formEl.querySelector('.form-submit');
  const inputs = [...formEl.querySelectorAll('input')];
  btn.addEventListener('click', () => {
    const missing = inputs.filter((input) => !input.value.trim());
    inputs.forEach((input) => input.classList.toggle('invalid', !input.value.trim()));
    if (missing.length) {
      missing[0].focus();
      return;
    }
    const title = document.querySelector('h1')?.textContent || document.title;
    triggerDownload(title);
    const success = document.createElement('div');
    success.className = 'download-success';
    success.innerHTML = '<p>Thanks! Your download has started.</p>';
    card.replaceChildren(success);
  });
}

export default function decorate(block) {
  loadCSS(`${window.hlx.codeBasePath}/blocks/form/form.css`);
  const row = block.querySelector(':scope > div');
  const cells = row ? [...row.children] : [];
  const [copyCell, cardHeadingCell] = cells;

  block.id = 'download';

  const grid = document.createElement('div');
  grid.className = 'download-grid';

  const copy = document.createElement('div');
  copy.className = 'download-copy';
  if (copyCell) [...copyCell.childNodes].forEach((n) => copy.append(n));

  const card = document.createElement('div');
  card.className = 'download-card';
  const heading = document.createElement('h3');
  heading.textContent = cardHeadingCell ? cardHeadingCell.textContent.trim() : 'Download the full report';
  card.append(heading);

  const formEl = document.createElement('div');
  formEl.className = 'form boxed';
  formDecorate(formEl);
  const submitBtn = formEl.querySelector('.form-submit');
  if (submitBtn) submitBtn.textContent = 'Download the report';
  card.append(formEl);

  grid.append(copy, card);
  block.replaceChildren(grid);

  wireSubmit(formEl, card);
}
