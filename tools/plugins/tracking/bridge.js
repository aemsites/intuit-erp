import {
  TRACKING_INSPECTOR_REQUEST,
  TRACKING_INSPECTOR_RESPONSE,
} from '../../../scripts/tracking-inspector-bridge.js';

let requestSequence = 0;

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
