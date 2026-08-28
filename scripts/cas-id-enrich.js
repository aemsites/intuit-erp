/**
 * page_cas_id ENRICH. The injected `ies-erp` profile sources `page_cas_id` from the legacy
 * Next.js SSR payload (`__NEXT_DATA__`), which does not exist on Edge Delivery — so our click
 * beacons ship without it (verified: `page_cas_id` absent on ~60/65 captured beacons). Per
 * OVERRIDES.md / APPVARS.md the content identifier is now the page pathname, so we fill
 * `page_cas_id = window.location.pathname` on each ECS `track()` payload where the profile left it
 * empty — the same wrap-the-tracker pattern as pzn-pageview-enrich, one field, no double-fire, no
 * profile change. Install in the eager phase (before utag.js loads).
 *
 * FIXME(cas-id): temporary client-side shim. Remove once the profile derives page_cas_id from the
 * runtime pathname (or window.appVars.externalContentIdentifier) instead of SSR.
 */
import { whenAssigned } from './pzn-pageview-enrich.js';

// Marks an already-wrapped track (Symbol → no collision, hidden from JSON/keys).
const ENRICHED = Symbol('casIdEnriched');
const isEmpty = (v) => v == null || v === '';

/** The content identifier: the page pathname (OVERRIDES.md — no cas-id metadata anymore). */
export const pageCasId = () => (typeof window !== 'undefined' ? window.location.pathname : '');

/** Fills `page_cas_id` from the pathname where the profile left it empty. Mutates + returns. */
export function enrichEventPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (isEmpty(payload.page_cas_id)) payload.page_cas_id = pageCasId();
  return payload;
}

/** Wraps `wa.track` to enrich each event/click payload (idempotent, fail-open). */
export function wrapTrack(wa) {
  if (!wa || typeof wa.track !== 'function' || wa[ENRICHED]) return;
  const original = wa.track.bind(wa);
  wa.track = function enrichedTrack(payload, ...rest) {
    try {
      enrichEventPayload(payload);
    } catch (e) {
      // fail-open — enrichment must never block the real beacon
    }
    return original(payload, ...rest);
  };
  wa[ENRICHED] = true;
}

/** Traps window.intuit.tracking.ecs.webAnalytics and wraps track. Call in the eager phase. */
export default function installCasIdEnrich() {
  if (typeof window === 'undefined') return;
  whenAssigned(window, 'intuit', (intuit) => {
    if (!intuit || typeof intuit !== 'object') return;
    whenAssigned(intuit, 'tracking', (tracking) => {
      if (!tracking || typeof tracking !== 'object') return;
      whenAssigned(tracking, 'ecs', (ecs) => {
        if (!ecs || typeof ecs !== 'object') return;
        whenAssigned(ecs, 'webAnalytics', (wa) => wrapTrack(wa));
      });
    });
  });
}
