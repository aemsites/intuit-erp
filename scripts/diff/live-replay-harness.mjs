/**
 * Trust boundaries shared by the authenticated one-page replay runner and its
 * page-local instrumentation. The browser hook sanitizes before returning any
 * evidence to Node and links events through the tracker's existing messageId.
 */
/* eslint-disable no-restricted-syntax, no-underscore-dangle, max-len, function-paren-newline, no-await-in-loop, no-plusplus, prefer-destructuring, prefer-rest-params, no-void, no-use-before-define */

const QUALIFICATION_BINDINGS = [
  'mode',
  'profileId',
  'chromeVersion',
  'harnessVersion',
  'lineagePolicyVersion',
  'origin',
  'consentState',
  'authorizationRef',
  'runtimeHashes',
  'sourceHashes',
  'scenarioId',
  'scenarioDefinitionHash',
];

export function validateCdpEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('CDP endpoint must be a valid URL');
  }
  if (endpoint.protocol !== 'http:') throw new Error('CDP endpoint must use http');
  if (endpoint.username || endpoint.password) throw new Error('CDP endpoint cannot include credentials');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('CDP endpoint must be loopback-only');
  }
  if (!endpoint.port) throw new Error('CDP endpoint must include a port');
  if (endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('CDP endpoint must not include a path, query, or fragment');
  }
  return endpoint.origin;
}

export function validateQualification(binding, expected, now = Date.now()) {
  if (!binding || typeof binding !== 'object') throw new Error('qualification is missing');
  if (!binding.authorizationRef) throw new Error('qualification authorization reference is missing');
  const qualifiedAt = Date.parse(binding.qualifiedAt);
  const expiresAt = Date.parse(binding.expiresAt);
  if (!Number.isFinite(qualifiedAt) || !Number.isFinite(expiresAt)) {
    throw new Error('qualification timestamps are invalid');
  }
  if (expiresAt - qualifiedAt > 24 * 60 * 60 * 1000) {
    throw new Error('qualification validity exceeds 24 hours');
  }
  if (now < qualifiedAt || now > expiresAt) throw new Error('qualification is expired or not yet valid');
  for (const key of QUALIFICATION_BINDINGS) {
    if (JSON.stringify(binding[key]) !== JSON.stringify(expected[key])) {
      throw new Error(`qualification binding changed: ${key}`);
    }
  }
  return binding;
}

export function createLineageRegistry() {
  let active = null;
  const byMessageId = new Map();
  const ambiguousMessageIds = new Set();
  const serializedCounts = new Map();
  return {
    begin(scenario) {
      if (active) throw new Error(`scenario already active: ${active.scenarioId}`);
      if (!scenario?.scenarioId) throw new Error('scenarioId is required');
      active = { ...scenario };
      return active;
    },
    end() {
      active = null;
    },
    observeDispatch(event) {
      if (!active) return { status: 'unlinked', reason: 'no-active-scenario' };
      const messageId = event?.messageId;
      if (typeof messageId !== 'string' || !messageId) {
        return { status: 'ambiguous', reason: 'missing-message-id' };
      }
      if (byMessageId.has(messageId) || ambiguousMessageIds.has(messageId)) {
        ambiguousMessageIds.add(messageId);
        byMessageId.delete(messageId);
        return { status: 'ambiguous', reason: 'duplicate-message-id', messageId };
      }
      const record = { ...active, messageId };
      byMessageId.set(messageId, record);
      return { status: 'enqueued', ...record };
    },
    observeSerialized(event) {
      const messageId = event?.messageId;
      if (ambiguousMessageIds.has(messageId)) {
        return { status: 'ambiguous', reason: 'duplicate-message-id', messageId };
      }
      const linked = byMessageId.get(messageId);
      if (!linked) return { status: 'unlinked', messageId: messageId || null };
      const count = (serializedCounts.get(messageId) || 0) + 1;
      serializedCounts.set(messageId, count);
      if (count > 1) return { status: 'ambiguous', reason: 'duplicate-serialization', ...linked };
      return { status: 'linked', ...linked };
    },
    snapshot() {
      return {
        active: active ? { ...active } : null,
        messageIds: [...byMessageId.keys()],
      };
    },
  };
}

