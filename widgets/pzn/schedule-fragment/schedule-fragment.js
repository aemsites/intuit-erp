/**
 * PZN treatment that points the shared "Schedule a call" modal at a different fragment — e.g.
 * a variant whose form heading is written for the visitor's customer state. Authored inside a
 * PZN/IXP variant fragment; the page's `schedule-fragment` metadata (or the default) stays the
 * control, so a visitor without the variant gets the baseline form.
 *
 * Author config (widget href query params → widget.dataset):
 *   fragment – path of the fragment to open (required; bare name resolves under /fragments/)
 *   trigger  – CSS selector for the CTAs (default: every #schedule link + the header nav CTA)
 */
import { openModal } from '../../../blocks/modal/modal.js';
import { withTriggerLoading } from '../../../scripts/schedule-modal.js';

const DEFAULT_TRIGGER = 'a[href$="#schedule"], header .nav-cta';

// Same bare-name convention as the `schedule-fragment` page metadata.
export function resolveFragmentPath(value) {
  const path = (value || '').trim();
  if (!path) return null;
  return path.startsWith('/') ? path : `/fragments/${path}`;
}

export default async function decorate(widget) {
  const fragment = resolveFragmentPath(widget.dataset.fragment);
  if (!fragment) return;
  const trigger = widget.dataset.trigger || DEFAULT_TRIGGER;

  // Idempotent per trigger selector so a re-run of the widget can't double-bind.
  const key = `schedule-fragment:${trigger}`;
  const bound = (document.documentElement.dataset.scheduleFragmentBound || '').split('|').filter(Boolean);
  if (bound.includes(key)) return;
  bound.push(key);
  document.documentElement.dataset.scheduleFragmentBound = bound.join('|');

  // Capture before the baseline schedule handler; CTAs may render or be replaced later.
  document.addEventListener('click', (e) => {
    const cta = e.target.closest(trigger);
    // A ChiliPiper treatment owns the CTA when it has claimed it.
    if (!cta || cta.dataset.chilipiperTrigger === 'true') return;
    e.stopPropagation();
    e.preventDefault();
    if (cta.getAttribute('aria-disabled') === 'true') return;
    withTriggerLoading(cta, () => openModal(fragment));
  }, true);
}
