// Sends OF1's anonymous interest/intent signals into RTCDP via the on-page Web
// SDK (Alloy). Pure mapping (buildOf1SignalXdm) is unit-tested; the DOM/Alloy
// wiring (sendOf1Signal) is verified manually in Adobe Assurance. Fail-open:
// any missing piece resolves to a no-op so the page is never affected.

// Tenant-namespaced XDM location for the OF1 signal. The real prefix is
// org-derived and unknown today — the Edge accepts an unknown object, but it
// only persists on-profile once a matching schema field group exists AEP-side.
// Single source of truth so it is a one-line swap when Cedric confirms it.
export const OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' };

// Maps an OF1 profile payload + page info into an XDM sendEvent payload. Pure.
export function buildOf1SignalXdm(payload, page) {
  const p = payload || {};
  return {
    eventType: 'web.webpagedetails.pageViews',
    web: { webPageDetails: { URL: page.url, name: page.name } },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: {
        interests: Array.isArray(p.interests) ? p.interests : [],
        intent: p.intentProfile || null,
        pagesViewed: Array.isArray(p.pageVisits) ? p.pageVisits : [],
        capturedAt: new Date().toISOString(),
      },
    },
  };
}
