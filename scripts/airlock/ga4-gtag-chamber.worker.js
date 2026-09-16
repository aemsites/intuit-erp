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

// core/confine-ga4-gtag-chamber.js
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

// core/query-params.js
function appendParam(query, key, value) {
  if (value === void 0 || value === null) return;
  query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

// core/consent.js
var CONSENT_PURPOSES = [
  "analytics_storage",
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "functional",
  "personalization"
];
function resolveConsent(vector, purpose) {
  if (!CONSENT_PURPOSES.includes(purpose)) return "pending";
  const raw = vector == null ? void 0 : vector[purpose];
  if (typeof raw !== "string") return "pending";
  const normalized = raw.toLowerCase();
  if (normalized === "granted") return "granted";
  if (normalized === "denied") return "denied";
  return "pending";
}

// connectors/consent-mode.js
var GCS_PURPOSES = ["ad_storage", "analytics_storage"];
var GCS_DIGIT = { granted: "1", denied: "0" };
function encodeGcs(vector) {
  const states = GCS_PURPOSES.map((purpose) => resolveConsent(vector, purpose));
  if (states.some((state) => state === "pending")) return void 0;
  return `G1${states.map((state) => GCS_DIGIT[state]).join("")}`;
}
var GCD_PURPOSES = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"];
var GCD_LETTER = { granted: "r", denied: "q" };
function isDeniedAllDefault(consentDefault) {
  if (consentDefault === void 0 || consentDefault === null) return true;
  return GCD_PURPOSES.every((purpose) => resolveConsent(consentDefault, purpose) === "denied");
}
function encodeGcd(vector, consentDefault) {
  if (!isDeniedAllDefault(consentDefault)) return void 0;
  const states = GCD_PURPOSES.map((purpose) => resolveConsent(vector, purpose));
  if (states.some((state) => state === "pending")) return void 0;
  const [adStorage, analyticsStorage, adUserData, adPersonalization] = states.map((state) => GCD_LETTER[state]);
  return `13${adStorage}3${analyticsStorage}3${adUserData}3${adPersonalization}5l1`;
}

// connectors/ga4/gtag.js
var GA4_GTAG_COLLECT_ENDPOINT = "https://www.google-analytics.com/g/collect";
var GA4_GTAG_EVENTS = Object.freeze(["*"]);
var GA4_GTAG_EGRESS_PURPOSES = Object.freeze(["analytics_storage"]);
var PROTOCOL_VERSION = "2";
var CORE_PAYLOAD_KEYS = /* @__PURE__ */ new Set(["page_location", "page_referrer", "page_title"]);
function appendSessionState(query, sessionState) {
  if (!sessionState) return;
  appendParam(query, "sct", sessionState.sct);
  appendParam(query, "seg", sessionState.seg);
  appendParam(query, "_fv", sessionState._fv);
  appendParam(query, "_ss", sessionState._ss);
  appendParam(query, "_nsi", sessionState._nsi);
}
function mapToGtagCollect(event, { measurementId, ctx, endpoint }) {
  const source = event && (event.params || event.payload) || {};
  const query = [];
  appendParam(query, "v", PROTOCOL_VERSION);
  appendParam(query, "tid", measurementId);
  appendParam(query, "cid", ctx && ctx.clientId);
  appendParam(query, "sid", ctx && ctx.sessionId);
  appendSessionState(query, ctx && ctx.sessionState);
  appendParam(query, "en", event && event.type);
  appendParam(query, "dl", source.page_location);
  appendParam(query, "dr", source.page_referrer);
  appendParam(query, "dt", source.page_title);
  for (const [key, value] of Object.entries(source)) {
    if (CORE_PAYLOAD_KEYS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      appendParam(query, `epn.${key}`, value);
    } else {
      appendParam(query, `ep.${key}`, value);
    }
  }
  appendParam(query, "gcs", encodeGcs(ctx && ctx.consent));
  appendParam(query, "gcd", encodeGcd(ctx && ctx.consent, ctx && ctx.consentDefault));
  const engagementTimeMsec = ctx && typeof ctx.engagementTimeMsec === "number" ? ctx.engagementTimeMsec : 100;
  appendParam(query, "_et", engagementTimeMsec);
  const url = query.length ? `${endpoint}?${query.join("&")}` : String(endpoint);
  return { url, method: "GET" };
}
function createGa4GtagConnector(config = {}) {
  const { measurementId, ctx = {}, endpoint = GA4_GTAG_COLLECT_ENDPOINT } = config;
  const manifest = {
    name: "airlock/ga4-gtag",
    // Catch-all, mirroring connectors/ga4/connector.js's own `events`
    // annotation: gtag maps every event type to /g/collect and accepts
    // arbitrary custom event names by design — enumeration is impossible.
    events: GA4_GTAG_EVENTS,
    // reads = PROJECTION snapshot fields (ADR-0003 default-deny). handle()
    // reads the event PAYLOAD (event.params/event.payload) + host-sourced
    // ctx, never event.snapshot -> EMPTY, same as the MP connector's manifest.
    reads: [],
    capabilities: {
      // Same client_id (_ga) / session_id (_ga_<stream>) identity model as
      // the MP connector (connectors/ga4/connector.js's own declaration) —
      // sourced host-side via connectors/ga4/cookies.js's sourceGa4Ctx,
      // unwired here (config.ctx arrives already-sourced).
      cookies: ["_ga", "_ga_"],
      // it emits one /g/collect GET per event (the ready EgressRequest[] below).
      egress: true
    },
    // ADVISORY endpoint (ADR-0006 — host allow-list wins): the resolved
    // /g/collect endpoint this instance was configured with.
    endpoints: [endpoint],
    // ADR-0007 consent-purpose annotation — gtag's OWN rationale, NOT
    // inherited from createGa4Connector's "no ads/personalization signal it
    // emits" wording (that wording does not hold for gtag, frame-critique
    // note): the beacon DOES carry `gcs`/`gcd` (Consent-Mode STATE/DEFAULTS,
    // 039-02/039-05) — but those fields COMMUNICATE the container's consent
    // DECISION (state carriage); they do not PERFORM ad egress themselves.
    // The beacon's own egress is a single analytics hit to /g/collect, so
    // `analytics_storage` is the sole governing purpose — `gcs`/`gcd` are
    // carried STATE, not a second egress purpose.
    purposes: {
      egress: GA4_GTAG_EGRESS_PURPOSES,
      endpoints: { [endpoint]: ["analytics_storage"] },
      cookies: {
        _ga: ["analytics_storage"],
        _ga_: ["analytics_storage"]
      }
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    return [mapToGtagCollect(event, { measurementId, ctx, endpoint })];
  }
  return { manifest, init, handle };
}

// core/ga4-gtag-chamber.worker.js
var host = null;
var initPromise = null;
if (typeof self !== "undefined") {
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const { type, ...config } = m;
      host = createConnectorHost(createGa4GtagConnector, config);
      initPromise = host.init({});
      return;
    }
    if (m.type === "events" && host) {
      Promise.resolve(initPromise).then(() => host.routeBatch(m.batch)).then(({ ready, dropped }) => {
        self.postMessage({ ready, dropped });
      }).catch((err) => {
        const reason = err && err.message != null ? err.message : String(err);
        self.postMessage({ ready: [], dropped: [{ index: -1, type: "__batch__", reason }] });
      });
    }
  };
}
