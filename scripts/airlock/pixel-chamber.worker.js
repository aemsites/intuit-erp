// core/egress-confinement.js
var CONFINEMENT_MESSAGE = "withheld in the chamber \u2014 the mediated fetch is the chamber's sole network-capable surface (egress confinement, spec 012-01 AC5)";
var WITHHELD_NETWORK_CONSTRUCTORS = [
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "Worker"
];
function withheldError(name) {
  return new Error(name + " is " + CONFINEMENT_MESSAGE);
}
function throwingConstructor(name) {
  return function airlockWithheld() {
    throw withheldError(name);
  };
}
function throwingCacheStorage() {
  const deny = (op) => () => {
    throw withheldError("caches." + op);
  };
  return {
    open: deny("open"),
    match: deny("match"),
    has: deny("has"),
    delete: deny("delete"),
    keys: deny("keys"),
    add: deny("add"),
    addAll: deny("addAll")
  };
}
function forceProp(target, name, value) {
  try {
    target[name] = value;
    if (target[name] === value) return "assigned";
  } catch (e) {
  }
  try {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
    return "defined";
  } catch (e) {
  }
  try {
    delete target[name];
    return "deleted";
  } catch (e) {
  }
  return "failed";
}
function denySendBeacon(navigator) {
  if (!navigator || typeof navigator !== "object") return "no-navigator";
  const stub = function airlockWithheld() {
    throw withheldError("navigator.sendBeacon");
  };
  return forceProp(navigator, "sendBeacon", stub);
}
function applyEgressConfinement(scope, opts = {}) {
  const withholdFetch = opts.withholdFetch === true;
  const fetchBefore = scope.fetch;
  const record = {
    withheld: {},
    caches: null,
    sendBeacon: null,
    fetchPreserved: false,
    fetchWithheld: false,
    message: CONFINEMENT_MESSAGE
  };
  for (const name of WITHHELD_NETWORK_CONSTRUCTORS) {
    record.withheld[name] = forceProp(scope, name, throwingConstructor(name));
  }
  record.caches = forceProp(scope, "caches", throwingCacheStorage());
  record.sendBeacon = scope.navigator ? denySendBeacon(scope.navigator) : "no-navigator";
  if (withholdFetch) {
    forceProp(scope, "fetch", throwingConstructor("fetch"));
    record.fetchPreserved = false;
    record.fetchWithheld = typeof scope.fetch === "function";
  } else {
    record.fetchPreserved = typeof scope.fetch === "function" && scope.fetch === fetchBefore;
    record.fetchWithheld = false;
  }
  return record;
}

// core/confine-pixel-chamber.js
if (typeof self !== "undefined") {
  applyEgressConfinement(self, { withholdFetch: true });
}

// core/connector-host.js
function createConnectorHost(factory, config) {
  const connector = factory(config);
  let initStarted = false;
  let initResult;
  function init(caps) {
    if (!initStarted) {
      initStarted = true;
      initResult = Promise.resolve(connector.init(caps));
    }
    return initResult;
  }
  async function routeBatch(events) {
    const ready = [];
    const dropped = [];
    for (const [index, event] of events.entries()) {
      try {
        if (event == null || typeof event.type !== "string") {
          throw new Error("malformed event: missing or non-string `type`");
        }
        const requests = await connector.handle(event);
        for (const req of requests) ready.push(req);
      } catch (err) {
        const reason = err && err.message != null ? err.message : String(err);
        dropped.push({ index, type: event && event.type, reason });
      }
    }
    return { ready, dropped };
  }
  return { manifest: connector.manifest, init, routeBatch };
}

