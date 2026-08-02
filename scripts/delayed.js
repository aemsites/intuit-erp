// Load OneTrust cookie-consent SDK (Intuit's account)
const otScript = document.createElement('script');
otScript.src = 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js';
otScript.setAttribute('data-domain-script', '74130b76-29e2-4d72-ab52-09f9ed5818fb');
otScript.setAttribute('charset', 'UTF-8');
document.head.appendChild(otScript);
// Required global callback by OneTrust SDK
window.OptanonWrapper = window.OptanonWrapper || (() => {});
