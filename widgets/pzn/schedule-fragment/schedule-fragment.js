/**
 * PZN widget: opens the "Schedule a call" modal with a different fragment.
 * Params: fragment (required), trigger (CSS selector, optional).
 */
import { openModal } from '../../../blocks/modal/modal.js';
import { withTriggerLoading } from '../../../scripts/schedule-modal.js';

const DEFAULT_TRIGGER = 'a[href$="#schedule"], header .nav-cta';

// Latest widget per trigger, so a swapped-in variant replaces the previous one.
const activeWidgets = new Map();

export function resolveFragmentPath(value) {
  const path = (value || '').trim();
  if (!path) return null;
  return path.startsWith('/') ? path : `/fragments/${path}`;
}

export default async function decorate(widget) {
  if (!resolveFragmentPath(widget.dataset.fragment)) return;
  const trigger = widget.dataset.trigger || DEFAULT_TRIGGER;
  const firstBind = !activeWidgets.has(trigger);
  activeWidgets.set(trigger, widget);
  if (!firstBind) return;

  // Capture phase so this runs before the default schedule handler.
  document.addEventListener('click', (e) => {
    const current = activeWidgets.get(trigger);
    // The variant was removed (e.g. back to default): leave the CTA to the baseline handler.
    if (!current?.isConnected) return;
    const cta = e.target.closest(trigger);
    if (!cta || cta.dataset.chilipiperTrigger === 'true') return;
    e.stopPropagation();
    e.preventDefault();
    if (cta.getAttribute('aria-disabled') === 'true') return;
    const fragment = resolveFragmentPath(current.dataset.fragment);
    withTriggerLoading(cta, () => openModal(fragment));
  }, true);
}
