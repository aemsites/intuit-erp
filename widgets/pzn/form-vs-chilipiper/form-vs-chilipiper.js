/**
 * PZN treatment for the "Form vs ChiliPiper" access point
 * (SBSEGICOMMCRFormvschilipiperHero, /construction/).
 *
 * Treatment: clicking the "Schedule a call" CTA opens a ChiliPiper round-robin scheduler in a
 * modal instead of the Marketo form. Faithful port of the OICMS snippet — a first-party iframe to
 * the round-robin URL carrying a freshly minted lead_xref_id (the id ChiliPiper/CRM correlates
 * on) — rendered in the shared modal (blocks/modal/modal.js) rather than a hand-rolled overlay.
 * Control (the Marketo form) is the page baseline, so there is no control fragment.
 *
 * Author config (widget href query params → widget.dataset):
 *   base    – round-robin base URL (default: intuitsales cal-first-construction)
 *   trigger – CSS selector for the CTA (default: the header "Schedule a call" nav CTA)
 */
import { createModal } from '../../../blocks/modal/modal.js';

const DEFAULT_BASE = 'https://intuitsales.chilipiper.com/round-robin/cal-first-construction';
const DEFAULT_TRIGGER = 'header .nav-cta';

// RFC4122 v4 UUID — native when available, else a Math.random fallback (matches the OICMS snippet).
export function createUUID() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // eslint-disable-next-line no-bitwise
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    // eslint-disable-next-line no-bitwise
    const r = (Math.random() * 16) | 0;
    // eslint-disable-next-line no-bitwise
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The round-robin URL for one booking, carrying a fresh lead_xref_id.
export function buildChiliPiperUrl(base = DEFAULT_BASE) {
  const leadXrefId = createUUID();
  const sep = base.includes('?') ? '&' : '?';
  return { url: `${base}${sep}lead_xref_id=${encodeURIComponent(leadXrefId)}`, leadXrefId };
}

async function openChiliPiperModal(base) {
  // The lead_xref_id rides in the iframe URL (below); the ies-erp container correlates on that,
  // so there's no window global to publish.
  const { url } = buildChiliPiperUrl(base);
  const iframe = document.createElement('iframe');
  iframe.className = 'chilipiper-embed';
  iframe.title = 'Schedule a meeting';
  iframe.src = url;
  iframe.setAttribute('data-chilipiper', 'true');
  iframe.setAttribute('allow', 'camera; microphone; fullscreen');
  iframe.loading = 'eager';
  const { showModal } = await createModal([iframe]);
  showModal();
}

export default async function decorate(widget) {
  const base = widget.dataset.base || DEFAULT_BASE;
  const trigger = widget.dataset.trigger || DEFAULT_TRIGGER;

  document.querySelectorAll(trigger).forEach((cta) => {
    cta.dataset.chilipiperTrigger = 'true';
  });

  // Capture before the baseline schedule handler; the CTA may render or be replaced later.
  // Idempotent per trigger selector so a re-run of the widget can't double-bind.
  const key = `chilipiper:${trigger}`;
  const bound = (document.documentElement.dataset.chilipiperBound || '').split('|').filter(Boolean);
  if (bound.includes(key)) return;
  bound.push(key);
  document.documentElement.dataset.chilipiperBound = bound.join('|');

  document.addEventListener('click', (e) => {
    const cta = e.target.closest(trigger);
    if (!cta) return;
    cta.dataset.chilipiperTrigger = 'true';
    e.stopPropagation();
    e.preventDefault();
    openChiliPiperModal(base);
  }, true);
}
