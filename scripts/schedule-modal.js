/**
 * schedule-modal — shared "Schedule a call" modal, used by any CTA on any
 * page (nav CTA in blocks/header, hero CTA in blocks/hero, ...). Content is
 * a DA fragment (content/fragments/schedule-call.html) fetched via the
 * fragment block's loadFragment() helper, so the form is editable in DA
 * without a code change. Built once, fetched once, reused across opens.
 */
// eslint-disable-next-line import/no-cycle
import { loadFragment } from '../blocks/fragment/fragment.js';
import { loadSections } from './aem.js';

const SCHEDULE_CALL_FRAGMENT = '/fragments/schedule-call';

let overlay;
let body;
let load;
let lastFocused;

// onKeydown/closeScheduleModal are mutually referential hoisted function
// declarations; safe at runtime, not a bug.
function onKeydown(e) {
  // eslint-disable-next-line no-use-before-define
  if (e.key === 'Escape') closeScheduleModal();
}

// eslint-disable-next-line import/prefer-default-export
export function closeScheduleModal() {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onKeydown);
  if (lastFocused) lastFocused.focus();
}

function build() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'schedule-modal-overlay';
  overlay.innerHTML = `
    <div class="schedule-modal" role="dialog" aria-modal="true" aria-label="Schedule a call">
      <button type="button" class="schedule-modal-close" aria-label="Close">&times;</button>
      <div class="schedule-modal-body">
        <p class="schedule-modal-loading">Loading&hellip;</p>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeScheduleModal(); });
  overlay.querySelector('.schedule-modal-close').addEventListener('click', closeScheduleModal);
  document.body.append(overlay);
  body = overlay.querySelector('.schedule-modal-body');
  return overlay;
}

export async function openScheduleModal() {
  lastFocused = document.activeElement;
  build();
  overlay.classList.add('is-open');
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKeydown);
  overlay.querySelector('.schedule-modal-close').focus();

  if (!load) load = loadFragment(SCHEDULE_CALL_FRAGMENT);
  const fragment = await load;
  if (fragment) {
    // Clone rather than move: fragment is cached and reused on every open,
    // and replaceChildren() with the live nodes would strip them out of
    // fragment on the first use, leaving it (and every reopen after) empty.
    body.replaceChildren(...[...fragment.childNodes].map((n) => n.cloneNode(true)));

    // cloneNode() copies DOM + attributes but NOT event listeners, so the
    // cloned form's Schedule-a-call handler (attached by form.js during the
    // fragment's initial decoration) is lost. Re-decorate the clones: the
    // clone carries blockStatus/sectionStatus "loaded", which loadBlock and
    // loadSection both skip — reset them to "initialized" so loadSections
    // re-runs form.js's decorate() on the clone and re-binds the handler.
    body.querySelectorAll('[data-block-status]').forEach((b) => { b.dataset.blockStatus = 'initialized'; });
    body.querySelectorAll('.section[data-section-status]').forEach((s) => { s.dataset.sectionStatus = 'initialized'; });
    await loadSections(body);
  } else {
    body.textContent = 'Sorry, something went wrong loading this form. Please try again.';
  }
}

export function bindScheduleLinks(container) {
  container.querySelectorAll('a[href="#schedule"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openScheduleModal();
    });
  });
}
