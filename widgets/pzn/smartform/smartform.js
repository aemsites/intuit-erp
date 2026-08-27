/**
 * PZN treatment for the ZoomInfo SmartForm access point
 * (SBSEGICOMMContentZoomInfoSmartFormIntegrationModal, /).
 *
 * Treatment: the Marketo modal form shows Business Email before Business Name (field order in
 * smartform.css) and ZoomInfo FormComplete derives the company name from the email as the
 * visitor types. Control (name before email, no FormComplete) is the page baseline, so there is
 * no control fragment.
 *
 * Client-side ZoomInfo FormComplete is intentional here — real-time company-from-email lookup
 * can't be done server-side before the fragment is served. This is a clean, de-obfuscated port
 * of the OICMS loader (the original hid the key/URL behind atob + char-shift). Logging goes
 * through the shared ERP logger (window.coreServiceAdapter.logger) when it's present.
 */

const ZI_PROJECT_KEY = '1205df03da1697208983';
const ZI_SCRIPT_URL = 'https://js.zi-scripts.com/zi-tag.js';
const COMPANY_FIELD = 'intuitCompanyName';
const DISCLAIMER_TEXT = 'We found this business name based on public information. '
  + 'Does this look right? If not, please edit.';

function log(message, level = 'info') {
  window.coreServiceAdapter?.logger?.[level]?.(message);
}

// Adds the "we found this business name" note under the company field once ZI returns a match —
// unless the visitor already edited it or the note is already there. Clears it on edit.
export function appendDisclaimer(form) {
  const companyInput = form?.querySelector(`[name="${COMPANY_FIELD}"]`);
  if (!companyInput || form.querySelector('.zi-formcomplete-msg')) return;
  if (companyInput.dataset.hasusertyped) return;
  const msg = document.createElement('p');
  msg.className = 'zi-formcomplete-msg';
  msg.textContent = DISCLAIMER_TEXT;
  companyInput.after(msg);
  companyInput.addEventListener('change', () => msg.remove(), { once: true });
}

function installFormComplete() {
  if (window.ziFcInstalled) return;
  window.ziFcInstalled = true;
  window.ZIProjectKey = ZI_PROJECT_KEY;

  // ZoomInfo FormComplete callbacks (window.zi__fc).
  window.zi__fc = {
    onReady() { log('ZI FormComplete ready'); },
    onRequestSent() { log('ZI FormComplete match request sent'); },
    onMatch(data) {
      if (data && data.intuitCompanyName) {
        log('ZI FormComplete match data returned');
        const form = document.activeElement?.closest('form') || document.querySelector('.mktoForm');
        appendDisclaimer(form);
      } else {
        log('ZI FormComplete no match data returned');
      }
    },
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = ZI_SCRIPT_URL;
  script.addEventListener('error', () => log('ZI FormComplete script load failure', 'error'));
  document.body.appendChild(script);
}

export default async function decorate() {
  installFormComplete();

  // The Marketo modal form mounts after the widget runs; retrigger FormComplete once it appears.
  const observer = new MutationObserver(() => {
    if (!document.querySelector('.mktoForm')) return;
    observer.disconnect();
    try {
      window.zi__fc?.fcRetrigger?.();
    } catch (e) {
      log(`ZI FormComplete retrigger failed: ${e.message}`, 'error');
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
