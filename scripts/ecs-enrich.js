/**
 * ECS beacon ENRICH — one eager shim that backfills the values the injected `ies-erp` profile
 * used to get from Next.js SSR (`__NEXT_DATA__`), which does not exist on Edge Delivery. It traps
 * `window.intuit.tracking.ecs` once (before utag.js loads) and wraps its sender calls:
 *
 *   - webAnalytics.trackPage — fills personalization_details / experiment_ids before ECS prepares
 *     the page payload;
 *   - analytics.page — restores those fields at the final Segment boundary in case ECS preparation
 *     filtered them;
 *   - track (content:* clicks)  — fills page_cas_id + global experiment_ids.
 *
 * One module, one trap, no double-fire, no profile change. Kept together (same bucket, one fetch on
 * the LCP path). Install in the eager phase; skipped with ?martech=off.
 *
 * FIXME: temporary client-side shim. Remove once Intuit's profile page-init reads window.appVars /
 * the runtime pathname directly (option C) — then this enrichment is redundant.
 */

// Per-method wrap markers (Symbols → no collision, hidden from JSON/keys); each wrap is
// independently idempotent, so installing (wraps both) and standalone use each no-op on a re-wrap.
const WRAPPED_PAGE = Symbol('ecsWrappedPage');
const WRAPPED_SEGMENT_PAGE = Symbol('ecsWrappedSegmentPage');
const WRAPPED_EVENT = Symbol('ecsWrappedEvent');

let currentClick;
let interactionSchedulingInstalled = false;
let trackTaskScheduled = false;
const pendingTrackJobs = [];

// The tracker treats null/undefined, '', or [] as "no value".
function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

// ---- page-view (trackPage): personalization_details / experiment_ids ------------------------

/** Page-level personalization_details: page recs win over section, else `[]` (never null). */
export function personalizationDetails(appVars = {}) {
  const page = Array.isArray(appVars.pznPageRecDetailsArr) ? appVars.pznPageRecDetailsArr : [];
  const section = Array.isArray(appVars.pznRecDetailsArr) ? appVars.pznRecDetailsArr : [];
  if (page.length) return page;
  if (section.length) return section;
  return [];
}

/** `id:ver:treatment|…` from ixpDetailsArr; also sets `window.ixp.xt`. @returns {String} */
export function experimentTrackString(ixpDetailsArr) {
  if (!Array.isArray(ixpDetailsArr) || !ixpDetailsArr.length) return '';
  const xt = ixpDetailsArr
    .map((d) => `${d.experiment_id}:${d.experiment_version}:${d.experiment_treatment}`)
    .join('|');
  if (xt && typeof window !== 'undefined') {
    window.ixp = window.ixp || {};
    window.ixp.xt = xt;
  }
  return xt;
}

/**
 * Fills a trackPage payload's personalization_details / experiment_ids from appVars, but only where
 * the profile left them empty (never clobbers). Mutates and returns `payload`.
 */
export function enrichPagePayload(payload, appVars = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (isEmpty(payload.personalization_details)) {
    const pd = personalizationDetails(appVars);
    if (pd.length) payload.personalization_details = pd;
  }
  if (isEmpty(payload.experiment_ids)) {
    const xt = experimentTrackString(appVars.ixpDetailsArr); // also publishes window.ixp.xt
    if (xt) payload.experiment_ids = xt;
  }
  return payload;
}

/** Wraps `wa.trackPage` to enrich each call (idempotent, reads appVars live, fail-open). */
export function wrapTrackPage(wa) {
  if (!wa || typeof wa.trackPage !== 'function' || wa[WRAPPED_PAGE]) return;
  const original = wa.trackPage.bind(wa);
  wa.trackPage = function enrichedTrackPage(payload, ...rest) {
    try {
      enrichPagePayload(payload, (typeof window !== 'undefined' && window.appVars) || {});
    } catch (e) {
      // fail-open — enrichment must never block the real call
    }
    return original(payload, ...rest);
  };
  wa[WRAPPED_PAGE] = true;
}

// ---- click (track): page_cas_id + global experiment_ids ----------------------------------

/** The content identifier: the page pathname (OVERRIDES.md — no cas-id metadata anymore). */
export const pageCasId = () => (typeof window !== 'undefined' ? window.location.pathname : '');

/** Fills page context where the profile left it empty. Mutates + returns. */
export function enrichEventPayload(payload, appVars = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (isEmpty(payload.page_cas_id)) payload.page_cas_id = pageCasId();
  if (isEmpty(payload.experiment_ids)) {
    const xt = experimentTrackString(appVars.ixpDetailsArr);
    if (xt) payload.experiment_ids = xt;
  }
  return payload;
}

