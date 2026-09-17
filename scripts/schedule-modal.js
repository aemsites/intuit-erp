/**
 * Shared "Schedule a call" modal — hosts the schedule-call fragment (which
 * authors its own form block) in the reusable modal block. Lives here (not in
 * blocks/form/form.js) so both core scripts and any block can use it without
 * creating a scripts-depends-on-block or block-depends-on-block edge.
 */
import { getMetadata } from './aem.js';
import { labelFor, slug } from './tracking.js';

const SCHEDULE_FRAGMENT_DEFAULT = '/fragments/schedule-call-vertical';

// A page can point the "Schedule a call" modal at a different fragment via
// `schedule-fragment` metadata — same override convention as blog-template.js's
// right-rail fragment (bare name resolves under /fragments/, absolute path used as-is).
function scheduleFragmentPath() {
  const value = getMetadata('schedule-fragment') || SCHEDULE_FRAGMENT_DEFAULT;
  return value.startsWith('/') ? value : `/fragments/${value}`;
}

export async function openScheduleModal() {
  // eslint-disable-next-line import/no-cycle
  const { openModal } = await import('../blocks/modal/modal.js');
  return openModal(scheduleFragmentPath());
}

// Same-trigger reentrancy lock, set synchronously before withTriggerLoading's first await.
const inFlightTriggers = new WeakSet();

// Marks the brief "modal is loading" state, distinct from aria-disabled's own
// (pre-existing) CSS: `a.button[aria-disabled="true"]` in styles.css washes a button
// out to --light-color for a genuinely-disabled look (relied on by, e.g.,
// blocks/assessment/assessment.js's quiz-gated CTA). That's wrong for a loading spinner
// that lasts a second — this class gets its own, milder styling instead.
function clearTriggerLoading(trigger) {
  trigger.removeAttribute('aria-disabled');
  trigger.classList.remove('modal-trigger-loading');
}

// Shared loading/disabled UI for any element that opens the shared modal.
// `openFn` must resolve to the opened <dialog>, or null if a modal was already active.
export async function withTriggerLoading(trigger, openFn) {
  if (inFlightTriggers.has(trigger)) return;
  inFlightTriggers.add(trigger);
  try {
    // eslint-disable-next-line import/no-cycle
    const { isModalActive } = await import('../blocks/modal/modal.js');
    // Another trigger's modal is already active — no-op, no visual change here.
    if (isModalActive()) return;

    trigger.setAttribute('aria-disabled', 'true');
    trigger.classList.add('modal-trigger-loading');
    const spinner = document.createElement('span');
    spinner.className = 'modal-trigger-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    trigger.append(spinner);
    let dialog;
    try {
      dialog = await openFn();
    } catch (err) {
      // Don't strand this trigger disabled forever on a construction error.
      spinner.remove();
      clearTriggerLoading(trigger);
      throw err;
    }
    spinner.remove();
    if (!dialog) {
      // Blocked by a concurrent open, or the open failed before a dialog existed.
      clearTriggerLoading(trigger);
      return;
    }
    dialog.addEventListener('close', () => {
      clearTriggerLoading(trigger);
    }, { once: true });
  } finally {
    inFlightTriggers.delete(trigger);
  }
}

// Any anchor whose href ends with #schedule opens the modal instead of
// navigating — covers both `#schedule` and stray absolute URLs ending in it.
// Called from multiple content-injection points (initial page load, fragments,
// modals), so it's idempotent: a `data-schedule-bound` flag skips anchors that
// already have the listener rather than double-binding them.
export function bindScheduleLinks(container) {
  container.querySelectorAll('a[href$="#schedule"]:not([data-schedule-bound])').forEach((a) => {
    if (!a.hasAttribute('data-track-id') && !a.closest('.block')) {
      const identity = slug(labelFor(a));
      if (identity) a.dataset.trackId = `page:${identity}`;
    }
    a.dataset.scheduleBound = 'true';
    a.addEventListener('click', (e) => {
      if (a.dataset.chilipiperTrigger === 'true') return;
      e.preventDefault();
      if (a.getAttribute('aria-disabled') === 'true') return;
      withTriggerLoading(a, () => openScheduleModal());
    });
  });
}