// connectors/pixel/connector.js
function createPixelConnector(config = {}) {
  const {
    name = "airlock/pixel",
    endpoint,
    eventMap = {},
    paramMap = {},
    egressPurposes = [],
    endpoints,
    capabilities = {}
  } = config;
  const declaredEndpoints = Array.isArray(endpoints) && endpoints.length ? [...new Set(endpoints)] : typeof endpoint === "string" && endpoint.length ? [endpoint] : [];
  const manifest = {
    name,
    events: Object.keys(eventMap),
    reads: [],
    capabilities: { egress: true, ...capabilities },
    endpoints: declaredEndpoints,
    purposes: {
      egress: [...egressPurposes],
      endpoints: Object.fromEntries(declaredEndpoints.map((e) => [e, [...egressPurposes]]))
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    const type = event && event.type;
    if (!Object.prototype.hasOwnProperty.call(eventMap, type)) return [];
    const vendorEvent = eventMap[type];
    const source = event && (event.params || event.payload) || {};
    const query = [];
    for (const [queryKey, spec] of Object.entries(paramMap)) {
      if (!spec || typeof spec !== "object") continue;
      let value;
      if (spec.from === "static") value = spec.value;
      else if (spec.from === "event") value = vendorEvent;
      else if (spec.from === "params") value = source[spec.key];
      if (value === void 0 || value === null) continue;
      query.push(`${encodeURIComponent(queryKey)}=${encodeURIComponent(String(value))}`);
    }
    const url = query.length ? `${endpoint}?${query.join("&")}` : String(endpoint);
    return [{ url, method: "GET" }];
  }
  return { manifest, init, handle };
}

// connectors/pixel/advanced-matching.js
var collapse = (v) => String(v).trim().toLowerCase().replace(/[\s\p{P}]/gu, "");
var NORMALIZERS = {
  em: (v) => String(v).trim().toLowerCase(),
  ph: (v) => String(v).replace(/[^0-9]/g, "").replace(/^0+/, ""),
  fn: collapse,
  ln: collapse,
  db: (v) => String(v).replace(/[^0-9]/g, ""),
  ge: (v) => String(v).trim().toLowerCase().slice(0, 1),
  ct: collapse,
  st: collapse,
  zp: (v) => collapse(v).slice(0, 5),
  country: collapse,
  external_id: (v) => String(v)
};
var ADVANCED_MATCHING_FIELDS = Object.freeze(Object.keys(NORMALIZERS));
function normalizeField(field, rawValue) {
  const normalize = NORMALIZERS[field];
  if (typeof normalize !== "function") return void 0;
  if (rawValue === void 0 || rawValue === null) return void 0;
  return normalize(rawValue);
}
function subtleCrypto() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : void 0;
  return c && c.subtle && typeof c.subtle.digest === "function" ? c.subtle : null;
}
function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
async function hashField(field, rawValue) {
  const normalized = normalizeField(field, rawValue);
  if (normalized === void 0) return void 0;
  const subtle = subtleCrypto();
  if (!subtle) {
    throw new Error("airlock/pixel/advanced-matching: WebCrypto SubtleCrypto.digest is unavailable in this realm");
  }
  const bytes = new TextEncoder().encode(normalized);
  const digest = await subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}
function mergeAdvancedMatching(requests, udHashes) {
  if (!requests || !requests.length || !udHashes) return requests;
  const params = [];
  for (const field of Object.keys(udHashes)) {
    const hex = udHashes[field];
    if (hex === void 0 || hex === null || hex === "") continue;
    params.push(`${encodeURIComponent(`ud[${field}]`)}=${encodeURIComponent(String(hex))}`);
  }
  if (!params.length) return requests;
  const suffix = params.join("&");
  return requests.map((req) => {
    if (!req || typeof req.url !== "string") return req;
    const sep = req.url.includes("?") ? "&" : "?";
    return { ...req, url: `${req.url}${sep}${suffix}` };
  });
}

// core/pixel-chamber.worker.js
var host = null;
var initPromise = null;
var identityHashes = /* @__PURE__ */ Object.create(null);
function ingestIdentity(raw, post) {
  if (!raw || typeof raw !== "object") return;
  for (const field of Object.keys(raw)) {
    const value = raw[field];
    if (value === void 0 || value === null) continue;
    Promise.resolve().then(() => hashField(field, value)).then((hex) => {
      if (hex === void 0) return;
      identityHashes[field] = hex;
      post({ type: "identity", ud: { [field]: hex } });
    }).catch(() => {
    });
  }
}
if (typeof self !== "undefined") {
  const post = (msg) => self.postMessage(msg);
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const { type, advancedMatching, ...config } = m;
      host = createConnectorHost(createPixelConnector, config);
      initPromise = host.init({});
      if (advancedMatching) ingestIdentity(advancedMatching, post);
      return;
    }
    if (m.type === "identity") {
      ingestIdentity(m.raw, post);
      return;
    }
    if (m.type === "events" && host) {
      Promise.resolve(initPromise).then(() => host.routeBatch(m.batch)).then(({ ready, dropped }) => {
        self.postMessage({ ready: mergeAdvancedMatching(ready, identityHashes), dropped });
      }).catch((err) => {
        const reason = err && err.message != null ? err.message : String(err);
        self.postMessage({ ready: [], dropped: [{ index: -1, type: "__batch__", reason }] });
      });
    }
  };
}
