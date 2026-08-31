/**
 * Shared "Schedule a call" modal — hosts the schedule-call fragment (which
 * authors its own form block) in the reusable modal block. Lives here (not in
 * blocks/form/form.js) so both core scripts and any block can use it without
 * creating a scripts-depends-on-block or block-depends-on-block edge.
 */
import { getMetadata } from './aem.js';

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

// Any anchor whose href ends with #schedule opens the modal instead of
// navigating — covers both `#schedule` and stray absolute URLs ending in it.
// Called from multiple content-injection points (initial page load, fragments,
// modals), so it's idempotent: a `data-schedule-bound` flag skips anchors that
// already have the listener rather than double-binding them.
export function bindScheduleLinks(container) {
  container.querySelectorAll('a[href$="#schedule"]:not([data-schedule-bound])').forEach((a) => {
    a.dataset.scheduleBound = 'true';
    a.addEventListener('click', (e) => {
      if (a.dataset.chilipiperTrigger === 'true') return;
      e.preventDefault();
      openScheduleModal();
    });
  });
}
