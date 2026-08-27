/**
 * PZN treatment for the "Form vs ChiliPiper" access point
 * (SBSEGICOMMContentFormvschilipiperHero, /construction/).
 *
 * Treatment: clicking the "Schedule a call" CTA opens ChiliPiper directly instead of the
 * Marketo form. Reuses the shared ChiliPiper opener (scripts/chilipiper.js) — subdomain and
 * script URL come from /site-config.json. Control (the Marketo form) is the page baseline, so
 * there is no control fragment.
 *
 * Author config (widget href query params → widget.dataset):
 *   router  – ChiliPiper router (default: cal-first-construction)
 *   trigger – CSS selector for the CTA (default: [data-wa-link="chilipiper-submit"])
 */
import { openChiliPiper } from '../../../scripts/chilipiper.js';

const DEFAULT_ROUTER = 'cal-first-construction';
const DEFAULT_TRIGGER = '[data-wa-link="chilipiper-submit"]';

export default async function decorate(widget) {
  const router = widget.dataset.router || DEFAULT_ROUTER;
  const trigger = widget.dataset.trigger || DEFAULT_TRIGGER;

  // One delegated click listener on the document — the CTA may render or be replaced later.
  // Idempotent per trigger selector so a re-run of the widget can't double-bind.
  const key = `chilipiper:${trigger}`;
  const bound = (document.documentElement.dataset.chilipiperBound || '').split('|').filter(Boolean);
  if (bound.includes(key)) return;
  bound.push(key);
  document.documentElement.dataset.chilipiperBound = bound.join('|');

  document.addEventListener('click', (e) => {
    if (!e.target.closest(trigger)) return;
    e.preventDefault();
    openChiliPiper(router);
  });
}
