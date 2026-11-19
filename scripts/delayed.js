// scripts.js dynamically imports this module (see loadDelayed), and this module statically
// imports back from scripts.js — the cycle is intentional (same pattern already flagged at the
// dynamic-import call site), so it's disabled here too.
// eslint-disable-next-line import/no-cycle
import { getExperienceTracking, getTealium } from './scripts.js';
import { whenConsentResolved } from '../plugins/tealium-martech/src/index.js';

// Shared lifecycle signal for optional integrations that explicitly choose the EDS delayed phase.
window.hlx = window.hlx || {};
window.hlx.delayed = true;
window.dispatchEvent(new Event('aem:delayed'));

// OF1 intent tracking — observes on-page behavior and persists a per-domain intent
// profile to localStorage (consumed by pzn). Consent-gated: it only starts once Tealium
// consent has resolved (never stores behavior without consent). It must start after utag.js
// loads, because the consent check gives up when utag is missing. It only starts when consent was
// already known once the consent stack settled; a decision made later on the page (which may be a
// rejection) leaves OF1 off until the next page, as before the consent stack moved to delayed.
// Fail-open — if consent never resolves, the tracker simply never runs.
const startOf1Intent = () => import('./of1-intent.js')
  .then(({ initOf1Intent }) => whenConsentResolved(() => initOf1Intent()))
  .catch(() => {});

// Tealium + the OneTrust consent stack load here, off the lazy path, to keep their JavaScript away
// from mobile LCP/INP. Order: personalization exposures flushed -> consent stack -> utag.js +
// initial view -> delayed_ready. delayed_ready keeps the ~3 s gap after the initial view that it
// had when the view was sent in lazy, so the tags it triggers don't all run at once. The gap is
// measured from the view itself, which can come much later when the visitor decides on consent
// later. A no-op when martech is off or the host is not recognized.
const DELAYED_READY_GAP_MS = 3000;
const tealium = getTealium();
if (tealium?.enabled) {
  (async () => {
    try { await getExperienceTracking(); } catch (e) { /* non-fatal */ }
    try { await tealium.lazy(); } catch (e) { /* non-fatal */ }
    if (tealium.consentReady) tealium.utagReady.then(startOf1Intent);
    // Legacy `?tealium-phase=delayed` holds utag.js until delayed(), so there the gap comes first.
    if (tealium.loadPhase !== 'delayed') await tealium.viewSent;
    await new Promise((resolve) => { setTimeout(resolve, DELAYED_READY_GAP_MS); });
    tealium.delayed();
  })();
} else {
  // No consent stack will load, so tell the experience perf report not to wait for one.
  try { performance.measure('consent:skipped'); } catch (e) { /* ignore */ }
  startOf1Intent();
}