function clickMayUnloadPage(event) {
  if (!event || event.defaultPrevented || event.button > 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const target = typeof event.target?.closest === 'function'
    ? event.target
    : event.target?.parentElement;
  const control = target?.closest('a[href], area[href], button, input');
  if (!control) return false;

  if (control.matches('a[href], area[href]')) {
    if (control.hasAttribute('download')) return false;
    const browsingContext = control.target
      || document.querySelector('base[target]')?.target
      || '_self';
    if (browsingContext.toLowerCase() !== '_self') return false;
    try {
      const destination = new URL(control.href, window.location.href);
      const current = new URL(window.location.href);
      const sameDocument = destination.origin === current.origin
        && destination.pathname === current.pathname
        && destination.search === current.search
        && destination.hash;
      return !sameDocument;
    } catch (e) {
      return true;
    }
  }

  if (!control.form || !['submit', 'image'].includes(control.type)) return false;
  const browsingContext = control.formTarget || control.form.target || '_self';
  return browsingContext.toLowerCase() === '_self';
}

function runTrackJob(track) {
  try {
    track();
  } catch (e) {
    // fail-open — a deferred analytics failure must not surface as an unhandled rejection
  }
}

function scheduleNextTrackJob() {
  if (trackTaskScheduled || !pendingTrackJobs.length) return;
  trackTaskScheduled = true;
  const run = () => {
    trackTaskScheduled = false;
    const track = pendingTrackJobs.shift();
    if (track) runTrackJob(track);
    scheduleNextTrackJob();
  };
  try {
    if (typeof window.scheduler?.postTask === 'function') {
      window.scheduler.postTask(run, { priority: 'background' });
    } else {
      window.setTimeout(run, 0);
    }
  } catch (e) {
    window.setTimeout(run, 0);
  }
}

function enqueueTrackJob(track) {
  pendingTrackJobs.push(track);
  scheduleNextTrackJob();
}

function flushTrackJobs() {
  trackTaskScheduled = false;
  while (pendingTrackJobs.length) runTrackJob(pendingTrackJobs.shift());
}

function installInteractionScheduling() {
  if (interactionSchedulingInstalled || typeof document === 'undefined') return;
  interactionSchedulingInstalled = true;
  document.addEventListener('click', (event) => {
    currentClick = event;
    window.setTimeout(() => {
      if (currentClick === event) currentClick = undefined;
    }, 0);
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTrackJobs();
  }, true);
  window.addEventListener('pagehide', flushTrackJobs, true);
}

/** Wraps `wa.track` to enrich each event/click payload (idempotent, fail-open). */
export function wrapTrack(wa) {
  if (!wa || typeof wa.track !== 'function' || wa[WRAPPED_EVENT]) return;
  const original = wa.track.bind(wa);
  wa.track = function enrichedTrack(payload, ...rest) {
    try {
      enrichEventPayload(payload, (typeof window !== 'undefined' && window.appVars) || {});
    } catch (e) {
      // fail-open — enrichment must never block the real beacon
    }
    if (currentClick && currentClick.eventPhase !== 0 && !clickMayUnloadPage(currentClick)) {
      return enqueueTrackJob(() => original(payload, ...rest));
    }
    return original(payload, ...rest);
  };
  wa[WRAPPED_EVENT] = true;
}

// ---- install --------------------------------------------------------------------------------

/** Runs `cb(obj[key])` now if set, else on assignment via a one-shot accessor trap (race-free). */
export function whenAssigned(obj, key, cb) {
  if (obj[key] != null) { cb(obj[key]); return; }
  let stored;
  try {
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(v) { stored = v; try { cb(v); } catch (e) { /* fail-open */ } },
    });
  } catch (e) {
    // non-configurable — cannot trap; best-effort no-op
  }
}

/**
 * Enriches the final Segment page properties. The live ECS sender rebuilds the payload after
 * webAnalytics.trackPage, so runtime-only fields must also be restored on analytics.page's third
 * argument immediately before Segment receives it.
 */
export function wrapSegmentPage(analytics) {
  if (!analytics || typeof analytics !== 'object') return;
  whenAssigned(analytics, 'page', (page) => {
    if (typeof page !== 'function' || page[WRAPPED_SEGMENT_PAGE]) return;
    const original = page.bind(analytics);
    const wrapped = function enrichedSegmentPage(category, name, properties, ...rest) {
      try {
        enrichPagePayload(properties, (typeof window !== 'undefined' && window.appVars) || {});
      } catch (e) {
        // fail-open — enrichment must never block the real call
      }
      return original(category, name, properties, ...rest);
    };
    wrapped[WRAPPED_SEGMENT_PAGE] = true;
    try { analytics.page = wrapped; } catch (e) { /* non-writable — best-effort no-op */ }
  });
}

/**
 * Traps window.intuit.tracking.ecs sender objects and wraps page + click calls (each independently
 * idempotent). Call in the eager phase, before utag.js loads.
 */
export default function installEcsEnrich() {
  if (typeof window === 'undefined') return;
  installInteractionScheduling();
  whenAssigned(window, 'intuit', (intuit) => {
    if (!intuit || typeof intuit !== 'object') return;
    whenAssigned(intuit, 'tracking', (tracking) => {
      if (!tracking || typeof tracking !== 'object') return;
      whenAssigned(tracking, 'ecs', (ecs) => {
        if (!ecs || typeof ecs !== 'object') return;
        whenAssigned(ecs, 'analytics', wrapSegmentPage);
        whenAssigned(ecs, 'webAnalytics', (wa) => { wrapTrack(wa); wrapTrackPage(wa); });
      });
    });
  });
}
