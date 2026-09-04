export const TRACKING_INSPECTOR_REQUEST = 'tracking-inspector:collect';
export const TRACKING_INSPECTOR_RESPONSE = 'tracking-inspector:inventory';

let requestSequence = 0;

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

/** Limit inspector messages to the delivery app for the same ref/site/org tuple. */
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

/** Expose rendered tracking inventory to the matching DA extension iframe. */
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

function previewOrigin({ context = {}, ref = 'main', location = window.location } = {}) {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return location.origin;
  if (/\.(aem|hlx)\.page$/.test(location.hostname)
    || /\.preview\.da\.live$/.test(location.hostname)) return location.origin;
  const { org, repo } = context;
  if (!org || !repo || !ref) {
    throw new TypeError('DA context.org, context.repo, and ref are required to load the preview.');
  }
  return `https://${ref}--${repo}--${org}.preview.da.live`;
}

/** Build the authenticated rendered-page URL used only as an inventory source. */
export function trackingPreviewUrl(path, options = {}) {
  const url = new URL(path, previewOrigin(options));
  url.searchParams.set('tracking-editor', '1');
  url.searchParams.set('martech', 'off');
  return url.href;
}

/** Create the request side of the rendered-page inventory bridge. */
export function createTrackingInspectorClient({
  frame,
  targetOrigin,
  hostWindow = window,
  retryMs = 250,
  timeoutMs = 20000,
}) {
  return {
    collect(rows = []) {
      requestSequence += 1;
      const requestId = `tracking-${Date.now()}-${requestSequence}`;
      return new Promise((resolve, reject) => {
        let retry;
        let timeout;
        let cleanup = () => {};
        const send = () => frame.contentWindow?.postMessage({
          type: TRACKING_INSPECTOR_REQUEST,
          requestId,
          rows,
        }, targetOrigin);
        const receive = (event) => {
          const { data } = event;
          if (event.source !== frame.contentWindow || event.origin !== targetOrigin
            || data?.type !== TRACKING_INSPECTOR_RESPONSE || data.requestId !== requestId) return;
          cleanup();
          if (data.error) reject(new Error(data.error));
          else resolve(Array.isArray(data.inventory) ? data.inventory : []);
        };
        cleanup = () => {
          clearInterval(retry);
          clearTimeout(timeout);
          hostWindow.removeEventListener('message', receive);
        };
        hostWindow.addEventListener('message', receive);
        retry = setInterval(send, retryMs);
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error('The rendered page did not expose its tracking inventory.'));
        }, timeoutMs);
        send();
      });
    },
  };
}
