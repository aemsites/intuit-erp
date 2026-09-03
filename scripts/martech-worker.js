const EXPERIMENT_PARAM = 'martech-worker';
const EXPERIMENT_MODES = new Set(['segment', 'all']);
const SEGMENT_HOST = 'segment.intuitcdn.net';
const UXFABRIC_HOST = 'uxfabric.intuitcdn.net';
const GOOGLE_HOST = 'www.googletagmanager.com';
const META_HOST = 'connect.facebook.net';
const DEMANDBASE_HOSTS = new Set(['scripts.demandbase.com', 'tag-logger.demandbase.com']);
const SEGMENT_RUNTIME_PATH = /^\/analytics\/[^/]+\/(?:track-event-lib|ajs-destination|schemaFilter|visitorapi)\.min\.js$/;
const PARTYTOWN_TYPE = 'text/partytown';
const PARTYTOWN_LIB = '/scripts/partytown/';
const PARTYTOWN_LOADER_ID = 'martech-worker-runtime';
const CONTROLLER_KEY = '__martechWorkerController';
const STATE_KEY = '__martechWorkerExperiment';
const META_BOOTSTRAP = `(function initMetaQueue(root) {
  if (root.fbq && root.fbq.queue) return;
  var fbq = function fbq() {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  root.fbq = fbq;
  root._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
}(window));`;
const SEGMENT_MAIN_GLOBALS = [
  'intuit',
  'appVars',
  'mktg_datalayer',
  'FS',
  'ixp',
  'utag',
  '__NEXT_DATA__',
];

/**
 * Resolves the opt-in martech worker experiment from a query string.
 * @param {string} search URL query string
 * @returns {'segment'|'all'|null} enabled experiment mode, if any
 */
export function resolveMartechWorkerMode(search = window.location.search) {
  const mode = new URLSearchParams(search).get(EXPERIMENT_PARAM);
  return EXPERIMENT_MODES.has(mode) ? mode : null;
}

/**
 * Classifies scripts that are safe to divert from Tealium into the worker experiment.
 * The DOM-driven Track Star bootstrap intentionally remains on main so its public queue and click
 * listener retain their vendor-defined behavior; its heavy sender and descendants run in worker.
 * @param {string} value script URL
 * @param {'segment'|'all'} mode enabled experiment mode
 * @returns {'segment'|'google'|'meta'|'demandbase'|null} worker vendor classification
 */
export function workerVendorForUrl(value, mode) {
  if (!EXPERIMENT_MODES.has(mode)) return null;
  let url;
  try {
    url = new URL(value, window.location.href);
  } catch (e) {
    return null;
  }

  if (url.hostname === SEGMENT_HOST
    || (url.hostname === UXFABRIC_HOST && SEGMENT_RUNTIME_PATH.test(url.pathname))) {
    return 'segment';
  }
  if (mode === 'all' && url.hostname === GOOGLE_HOST && url.pathname === '/gtag/js') {
    return 'google';
  }
  if (mode === 'all' && url.hostname === META_HOST) return 'meta';
  if (mode === 'all' && DEMANDBASE_HOSTS.has(url.hostname)) return 'demandbase';
  return null;
}

function appendUnique(values, additions) {
  return [...new Set([...(values || []), ...additions])];
}

function configurePartytown(mode) {
  const current = window.partytown || {};
  window.partytown = {
    ...current,
    lib: PARTYTOWN_LIB,
    nonce: 'aem',
    // A late main-thread fallback would contaminate this opt-in performance experiment.
    fallbackTimeout: 0,
    mainWindowAccessors: appendUnique(current.mainWindowAccessors, SEGMENT_MAIN_GLOBALS),
    forward: appendUnique(current.forward, mode === 'all' ? ['dataLayer.push', 'fbq'] : []),
  };
}

function loadPartytownRuntime() {
  if (document.getElementById(PARTYTOWN_LOADER_ID)) return;
  const script = document.createElement('script');
  script.id = PARTYTOWN_LOADER_ID;
  script.nonce = 'aem';
  script.async = false;
  script.src = `${PARTYTOWN_LIB}partytown.js`;
  document.head.appendChild(script);
}

function markExperiment(name, detail) {
  try {
    performance.mark(`martech-worker:${name}`, { detail });
  } catch (e) {
    // Older engines may expose performance.mark without the detail overload.
  }
}

