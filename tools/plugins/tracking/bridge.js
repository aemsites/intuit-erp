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

function refHostname(ref) {
  return String(ref || 'main').trim().replaceAll('/', '-');
}

function canonicalPagePath(value) {
  let path = String(value || '/').trim().split(/[?#]/)[0] || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.endsWith('.html')) path = path.slice(0, -5) || '/';
  if (path === '/index') return '/';
  return path.endsWith('/index') ? path.slice(0, -6) : path;
}

export function trackingPreviewOrigin({
  context = {},
  ref = 'main',
  location = window.location,
} = {}) {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return location.origin;
  if (/\.(aem|hlx)\.page$/.test(location.hostname)
    || /\.preview\.da\.live$/.test(location.hostname)) return location.origin;
  const { org, repo } = context;
  if (!org || !repo || !ref) {
    throw new TypeError('DA context.org, context.repo, and ref are required to load the preview.');
  }
  return `https://${refHostname(ref)}--${repo}--${org}.preview.da.live`;
}

export function trackingProbeUrl({ context = {}, ref = 'main', location = window.location } = {}) {
  const origin = trackingPreviewOrigin({ context, ref, location });
  const url = new URL(canonicalPagePath(context.path), origin);
  url.searchParams.set('tracking-editor', '1');
  url.searchParams.set('martech', 'off');
  return url.href;
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

/** Resolve after the decorated probe DOM has stopped changing, with a bounded fallback. */
export function waitForTrackingDocument(
  doc = document,
  {
    Observer = MutationObserver,
    quietMs = 300,
    maxWaitMs = 5000,
  } = {},
) {
  return new Promise((resolve) => {
    let quietTimer;
    let maxTimer;
    let observer;
    const finish = () => {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      observer?.disconnect();
      resolve();
    };
    const armQuietTimer = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };
    observer = new Observer(armQuietTimer);
    observer.observe(doc.documentElement || doc, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    maxTimer = setTimeout(finish, maxWaitMs);
    armQuietTimer();
  });
}

/** Expose rendered tracking inventory to the matching DA extension iframe. */
export function installTrackingInspectorBridge({
  frameWindow = window,
  collect,
  ready = Promise.resolve(),
}) {
  const receive = async (event) => {
    const { data } = event;
    if (data?.type !== TRACKING_INSPECTOR_REQUEST || !data.requestId) return;
    if (!isTrustedTrackingEditorOrigin(event.origin, frameWindow.location.hostname)) return;
    try {
      await ready;
      const inventory = await collect(Array.isArray(data.rows) ? data.rows : []);
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

/** Create the request side of the rendered-page inventory bridge. */
export function createTrackingInspectorClient({
  targetOrigin,
  hostWindow = window,
  getTarget,
  retryMs = 250,
  timeoutMs = 20000,
}) {
  if (typeof getTarget !== 'function') {
    throw new TypeError('A tracking probe window getter is required.');
  }
  return {
    collect(rows = []) {
      requestSequence += 1;
      const requestId = `tracking-${Date.now()}-${requestSequence}`;
      return new Promise((resolve, reject) => {
        let retry;
        let timeout;
        let cleanup = () => {};
        const send = () => getTarget()?.postMessage({
          type: TRACKING_INSPECTOR_REQUEST,
          requestId,
          rows,
        }, targetOrigin);
        const receive = (event) => {
          const { data } = event;
          if (event.source !== getTarget() || event.origin !== targetOrigin
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
          reject(new Error('The rendered preview did not expose its tracking inventory.'));
        }, timeoutMs);
        send();
      });
    },
  };
}
