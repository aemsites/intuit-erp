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
  'transportMarkerGuard',
  'origin',
  'consentState',
  'authorizationRef',
  'runtimeHashes',
  'sourceHashes',
  'scenarioId',
  'scenarioDefinitionHash',
];
export const REPLAY_LINEAGE_POLICY_VERSION = 'click-message-id-v3';
export const REPLAY_INVOCATION_MARKER_KEY = '__adobe_migration_replay_invocation';

export function canonicalReplayPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new Error(`reviewed pathname is invalid: ${value}`);
  }
  if (value !== '/' && value.endsWith('//')) throw new Error(`reviewed pathname is invalid: ${value}`);
  const parsed = new URL(value, 'https://stage.invalid');
  if (parsed.origin !== 'https://stage.invalid' || parsed.pathname !== value) {
    throw new Error(`reviewed pathname is invalid: ${value}`);
  }
  if (value === '/') return value;
  return value.endsWith('/') ? value : `${value}/`;
}

export function replayPathMatches(actual, reviewed) {
  try {
    return canonicalReplayPath(actual) === canonicalReplayPath(reviewed);
  } catch {
    return false;
  }
}

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
  const invocationMarkerKey = config?.invocationMarkerKey || '__adobe_migration_replay_invocation';
  if (invocationMarkerKey !== '__adobe_migration_replay_invocation') {
    throw new Error('invalid replay invocation marker key');
  }
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
  let interactionDispatchSequence = 0;
  let holdNextTransport = false;
  let heldTransport = null;
  let invocationCounter = 0;
  let leaseExpiresAt = Date.now() + (config.leaseMs || 10000);
  let installed = true;
  const byMessageId = new Map();
  const ambiguousMessageIds = new Set();
  const ambiguityReasonsByMessageId = new Map();
  const invocationsByMarker = new Map();
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
  const taggedTrackArgs = (args, marker) => {
    const index = args.findIndex((value) => value && typeof value === 'object' && !Array.isArray(value));
    if (index < 0) return null;
    const envelope = args[index];
    const tagged = [...args];
    if (envelope.properties && typeof envelope.properties === 'object') {
      if (Object.hasOwn(envelope.properties, invocationMarkerKey)) return null;
      tagged[index] = {
        ...envelope,
        properties: { ...envelope.properties, [invocationMarkerKey]: marker },
      };
    } else {
      if (Object.hasOwn(envelope, invocationMarkerKey)) return null;
      tagged[index] = { ...envelope, [invocationMarkerKey]: marker };
    }
    return tagged;
  };
  const trackPromise = (promise) => {
    pendingSanitizers.add(promise);
    promise.finally(() => pendingSanitizers.delete(promise));
    return promise;
  };
  const poisonInvocation = (invocation, reason) => {
    if (!invocation) return;
    invocation.status = 'ambiguous';
    invocation.reason = reason;
    if (active?.invocationPending === invocation) active.invocationPending = null;
    if (active?.invocationAwaiting === invocation) active.invocationAwaiting = null;
    [...byMessageId.entries()]
      .filter(([, entry]) => entry.invocationId === invocation.invocationId)
      .forEach(([messageId]) => {
        ambiguousMessageIds.add(messageId);
        ambiguityReasonsByMessageId.set(messageId, reason);
        byMessageId.delete(messageId);
        (serializedByMessageId.get(messageId) || []).forEach((entry) => {
          entry.status = 'ambiguous';
          entry.reason = reason;
          entry.scenarioId = null;
          entry.invocationId = null;
        });
      });
  };
  const settleInvocationMarker = (invocation) => {
    if (!invocation || invocation.markerConsumed) return;
    invocation.markerConsumed = true;
    invocation.resolveMarker?.();
  };
  const outstandingMarkerInvocations = () => [...invocationsByMarker.values()]
    .filter((invocation) => !invocation.markerConsumed);
  const refuseUnsafeEventbusBody = (reason) => {
    outstandingMarkerInvocations().forEach((invocation) => {
      poisonInvocation(invocation, reason);
      settleInvocationMarker(invocation);
    });
    throw new Error(reason);
  };
  const linkClickInvocationSerialization = (messageId, event, marker) => {
    if (!marker) return null;
    const invocation = invocationsByMarker.get(marker);
    const invocationId = invocation?.invocationId;
    if (!messageId || !invocationId || invocation.status === 'ambiguous' || event?.type !== 'track') return null;
    if (invocation !== active?.invocationPending && invocation !== active?.invocationAwaiting) return null;
    if (active.invocationPending === invocation && !interactionDispatchActive) return null;
    const invocationEntry = [...byMessageId.entries()]
      .find(([, entry]) => entry.invocationId === invocationId);
    if (invocationEntry) {
      const [existingMessageId] = invocationEntry;
      const reason = 'multiple-message-ids-per-invocation';
      poisonInvocation(invocation, reason);
      [existingMessageId, messageId].forEach((id) => {
        ambiguousMessageIds.add(id);
        ambiguityReasonsByMessageId.set(id, reason);
      });
      byMessageId.delete(existingMessageId);
      (serializedByMessageId.get(existingMessageId) || []).forEach((entry) => {
        entry.status = 'ambiguous';
        entry.reason = reason;
        entry.scenarioId = null;
        entry.invocationId = null;
      });
      return null;
    }
    const linked = {
      scenarioId: active.scenarioId,
      invocationId,
      messageIdPresent: true,
      status: 'enqueued',
      lineageSource: 'click-invocation-marker',
    };
    byMessageId.set(messageId, linked);
    invocation.messageId = messageId;
    invocation.status = 'linked';
    return linked;
  };
  const observeSerialized = (event, requestUrl, marker = null) => {
    if (!installed) return Promise.resolve();
    return trackPromise((async () => {
      const messageId = typeof event?.messageId === 'string' ? event.messageId : null;
      let poisoned = messageId ? ambiguousMessageIds.has(messageId) : false;
      let linked = messageId && !poisoned ? byMessageId.get(messageId) : null;
      // The production SDK captures its original dispatch function before this
      // hook is installed. In that case, a per-invocation marker is carried by
      // the wrapped track call and removed before transport. This establishes
      // causal lineage without relying on timing or business-field similarity.
      if (!linked && !poisoned) linked = linkClickInvocationSerialization(messageId, event, marker);
      poisoned = messageId ? ambiguousMessageIds.has(messageId) : false;
      const count = messageId ? (serializedCounts.get(messageId) || 0) + 1 : 0;
      if (messageId) serializedCounts.set(messageId, count);
      let status = 'unlinked';
      let reason = 'no-invocation-lineage';
      if (poisoned) {
        status = 'ambiguous';
        reason = ambiguityReasonsByMessageId.get(messageId) || 'duplicate-message-id';
      } else if (linked) {
        status = 'linked';
        reason = null;
      } else if (marker) {
        status = 'ambiguous';
        reason = event?.type === 'track' ? 'unbound-invocation-marker' : 'non-track-invocation-marker';
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
        lineageSource: linked?.lineageSource || null,
        activeScenarioIdAtSerialization: active?.scenarioId || null,
        messageId: messageId ? await redactedValue(messageId) : null,
        requestUrl: cleanUrl(requestUrl),
        payload: await sanitizePayload(event),
      };
      if (!installed) return;
      if (messageId && ambiguousMessageIds.has(messageId)) {
        record.status = 'ambiguous';
        record.reason = ambiguityReasonsByMessageId.get(messageId) || 'duplicate-message-id';
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
  const processEventbusBody = (body, requestUrl) => {
    if (typeof body !== 'string') {
      if (outstandingMarkerInvocations().length) {
        return refuseUnsafeEventbusBody('uninspectable eventbus body with an outstanding invocation marker');
      }
      return body;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      if (body.includes(invocationMarkerKey)) {
        throw new Error(`invocation marker could not be removed: ${error.message}`);
      }
      return body;
    }
    let events = [];
    if (Array.isArray(parsed?.batch)) events = parsed.batch;
    else if (Array.isArray(parsed)) events = parsed;
    else if (parsed && typeof parsed === 'object') events = [parsed];
    let markerRemoved = false;
    events.forEach((event) => {
      const properties = event?.properties;
      const propertiesMarker = properties && Object.hasOwn(properties, invocationMarkerKey);
      const envelopeMarker = event && Object.hasOwn(event, invocationMarkerKey);
      const hasMarker = propertiesMarker || envelopeMarker;
      const marker = propertiesMarker ? properties[invocationMarkerKey] : event?.[invocationMarkerKey];
      if (hasMarker) {
        if (propertiesMarker) delete properties[invocationMarkerKey];
        if (envelopeMarker) delete event[invocationMarkerKey];
        markerRemoved = true;
        settleInvocationMarker(invocationsByMarker.get(marker));
      }
      observeSerialized(event, requestUrl, marker);
    });
    const forwardedBody = markerRemoved ? JSON.stringify(parsed) : body;
    if (forwardedBody.includes(invocationMarkerKey)) {
      return refuseUnsafeEventbusBody('eventbus body retained a reserved invocation marker');
    }
    return forwardedBody;
  };

  const trackWrapper = async function replayTrackWrapper(...args) {
    if (!installed || !active || !interactionDispatchActive) return original.track.apply(this, args);
    const overlapping = active.invocationPending || active.invocationAwaiting;
    if (overlapping) {
      poisonInvocation(overlapping, 'multiple-tracker-invocations');
      const invocationId = `${active.scenarioId}:${++invocationCounter}`;
      invocations.push({
        scenarioId: active.scenarioId,
        invocationId,
        status: 'ambiguous',
        reason: 'multiple-tracker-invocations',
      });
      return original.track.apply(this, args);
    }
    const invocationId = `${active.scenarioId}:${++invocationCounter}`;
    const marker = `${config.targetMarker}:${invocationId}`;
    const taggedArgs = taggedTrackArgs(args, marker);
    if (!taggedArgs) {
      invocations.push({
        scenarioId: active.scenarioId,
        invocationId,
        status: 'ambiguous',
        reason: 'unmarkable-tracker-invocation',
      });
      return original.track.apply(this, args);
    }
    let resolveMarker;
    const markerPromise = new Promise((resolveMarkerPromise) => { resolveMarker = resolveMarkerPromise; });
    const invocation = {
      scenarioId: active.scenarioId,
      invocationId,
      marker,
      markerConsumed: false,
      markerPromise,
      resolveMarker,
      status: 'pending',
    };
    active.invocationPending = invocation;
    invocationsByMarker.set(marker, invocation);
    invocations.push(invocation);
    try {
      const result = await original.track.apply(this, taggedArgs);
      const alreadyLinked = [...byMessageId.values()]
        .some((entry) => entry.invocationId === invocationId);
      if (active?.invocationPending === invocation && !alreadyLinked) {
        invocation.status = 'awaiting-serialization';
        active.invocationAwaiting = invocation;
      } else if (alreadyLinked) {
        invocation.status = 'linked';
      }
      return result;
    } finally {
      if (active?.invocationPending === invocation) active.invocationPending = null;
    }
  };
  const dispatchWrapper = function replayDispatchWrapper(event, ...args) {
    const invocationId = active?.invocationPending?.invocationId;
    if (installed && invocationId && event?.type === 'track') {
      const messageId = event.messageId;
      const record = {
        scenarioId: active.scenarioId,
        invocationId,
        messageIdPresent: typeof messageId === 'string' && Boolean(messageId),
        lineageSource: 'dispatch',
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
      return new Promise((resolveCall, rejectCall) => {
        const transport = {
          released: false,
          async release() {
            if (this.released) return;
            this.released = true;
            if (heldTransport === this) heldTransport = null;
            const forwardedOptions = { ...options, body: processEventbusBody(options?.body, requestUrl) };
            try { resolveCall(await original.fetch.call(receiver, input, forwardedOptions)); } catch (error) { rejectCall(error); }
          },
        };
        heldTransport = transport;
      });
    }
    const forwardedOptions = { ...options, body: processEventbusBody(options?.body, requestUrl) };
    if (transportPolicy === 'abort') {
      if (scope.Response) return new scope.Response(null, { status: 204 });
      return { ok: true, status: 204, __abortedByHarness: true };
    }
    if (transportPolicy === 'test-sink') {
      return original.fetch.call(this, config.testSinkUrl, forwardedOptions);
    }
    return original.fetch.call(this, input, forwardedOptions);
  };
  const sendBeaconWrapper = function replaySendBeaconWrapper(requestUrl, body) {
    if (!installed || !endpoint.test(String(requestUrl || ''))) {
      return original.sendBeacon.apply(this, arguments);
    }
    const forwardedBody = processEventbusBody(body, requestUrl);
    if (transportPolicy === 'abort') return true;
    if (transportPolicy === 'test-sink') return original.sendBeacon.call(this, config.testSinkUrl, forwardedBody);
    return original.sendBeacon.call(this, requestUrl, forwardedBody);
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
    const forwardedBody = processEventbusBody(body, requestUrl);
    if (transportPolicy === 'abort') return undefined;
    return original.xhrSend.call(this, forwardedBody);
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
    const sequence = ++interactionDispatchSequence;
    interactionDispatchActive = true;
    (scope.setTimeout || setTimeout)(() => {
      if (interactionDispatchSequence === sequence) interactionDispatchActive = false;
    }, 0);
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
    if (transportToRelease) void transportToRelease.release();
    const markerDrain = outstandingMarkerInvocations();
    if (markerDrain.length) {
      interactionDispatchSequence += 1;
      interactionDispatchActive = false;
      if (webAnalytics.track === trackWrapper) webAnalytics.track = original.track;
      if (analytics._dispatch === dispatchWrapper) analytics._dispatch = original.dispatch;
      const waitForDrain = Promise.all(markerDrain.map((invocation) => invocation.markerPromise));
      const drainTimeout = new Promise((resolveDrain) => {
        (scope.setTimeout || setTimeout)(resolveDrain, config.markerDrainTimeoutMs || 1000);
      });
      await Promise.race([waitForDrain, drainTimeout]);
      if (outstandingMarkerInvocations().length) {
        active = null;
        scope.clearInterval(timer);
        scope.removeEventListener?.('pagehide', pagehide);
        scope.removeEventListener?.('click', beginInteractionDispatch, true);
        scope.document?.removeEventListener?.('click', preventNavigation, true);
        scope.document?.removeEventListener?.('submit', preventSubmit, true);
        const cleanup = {
          targetMarker: config.targetMarker,
          reason: `${reason}:marker-drain-timeout`,
          restored: false,
          cleared: {
            byMessageId: byMessageId.size,
            ambiguousMessageIds: ambiguousMessageIds.size,
            ambiguityReasonsByMessageId: ambiguityReasonsByMessageId.size,
            invocationsByMarker: invocationsByMarker.size,
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
        return cleanup;
      }
    }
    installed = false;
    active = null;
    interactionDispatchSequence += 1;
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
    ambiguityReasonsByMessageId.clear();
    invocationsByMarker.clear();
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
        ambiguityReasonsByMessageId: ambiguityReasonsByMessageId.size,
        invocationsByMarker: invocationsByMarker.size,
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
    return cleanup;
  }

  const api = {
    activate(scenario) {
      if (!installed) throw new Error('replay hook is not installed');
      if (active) throw new Error(`scenario already active: ${active.scenarioId}`);
      if (!scenario?.scenarioId) throw new Error('scenarioId is required');
      active = { ...scenario, invocationPending: null, invocationAwaiting: null };
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
        invocations: invocations.map((entry) => ({
          scenarioId: entry.scenarioId,
          invocationId: entry.invocationId,
          status: entry.status,
          reason: entry.reason || null,
          messageId: entry.messageId || null,
          markerConsumed: entry.markerConsumed ?? null,
        })),
        dispatches: dispatches.map((entry) => ({ ...entry })),
        serialized: serialized.map((entry) => ({ ...entry })),
      };
    },
    cleanupState() {
      return {
        installed,
        byMessageId: byMessageId.size,
        ambiguousMessageIds: ambiguousMessageIds.size,
        ambiguityReasonsByMessageId: ambiguityReasonsByMessageId.size,
        invocationsByMarker: invocationsByMarker.size,
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
