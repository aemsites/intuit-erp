// scripts.js dynamically imports this module (see loadDelayed), and this module statically
// imports back from scripts.js — the cycle is intentional (same pattern already flagged at the
// dynamic-import call site), so it's disabled here too.
// eslint-disable-next-line import/no-cycle
import { getTealium } from './scripts.js';

// Load OneTrust cookie-consent SDK (Intuit's account)
const otScript = document.createElement('script');
otScript.src = 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js';
otScript.setAttribute('data-domain-script', '74130b76-29e2-4d72-ab52-09f9ed5818fb');
otScript.setAttribute('charset', 'UTF-8');
document.head.appendChild(otScript);
// Required global callback by OneTrust SDK
window.OptanonWrapper = window.OptanonWrapper || (() => {});

// Tealium's own "delayed" signal. A no-op on the (default, on every current host) Adobe
// provider path, where getTealium() returns undefined, and on a disabled Tealium instance
// (any non-prod host without the ?martech-debug override) — see TealiumMartech#delayed.
const tealium = getTealium();
if (tealium?.enabled) {
  tealium.delayed();
}
