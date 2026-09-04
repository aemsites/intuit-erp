export const TRACKING_INSPECTOR_REQUEST = 'tracking-inspector:collect';
export const TRACKING_INSPECTOR_RESPONSE = 'tracking-inspector:inventory';

function projectIdentity(hostname = '') {
  const suffixes = [
    '.preview.da.live',
    '.aem.live',
    '.aem.page',
    '.hlx.live',
    '.hlx.page',
  ];
  const suffix = suffixes.find((candidate) => hostname.endsWith(candidate));
  if (!suffix) return null;
  const parts = hostname.slice(0, -suffix.length).split('--');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  return parts.join('--');
}

/**
 * Limit inspector messages to the delivery app for the same ref/site/org tuple.
 * @param {string} origin candidate editor origin
 * @param {string} previewHostname rendered preview hostname
 * @returns {boolean}
 */
export function isTrustedTrackingEditorOrigin(origin, previewHostname) {
  let editorUrl;
  try {
    editorUrl = new URL(origin);
  } catch {
    return false;
  }
  if (['localhost', '127.0.0.1'].includes(previewHostname)) {
    return editorUrl.hostname === previewHostname;
  }
  if (editorUrl.protocol !== 'https:') return false;
  const previewProject = projectIdentity(previewHostname);
  return !!previewProject && projectIdentity(editorUrl.hostname) === previewProject;
}

/**
 * Expose rendered tracking inventory to the matching DA extension iframe.
 * @param {{frameWindow?: Window, collect: (rows?: Array) => Array}} options
 * @returns {() => void} listener cleanup
 */
export function installTrackingInspectorBridge({ frameWindow = window, collect }) {
  const receive = (event) => {
    const { data } = event;
    if (data?.type !== TRACKING_INSPECTOR_REQUEST || !data.requestId) return;
    if (!isTrustedTrackingEditorOrigin(event.origin, frameWindow.location.hostname)) return;
    try {
      const inventory = collect(Array.isArray(data.rows) ? data.rows : []);
      event.source?.postMessage({
        type: TRACKING_INSPECTOR_RESPONSE,
        requestId: data.requestId,
        inventory,
      }, event.origin);
    } catch (error) {
      event.source?.postMessage({
        type: TRACKING_INSPECTOR_RESPONSE,
        requestId: data.requestId,
        error: error.message,
      }, event.origin);
    }
  };
  frameWindow.addEventListener('message', receive);
  return () => frameWindow.removeEventListener('message', receive);
}
