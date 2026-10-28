/**
 * PZN widget: opens the "Schedule a call" modal with a different fragment.
 * Params: fragment (required), trigger (CSS selector, optional).
 */
import { openModal } from '../../../blocks/modal/modal.js';
import { withTriggerLoading } from '../../../scripts/schedule-modal.js';

const DEFAULT_TRIGGER = 'a[href$="#schedule"], header .nav-cta';

export function resolveFragmentPath(value) {
  const path = (value || '').trim();
  if (!path) return null;
  return path.startsWith('/') ? path : `/fragments/${path}`;
}

export default async function decorate(widget) {
  const fragment = resolveFragmentPath(widget.dataset.fragment);
  if (!fragment) return;
  const trigger = widget.dataset.trigger || DEFAULT_TRIGGER;

  const key = `schedule-fragment:${trigger}`;
  const bound = (document.documentElement.dataset.scheduleFragmentBound || '').split('|').filter(Boolean);
  if (bound.includes(key)) return;
  bound.push(key);
  document.documentElement.dataset.scheduleFragmentBound = bound.join('|');

  // Capture phase so this runs before the default schedule handler.
  document.addEventListener('click', (e) => {
    const cta = e.target.closest(trigger);
    if (!cta || cta.dataset.chilipiperTrigger === 'true') return;
    e.stopPropagation();
    e.preventDefault();
    if (cta.getAttribute('aria-disabled') === 'true') return;
    withTriggerLoading(cta, () => openModal(fragment));
  }, true);
}
