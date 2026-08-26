/**
 * Page-view personalization ENRICH. Wraps the profile's own webAnalytics.trackPage and fills
 * personalization_details / experiment_ids from window.appVars — one enriched screen:viewed, no
 * double-fire, no profile change. Must install in the eager phase (before utag.js loads).
 * See APPVARS.md#page-view-personalization.
 *
 * FIXME(pzn): temporary client-side shim. Remove once Intuit's profile page-init reads
 * window.appVars directly (option C) — then this enrichment is redundant.
 */

// Marks an already-wrapped trackPage (Symbol → no collision, hidden from JSON/keys).
const ENRICHED = Symbol('pznEnriched');

// The tracker treats null/undefined, '', or [] as "no personalization".
function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

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
  if (!wa || typeof wa.trackPage !== 'function' || wa[ENRICHED]) return;
  const original = wa.trackPage.bind(wa);
  wa.trackPage = function enrichedTrackPage(payload, ...rest) {
    try {
      enrichPagePayload(payload, (typeof window !== 'undefined' && window.appVars) || {});
    } catch (e) {
      // fail-open — enrichment must never block the real call
    }
    return original(payload, ...rest);
  };
  wa[ENRICHED] = true;
}

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

/** Traps window.intuit.tracking.ecs.webAnalytics and wraps trackPage. Call in the eager phase. */
export default function installPznPageViewEnrich() {
  if (typeof window === 'undefined') return;
  whenAssigned(window, 'intuit', (intuit) => {
    if (!intuit || typeof intuit !== 'object') return;
    whenAssigned(intuit, 'tracking', (tracking) => {
      if (!tracking || typeof tracking !== 'object') return;
      whenAssigned(tracking, 'ecs', (ecs) => {
        if (!ecs || typeof ecs !== 'object') return;
        whenAssigned(ecs, 'webAnalytics', (wa) => wrapTrackPage(wa));
      });
    });
  });
}