function createMetaBootstrap() {
  if (document.querySelector('[data-martech-worker-bootstrap="meta"]')) return null;
  const script = document.createElement('script');
  script.type = PARTYTOWN_TYPE;
  script.dataset.martechWorkerBootstrap = 'meta';
  script.textContent = META_BOOTSTRAP;
  return script;
}

/**
 * Installs a pre-insertion script sink around Tealium. Matching script elements are made inert to
 * the browser before native DOM insertion; Partytown then evaluates them in its worker.
 * @param {{mode?: 'segment'|'all'|null}} options experiment options
 * @returns {{state: Object, disconnect: Function}|null} experiment controller
 */
export function installMartechWorkerExperiment({
  mode = resolveMartechWorkerMode(),
} = {}) {
  if (!EXPERIMENT_MODES.has(mode)) return null;
  if (window[CONTROLLER_KEY]) return window[CONTROLLER_KEY];

  const state = {
    mode,
    diverted: [],
    requiredCorsOverrides: mode === 'all' ? [
      { hostname: META_HOST, header: 'Access-Control-Allow-Origin: *' },
      { hostname: 'scripts.demandbase.com', header: 'Access-Control-Allow-Origin: *' },
      { hostname: 'tag-logger.demandbase.com', header: 'Access-Control-Allow-Origin: *' },
    ] : [],
  };
  const nativeAppendChild = Node.prototype.appendChild;
  const nativeInsertBefore = Node.prototype.insertBefore;
  const completionObservers = new Set();

  const bridgeCompletion = (script, record) => {
    let settled = false;
    const observer = new MutationObserver(() => {
      if (settled) return;
      if (script.hasAttribute('data-pterror')) {
        settled = true;
        record.status = 'error';
        markExperiment('error', record);
        observer.disconnect();
        completionObservers.delete(observer);
        script.dispatchEvent(new Event('error'));
      } else if (script.type === `${PARTYTOWN_TYPE}-x`) {
        settled = true;
        record.status = 'complete';
        markExperiment('complete', record);
        observer.disconnect();
        completionObservers.delete(observer);
        script.dispatchEvent(new Event('load'));
      }
    });
    observer.observe(script, {
      attributes: true,
      attributeFilter: ['type', 'data-pterror'],
    });
    completionObservers.add(observer);
    const settleFromNativeEvent = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      completionObservers.delete(observer);
    };
    script.addEventListener('load', settleFromNativeEvent, { once: true });
    script.addEventListener('error', settleFromNativeEvent, { once: true });
  };

  const prepare = (node) => {
    if (!(node instanceof HTMLScriptElement)) return null;
    const vendor = workerVendorForUrl(node.src, mode);
    if (!vendor) return null;
    node.type = PARTYTOWN_TYPE;
    node.dataset.martechWorker = vendor;
    const record = { vendor, src: node.src, status: 'queued' };
    state.diverted.push(record);
    markExperiment('queued', record);
    bridgeCompletion(node, record);
    return vendor === 'meta' ? createMetaBootstrap() : null;
  };
  const notifyPartytown = (node) => {
    if (node?.type !== PARTYTOWN_TYPE) return;
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('ptupdate')));
  };

  const appendChild = function appendChild(node) {
    const bootstrap = prepare(node);
    if (bootstrap) nativeAppendChild.call(this, bootstrap);
    const result = nativeAppendChild.call(this, node);
    notifyPartytown(bootstrap);
    notifyPartytown(node);
    return result;
  };
  const insertBefore = function insertBefore(node, referenceNode) {
    const bootstrap = prepare(node);
    if (bootstrap) nativeInsertBefore.call(this, bootstrap, referenceNode);
    const result = nativeInsertBefore.call(this, node, referenceNode);
    notifyPartytown(bootstrap);
    notifyPartytown(node);
    return result;
  };
  Node.prototype.appendChild = appendChild;
  Node.prototype.insertBefore = insertBefore;

  const controller = {
    state,
    disconnect() {
      if (Node.prototype.appendChild === appendChild) {
        Node.prototype.appendChild = nativeAppendChild;
      }
      if (Node.prototype.insertBefore === insertBefore) {
        Node.prototype.insertBefore = nativeInsertBefore;
      }
      completionObservers.forEach((observer) => observer.disconnect());
      completionObservers.clear();
      delete window[CONTROLLER_KEY];
    },
  };
  window[CONTROLLER_KEY] = controller;
  window[STATE_KEY] = state;
  markExperiment('installed', { mode });

  configurePartytown(mode);
  loadPartytownRuntime();
  return controller;
}
