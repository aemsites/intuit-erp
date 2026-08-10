// Load OneTrust cookie-consent SDK (Intuit's account)
const otScript = document.createElement('script');
otScript.src = 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js';
otScript.setAttribute('data-domain-script', '74130b76-29e2-4d72-ab52-09f9ed5818fb');
otScript.setAttribute('charset', 'UTF-8');
document.head.appendChild(otScript);
// Required global callback by OneTrust SDK
window.OptanonWrapper = window.OptanonWrapper || (() => {});

// Tealium tag manager — loaded AFTER OneTrust so Tealium's Consent Mode
// v2 handlers can read consent state on their first fire. Tealium is
// Intuit ERP's tag stack orchestrator (FB Pixel, Google Ads, GA4, Bing
// UET, LinkedIn Insight, Reddit Pixel, Amazon Ad Tag, EventStream — all
// nine marketing pixels fire via Tealium; see scripts/tealium.js for
// the full list and rationale). Delayed-phase import keeps LHS impact
// at zero.
import('./tealium.js').then(({ loadTealium }) => loadTealium()).catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[delayed] Tealium loader failed:', e);
});
