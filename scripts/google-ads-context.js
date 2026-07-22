/**
 * Captures a known Google Ads click on /erp-solutions and stores the
 * matching ad copy as context in localStorage for the
 * of1-preview-extension's content script to read from the page later.
 */
const STORAGE_KEY = 'of1_google_ads_context';

const KNOWN_ADS = {
  Cj0KCQjwk96lBhDHARIsAEKO4xZyfbWi5R9a1Q2jr5glBHkFimC_K49jFdIuzJc_jiVcOlShev2DA98aAvFFEALw_wcB:
    'Intuit Enterprise Suite | The ERP Built for Growing Businesses\n'
    + 'Stop juggling spreadsheets across entities. Consolidate reporting, '
    + 'automate intercompany eliminations, and close the books in days — '
    + 'not months. See why finance teams outgrowing QuickBooks choose IES. '
    + 'Explore ERP Solutions at main--aem-intuit-erp--keepthebyte.aem.page/erp-solutions',
};

export default function captureGoogleAdsContext() {
  const gclid = new URLSearchParams(window.location.search).get('gclid');
  if (!gclid || !KNOWN_ADS[gclid]) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, KNOWN_ADS[gclid]);
  } catch (e) {
    // localStorage unavailable (private mode, quota, etc.) — do nothing
  }
}
