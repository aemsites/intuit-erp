// Sends OF1's anonymous interest/intent signals into RTCDP via the on-page Web
// SDK (Alloy). Pure mapping (buildOf1SignalXdm) is unit-tested; the DOM/Alloy
// wiring (sendOf1Signal) is verified manually in Adobe Assurance. Fail-open:
// any missing piece resolves to a no-op so the page is never affected.

// Tenant-namespaced XDM location for the OF1 signal. The real prefix is
// org-derived and unknown today — the Edge accepts an unknown object, but it
// only persists on-profile once a matching schema field group exists AEP-side.
// Single source of truth so it is a one-line swap when Cedric confirms it.
export const OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' };
const MAX_INTERESTS = 5;
const MAX_PAGES = 10;

// Maps an OF1 profile payload + page info into a FLAT, profile-friendly XDM
// sendEvent payload. Flattened (topInterests/topIntent/pagesViewed) so it
// models cleanly as an AEP event field group and is easy to segment on. Pure.
export function buildOf1SignalXdm(payload, page) {
  const p = payload || {};
  const interests = Array.isArray(p.interests) ? p.interests : [];
  const pages = Array.isArray(p.pageVisits) ? p.pageVisits : [];
  return {
    eventType: 'web.webpagedetails.pageViews',
    web: { webPageDetails: { URL: page.url, name: page.name } },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: {
        topInterests: interests.map((i) => i.topic).filter(Boolean).slice(0, MAX_INTERESTS),
        topIntent: p.intentProfile?.topIntent || '',
        pagesViewed: pages.map((v) => v.path).filter(Boolean).slice(0, MAX_PAGES),
        capturedAt: new Date().toISOString(),
      },
    },
  };
}

// Requests the OF1 anonymous profile via the existing postMessage handshake
// (the extension owns the response). Resolves null on timeout so callers no-op.
export function requestOf1Profile(timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    let onMessage;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(val);
    };
    onMessage = (event) => {
      if (event.data?.type === 'OF1_PERSONALIZE') finish(event.data.payload || {});
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'OF1_REQUEST_PROFILE', domain: window.location.hostname }, '*');
    setTimeout(() => finish(null), timeoutMs);
  });
}

// Extracts RTCDP/AJO segment IDs from the on-page Alloy sendEvent result.
// The Edge returns segment membership under result.destinations[].segments[].id
// (verified live: the alias:"aem" edge-lookup destination). Deduped; [] on any
// absent/invalid shape (fail-open — the page must never break if AEP is off).
export function readAlloySegmentIds(sendEventResult) {
  const destinations = sendEventResult?.destinations;
  if (!Array.isArray(destinations)) return [];
  const ids = [];
  for (const d of destinations) {
    const segments = Array.isArray(d?.segments) ? d.segments : [];
    for (const s of segments) {
      if (s?.id && !ids.includes(s.id)) ids.push(s.id);
    }
  }
  return ids;
}

// Orchestrates request → map → send. `sendEvent` is injected (the martech
// plugin's sendEvent in production). Returns { sent, result } — result is the
// raw Alloy sendEvent response (or null) so callers can read RTCDP segments.
// Fail-open: no profile, or a rejected send, resolves to { sent: false, result: null }
// and never throws.
export async function sendOf1Signal({ sendEvent, timeoutMs = 2500 } = {}) {
  try {
    const payload = await requestOf1Profile(timeoutMs);
    if (!payload) return { sent: false, result: null };
    const xdm = buildOf1SignalXdm(payload, {
      url: window.location.href,
      name: document.title || window.location.pathname,
    });
    const result = await sendEvent({ xdm });
    return { sent: true, result: result || null };
  } catch {
    return { sent: false, result: null };
  }
}
