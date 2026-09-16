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

    // Some triggers own `aria-disabled` as a content state of their own (the
    // assessment CTA gates on the visitor's answers), so put back whatever was
    // there instead of clearing it outright.
    const wasDisabled = trigger.getAttribute('aria-disabled');
    const restoreDisabled = () => {
      if (wasDisabled === null) trigger.removeAttribute('aria-disabled');
      else trigger.setAttribute('aria-disabled', wasDisabled);
    };

    // Read the trigger's current look before `aria-disabled` (which some buttons —
    // e.g. `a.button.primary` — already swap to a lighter disabled palette of their
    // own) and `is-modal-loading` change anything: reading after would both race
    // `a.button`'s own `color`/`background-color` transition and pin the spinner to
    // that disabled palette instead of the button's real one.
    const originalColor = getComputedStyle(trigger).color;
    const originalBackground = getComputedStyle(trigger).backgroundColor;
    const originalBorderColor = getComputedStyle(trigger).borderColor;

    trigger.setAttribute('aria-disabled', 'true');
    trigger.setAttribute('aria-busy', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'modal-trigger-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    // `is-modal-loading` blanks the label with `color: transparent` so the
    // overlaid spinner reads cleanly; pin the spinner and the button's own chrome
    // to the colours the trigger had beforehand, since `currentcolor` would go
    // transparent with it and `aria-disabled`'s own styling would otherwise wash
    // the button out underneath the spinner.
    spinner.style.setProperty('--modal-trigger-spinner-color', originalColor);
    trigger.style.setProperty('--modal-trigger-original-bg', originalBackground);
    trigger.style.setProperty('--modal-trigger-original-border', originalBorderColor);
    trigger.classList.add('is-modal-loading');
    trigger.append(spinner);

    const endLoading = () => {
      spinner.remove();
      trigger.classList.remove('is-modal-loading');
      trigger.removeAttribute('aria-busy');
      trigger.style.removeProperty('--modal-trigger-original-bg');
      trigger.style.removeProperty('--modal-trigger-original-border');
    };

    let dialog;
    try {
      dialog = await openFn();
    } catch (err) {
      // Don't strand this trigger disabled forever on a construction error.
      endLoading();
      restoreDisabled();
      throw err;
    }
    endLoading();
    if (!dialog) {
      // Blocked by a concurrent open, or the open failed before a dialog existed.
      restoreDisabled();
      return;
    }
    dialog.addEventListener('close', restoreDisabled, { once: true });
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