/**
 * Install the page-local hook. This function is deliberately self-contained so
 * Playwright can serialize it into the target page with no module imports.
 * `injectedScope` exists only for deterministic unit tests.
 */
export async function installReplayPageHook(config, injectedScope) {
  const scope = injectedScope || window;
  const expectedOrigin = config?.origin;
  const transportPolicy = config?.transportPolicy || 'observe';
  if (scope.location?.origin !== expectedOrigin) throw new Error('replay hook origin mismatch');
  if (!['observe', 'abort', 'test-sink'].includes(transportPolicy)) throw new Error('invalid transport policy');
  if (transportPolicy === 'observe' && !config.observeAuthorizationRef) {
    throw new Error('observe authorization reference is required');
  }
  if (transportPolicy === 'abort' && !config.abortAuthorizationRef) {
    throw new Error('abort authorization reference is required');
  }
  if (transportPolicy === 'test-sink' && !config.testSinkUrl) {
    throw new Error('approved test sink URL is required');
  }
  const ecs = scope.intuit?.tracking?.ecs;
  const webAnalytics = ecs?.webAnalytics || scope.wa;
  const analytics = ecs?.analytics || scope.analytics;
  if (typeof webAnalytics?.track !== 'function') throw new Error('webAnalytics.track is not ready');
  if (typeof analytics?._dispatch !== 'function') throw new Error('analytics._dispatch enqueue seam is not ready');
  if (typeof scope.fetch !== 'function') throw new Error('fetch transport is not ready');
  if (!config.targetMarker) throw new Error('target marker is required');
  if (scope.__adobeMigrationReplayTarget && scope.__adobeMigrationReplayTarget !== config.targetMarker) {
    throw new Error('replay target marker is ambiguous');
  }
  if (scope.__adobeMigrationReplay) throw new Error('replay hook is already installed');
  scope.__adobeMigrationReplayTarget = config.targetMarker;

  const allowlist = Object.fromEntries(Object.entries(config.allowlist || {})
    .map(([section, keys]) => [section, new Set(keys || [])]));
  const shapeOnly = Object.fromEntries(Object.entries(config.shapeOnly || {})
    .map(([section, keys]) => [section, new Set(keys || [])]));
  const sensitiveFields = new Set(config.sensitiveFields || [
    'email', 'email_address', 'phone', 'phone_number', 'first_name', 'last_name',
    'address', 'authorization', 'cookie', 'password', 'access_token', 'id_token',
  ]);
  const endpoint = /^https:\/\/eventbus\.intuit\.com\/v2\/segment\/intuit-general-clickstream\/(?:t|b)$/;
  const original = {
    track: webAnalytics.track,
    dispatch: analytics._dispatch,
    fetch: scope.fetch,
    sendBeacon: scope.navigator?.sendBeacon,
    xhrOpen: scope.XMLHttpRequest?.prototype?.open,
    xhrSend: scope.XMLHttpRequest?.prototype?.send,
  };
  let active = null;
  let interactionDispatchActive = false;
  let holdNextTransport = false;
  let heldTransport = null;
  let invocationCounter = 0;
  let leaseExpiresAt = Date.now() + (config.leaseMs || 10000);
  let installed = true;
  const byMessageId = new Map();
  const ambiguousMessageIds = new Set();
  const dispatchesByMessageId = new Map();
  const serializedByMessageId = new Map();
  const serializedCounts = new Map();
  let xhrUrls = new WeakMap();
  const invocations = [];
  const dispatches = [];
  const serialized = [];
  const pendingSanitizers = new Set();
  const randomKey = new Uint8Array(32);
  scope.crypto.getRandomValues(randomKey);
  const hmacKeyPromise = scope.crypto.subtle.importKey(
    'raw', randomKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );

  const toHex = (bytes) => [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const hmac = async (value) => {
    const Encoder = scope.TextEncoder || TextEncoder;
    const data = new Encoder().encode(JSON.stringify(value));
    return toHex(await scope.crypto.subtle.sign('HMAC', await hmacKeyPromise, data));
  };
  const valueType = (value) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };
  const valueLength = (value) => {
    if (typeof value === 'string' || Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return null;
  };
  const cleanText = (value) => [...String(value)].map((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || /\p{Bidi_Control}/u.test(character)
      ? '?'
      : character;
  }).join('');
  const cleanUrl = (value) => {
    try {
      const url = new URL(value, scope.location?.origin);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return cleanText(value);
    }
  };
  const cleanUrlValue = (value) => {
    const cleaned = cleanText(value).split(/[?#]/, 1)[0];
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(cleaned)) return cleanUrl(cleaned);
    return cleaned;
  };
  const approvedValue = async (key, value) => {
    if (typeof value === 'string') {
      return /(?:^|_)(?:url|href)(?:_|$)/i.test(key) || /^https?:\/\//i.test(value)
        ? cleanUrlValue(value)
        : cleanText(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map((item) => approvedValue(key, item)));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([childKey, childValue]) => {
        const safeKey = cleanText(childKey);
        if (sensitiveFields.has(childKey.toLowerCase())) return [safeKey, await redactedValue(childValue)];
        return [safeKey, await approvedValue(childKey, childValue)];
      }));
      return Object.fromEntries(entries);
    }
    return value;
  };
  const redactedValue = async (value) => ({
    redacted: true,
    type: valueType(value),
    length: valueLength(value),
    hmac: await hmac(value),
  });
  const shapeToken = (value) => {
    if (value === null) return 'NULL';
    if (Array.isArray(value)) return value.map(shapeToken);
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .map(([key, child]) => [cleanText(key), shapeToken(child)]));
    }
    if (typeof value === 'string') return `STR:${value.length}`;
    if (typeof value === 'number') return 'NUM';
    if (typeof value === 'boolean') return 'BOOL';
    return cleanText(typeof value);
  };
  const sanitizeSection = async (section, object) => {
    const allowed = allowlist[section] || new Set();
    const shaped = shapeOnly[section] || new Set();
    const entries = await Promise.all(Object.entries(object || {}).map(async ([key, value]) => {
      const safeKey = cleanText(key);
      const retain = allowed.has(key) && !sensitiveFields.has(key.toLowerCase());
      if (retain) return [safeKey, await approvedValue(key, value)];
      if (shaped.has(key)) return [safeKey, shapeToken(value)];
      return [safeKey, await redactedValue(value)];
    }));
    return Object.fromEntries(entries);
  };
  const sanitizePayload = async (payload) => {
    const output = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (key === 'properties') output.properties = await sanitizeSection('properties', value);
      else if (key === 'context') output.context = await sanitizeSection('context', value);
      else if (key === 'integrations') output.integrations = await sanitizeSection('integrations', value);
      else if (key === '_metadata') output._metadata = await sanitizeSection('metadata', value);
      else {
        const retain = (allowlist.envelope || new Set()).has(key)
          && !sensitiveFields.has(key.toLowerCase());
        if (retain) output[cleanText(key)] = await approvedValue(key, value);
        else if ((shapeOnly.envelope || new Set()).has(key)) output[cleanText(key)] = shapeToken(value);
        else output[cleanText(key)] = await redactedValue(value);
      }
    }
    return output;
  };
  const eventbusEntries = (body) => {
    if (typeof body !== 'string') return [];
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed?.batch)) return parsed.batch;
      if (Array.isArray(parsed)) return parsed;
      return parsed && typeof parsed === 'object' ? [parsed] : [];
    } catch {
      return [];
    }
  };
  const trackPromise = (promise) => {
    pendingSanitizers.add(promise);
    promise.finally(() => pendingSanitizers.delete(promise));
    return promise;
  };
  const observeSerialized = (event, requestUrl) => {
    if (!installed) return Promise.resolve();
    return trackPromise((async () => {
      const messageId = typeof event?.messageId === 'string' ? event.messageId : null;
      const poisoned = messageId ? ambiguousMessageIds.has(messageId) : false;
      const linked = messageId && !poisoned ? byMessageId.get(messageId) : null;
      const count = messageId ? (serializedCounts.get(messageId) || 0) + 1 : 0;
      if (messageId) serializedCounts.set(messageId, count);
      let status = 'unlinked';
      let reason = 'no-invocation-lineage';
      if (poisoned) {
        status = 'ambiguous';
        reason = 'duplicate-message-id';
      } else if (linked) {
        status = 'linked';
        reason = null;
      }
      if (linked && count > 1) {
        status = 'ambiguous';
        reason = 'duplicate-serialization';
      }
      const record = {
        status,
        reason,
        scenarioId: linked?.scenarioId || null,
        invocationId: linked?.invocationId || null,
        activeScenarioIdAtSerialization: active?.scenarioId || null,
        messageId: messageId ? await redactedValue(messageId) : null,
        requestUrl: cleanUrl(requestUrl),
        payload: await sanitizePayload(event),
      };
      if (!installed) return;
      if (messageId && ambiguousMessageIds.has(messageId)) {
        record.status = 'ambiguous';
        record.reason = 'duplicate-message-id';
        record.scenarioId = null;
        record.invocationId = null;
      }
      serialized.push(record);
      if (messageId) {
        if (!serializedByMessageId.has(messageId)) serializedByMessageId.set(messageId, []);
        serializedByMessageId.get(messageId).push(record);
      }
    })());
  };

  const trackWrapper = async function replayTrackWrapper(...args) {
    if (!installed || !active || !interactionDispatchActive) return original.track.apply(this, args);
    if (active.invocationPending) throw new Error('concurrent tracker invocation is ambiguous');
    const invocationId = `${active.scenarioId}:${++invocationCounter}`;
    active.invocationPending = invocationId;
    invocations.push({ scenarioId: active.scenarioId, invocationId });
    try {
      return await original.track.apply(this, args);
    } finally {
      if (active?.invocationPending === invocationId) active.invocationPending = null;
    }
  };
  const dispatchWrapper = function replayDispatchWrapper(event, ...args) {
    const invocationId = active?.invocationPending;
    if (installed && invocationId && event?.type === 'track') {
      const messageId = event.messageId;
      const record = {
        scenarioId: active.scenarioId,
        invocationId,
        messageIdPresent: typeof messageId === 'string' && Boolean(messageId),
      };
      if (!record.messageIdPresent) record.status = 'ambiguous';
      else if (byMessageId.has(messageId) || ambiguousMessageIds.has(messageId)) {
        record.status = 'ambiguous';
        ambiguousMessageIds.add(messageId);
        const previous = byMessageId.get(messageId);
        if (previous) previous.status = 'ambiguous';
        byMessageId.delete(messageId);
        (serializedByMessageId.get(messageId) || []).forEach((entry) => {
          entry.status = 'ambiguous';
          entry.reason = 'duplicate-message-id';
          entry.scenarioId = null;
          entry.invocationId = null;
        });
      } else {
        record.status = 'enqueued';
        byMessageId.set(messageId, record);
      }
      dispatches.push(record);
      if (record.messageIdPresent) {
        if (!dispatchesByMessageId.has(messageId)) dispatchesByMessageId.set(messageId, []);
        dispatchesByMessageId.get(messageId).push(record);
      }
    }
    return original.dispatch.call(this, event, ...args);
  };
  const fetchWrapper = async function replayFetchWrapper(input, options = {}) {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    if (!installed || !endpoint.test(String(requestUrl || ''))) {
      return original.fetch.apply(this, arguments);
    }
    if (holdNextTransport) {
      holdNextTransport = false;
      const receiver = this;
      const args = arguments;
      return new Promise((resolveCall, rejectCall) => {
        const transport = {
          released: false,
          async release() {
            if (this.released) return;
            this.released = true;
            if (heldTransport === this) heldTransport = null;
            eventbusEntries(options?.body).forEach((event) => observeSerialized(event, requestUrl));
            try { resolveCall(await original.fetch.apply(receiver, args)); } catch (error) { rejectCall(error); }
          },
        };
        heldTransport = transport;
      });
    }
    eventbusEntries(options?.body).forEach((event) => observeSerialized(event, requestUrl));
    if (transportPolicy === 'abort') {
      if (scope.Response) return new scope.Response(null, { status: 204 });
      return { ok: true, status: 204, __abortedByHarness: true };
    }
    if (transportPolicy === 'test-sink') {
      return original.fetch.call(this, config.testSinkUrl, options);
    }
    return original.fetch.apply(this, arguments);
  };
  const sendBeaconWrapper = function replaySendBeaconWrapper(requestUrl, body) {
    if (!installed || !endpoint.test(String(requestUrl || ''))) {
      return original.sendBeacon.apply(this, arguments);
    }
    eventbusEntries(body).forEach((event) => observeSerialized(event, requestUrl));
    if (transportPolicy === 'abort') return true;
    if (transportPolicy === 'test-sink') return original.sendBeacon.call(this, config.testSinkUrl, body);
    return original.sendBeacon.apply(this, arguments);
  };
  const xhrOpenWrapper = function replayXhrOpenWrapper(method, requestUrl, ...args) {
    xhrUrls.set(this, String(requestUrl || ''));
    const target = transportPolicy === 'test-sink' && endpoint.test(String(requestUrl || ''))
      ? config.testSinkUrl : requestUrl;
    return original.xhrOpen.call(this, method, target, ...args);
  };
  const xhrSendWrapper = function replayXhrSendWrapper(body) {
    const requestUrl = xhrUrls.get(this) || '';
    if (!installed || !endpoint.test(requestUrl)) return original.xhrSend.apply(this, arguments);
    eventbusEntries(body).forEach((event) => observeSerialized(event, requestUrl));
    if (transportPolicy === 'abort') return undefined;
    return original.xhrSend.apply(this, arguments);
  };

  webAnalytics.track = trackWrapper;
  analytics._dispatch = dispatchWrapper;
  scope.fetch = fetchWrapper;
  if (typeof original.sendBeacon === 'function') scope.navigator.sendBeacon = sendBeaconWrapper;
  if (typeof original.xhrOpen === 'function' && typeof original.xhrSend === 'function') {
    scope.XMLHttpRequest.prototype.open = xhrOpenWrapper;
    scope.XMLHttpRequest.prototype.send = xhrSendWrapper;
  }

  const pagehide = () => { void teardown('pagehide'); };
  const beginInteractionDispatch = () => {
    if (!installed || !active) return;
    interactionDispatchActive = true;
    Promise.resolve().then(() => { interactionDispatchActive = false; });
  };
  const preventNavigation = (event) => {
    if ((!active && !config.qualificationMode) || config.preventNavigation === false) return;
    const target = event?.target?.closest?.('a[href], button, input[type="submit"]');
    if (target?.matches?.('a[href], input[type="submit"], button[type="submit"]')) {
      event.preventDefault();
    }
  };
  const preventSubmit = (event) => {
    if ((active || config.qualificationMode) && config.preventNavigation !== false) event.preventDefault();
  };
  scope.addEventListener?.('pagehide', pagehide, { once: true });
  scope.addEventListener?.('click', beginInteractionDispatch, true);
  scope.document?.addEventListener?.('click', preventNavigation, true);
  scope.document?.addEventListener?.('submit', preventSubmit, true);
  const heartbeatInterval = config.heartbeatMs || 2000;
  const leaseMs = config.leaseMs || 10000;
  const timer = scope.setInterval(() => {
    if (Date.now() > leaseExpiresAt) void teardown('lease-expired');
  }, Math.min(heartbeatInterval, leaseMs));

  async function teardown(reason = 'explicit') {
    if (!installed) return;
    const transportToRelease = heldTransport;
    heldTransport = null;
    installed = false;
    active = null;
    interactionDispatchActive = false;
    scope.clearInterval(timer);
    scope.removeEventListener?.('pagehide', pagehide);
    scope.removeEventListener?.('click', beginInteractionDispatch, true);
    scope.document?.removeEventListener?.('click', preventNavigation, true);
    scope.document?.removeEventListener?.('submit', preventSubmit, true);
    if (webAnalytics.track === trackWrapper) webAnalytics.track = original.track;
    if (analytics._dispatch === dispatchWrapper) analytics._dispatch = original.dispatch;
    if (scope.fetch === fetchWrapper) scope.fetch = original.fetch;
    if (scope.navigator?.sendBeacon === sendBeaconWrapper) scope.navigator.sendBeacon = original.sendBeacon;
    if (scope.XMLHttpRequest?.prototype?.open === xhrOpenWrapper) scope.XMLHttpRequest.prototype.open = original.xhrOpen;
    if (scope.XMLHttpRequest?.prototype?.send === xhrSendWrapper) scope.XMLHttpRequest.prototype.send = original.xhrSend;
    if (scope.__adobeMigrationReplay === api) delete scope.__adobeMigrationReplay;
    if (scope.__adobeMigrationReplayTarget === config.targetMarker) delete scope.__adobeMigrationReplayTarget;
    byMessageId.clear();
    ambiguousMessageIds.clear();
    dispatchesByMessageId.clear();
    serializedByMessageId.clear();
    serializedCounts.clear();
    xhrUrls = new WeakMap();
    invocations.length = 0;
    dispatches.length = 0;
    serialized.length = 0;
    pendingSanitizers.clear();
    holdNextTransport = false;
    invocationCounter = 0;
    randomKey.fill(0);
    const cleanup = {
      targetMarker: config.targetMarker,
      reason,
      restored: webAnalytics.track === original.track
        && analytics._dispatch === original.dispatch
        && scope.fetch === original.fetch
        && (typeof original.sendBeacon !== 'function' || scope.navigator?.sendBeacon === original.sendBeacon)
        && (typeof original.xhrOpen !== 'function' || scope.XMLHttpRequest?.prototype?.open === original.xhrOpen)
        && (typeof original.xhrSend !== 'function' || scope.XMLHttpRequest?.prototype?.send === original.xhrSend),
      cleared: {
        byMessageId: byMessageId.size,
        ambiguousMessageIds: ambiguousMessageIds.size,
        dispatchesByMessageId: dispatchesByMessageId.size,
        serializedByMessageId: serializedByMessageId.size,
        serializedCounts: serializedCounts.size,
        invocations: invocations.length,
        dispatches: dispatches.length,
        serialized: serialized.length,
        pendingSanitizers: pendingSanitizers.size,
      },
    };
    try { scope.sessionStorage?.setItem('adobe-migration-replay-cleanup', JSON.stringify(cleanup)); } catch { /* best effort */ }
    if (transportToRelease) void transportToRelease.release();
  }

  const api = {
    activate(scenario) {
      if (!installed) throw new Error('replay hook is not installed');
      if (active) throw new Error(`scenario already active: ${active.scenarioId}`);
      if (!scenario?.scenarioId) throw new Error('scenarioId is required');
      active = { ...scenario, invocationPending: null };
    },
    deactivate() {
      active = null;
    },
    heartbeat() {
      if (!installed) throw new Error('replay hook lease has expired');
      leaseExpiresAt = Date.now() + leaseMs;
      return leaseExpiresAt;
    },
    holdNextTransport() {
      if (!config.qualificationMode || transportPolicy !== 'observe') {
        throw new Error('held transport is available only for observe-mode qualification');
      }
      if (holdNextTransport || heldTransport) throw new Error('a qualification transport is already held');
      holdNextTransport = true;
    },
    hasHeldTransport() { return Boolean(heldTransport); },
    async releaseHeldTransport() {
      if (!heldTransport) throw new Error('no qualification transport is held');
      await heldTransport.release();
    },
    async snapshot() {
      await Promise.allSettled([...pendingSanitizers]);
      return {
        active: Boolean(active && installed),
        installed,
        transportPolicy,
        invocations: invocations.map((entry) => ({ ...entry })),
        dispatches: dispatches.map((entry) => ({ ...entry })),
        serialized: serialized.map((entry) => ({ ...entry })),
      };
    },
    cleanupState() {
      return {
        installed,
        byMessageId: byMessageId.size,
        ambiguousMessageIds: ambiguousMessageIds.size,
        dispatchesByMessageId: dispatchesByMessageId.size,
        serializedByMessageId: serializedByMessageId.size,
        serializedCounts: serializedCounts.size,
        invocations: invocations.length,
        dispatches: dispatches.length,
        serialized: serialized.length,
        pendingSanitizers: pendingSanitizers.size,
      };
    },
    teardown,
  };
  scope.__adobeMigrationReplay = api;
  if (injectedScope) return api;
  return { installed: true, targetMarker: config.targetMarker, transportPolicy };
}
