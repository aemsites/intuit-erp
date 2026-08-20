// scripts.js dynamically imports this module (see loadDelayed), and this module statically
// imports back from scripts.js — the cycle is intentional (same pattern already flagged at the
// dynamic-import call site), so it's disabled here too.
// eslint-disable-next-line import/no-cycle
import { getTealium } from './scripts.js';
import { whenConsentResolved } from '../plugins/tealium-martech/src/index.js';

// Tealium's own "delayed" signal. A no-op on the opt-in Adobe provider path (`?martech=adobe`),
// where getTealium() returns undefined, and on a disabled Tealium instance (any hostname
// resolveEnvironment doesn't recognize) — see TealiumMartech#delayed.
const tealium = getTealium();
if (tealium?.enabled) {
  tealium.delayed();
}

// OF1 intent tracking — observes on-page behavior and persists a per-domain intent
// profile to localStorage (consumed by pzn). Delayed so it stays off the LCP path, and
// consent-gated: it only starts once Tealium consent has resolved (never stores behavior
// without consent). Fail-open — if consent never resolves, the tracker simply never runs.
import('./of1-intent.js').then(({ initOf1Intent }) => whenConsentResolved(() => initOf1Intent()));
