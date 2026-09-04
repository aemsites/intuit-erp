export const LAZY_PHASE_COMPLETE_EVENT = 'hlx:lazy-phase-complete';

/**
 * Runs a callback once the EDS lazy phase has completed.
 * @param {Function} callback work that must not compete with lazy loading
 */
export function onLazyPhaseComplete(callback) {
  if (window.hlx?.lazyPhaseComplete) {
    callback();
    return;
  }
  window.addEventListener(LAZY_PHASE_COMPLETE_EVENT, callback, { once: true });
}

/** Marks the EDS lazy phase complete and releases deferred work. */
export function markLazyPhaseComplete() {
  window.hlx = window.hlx || {};
  if (window.hlx.lazyPhaseComplete) return;
  window.hlx.lazyPhaseComplete = true;
  window.dispatchEvent(new Event(LAZY_PHASE_COMPLETE_EVENT));
}
