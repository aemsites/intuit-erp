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

// core/confine-ga4-chamber.js
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

// connectors/ga4/map.js
function validatePurchase(params) {
  const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
  if (!isNonEmptyString(params.transaction_id)) {
    throw new Error("purchase event missing or invalid transaction_id");
  }
  if (!isNonEmptyString(params.currency)) {
    throw new Error("purchase event missing or invalid currency");
  }
  if (typeof params.value !== "number" || !Number.isFinite(params.value) || params.value < 0) {
    throw new Error("purchase event missing or invalid value (non-negative number required)");
  }
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new Error("purchase event missing or invalid items");
  }
}
function mapToMp(event, ctx) {
  if (event.type === "purchase") validatePurchase(event.params || {});
  const params = {
    ...event.params || {},
    // session_id + engagement_time_msec are required for the event to attribute
    // to a session and appear in standard reports (contracts/ga4-mp.md §4).
    session_id: String(ctx.sessionId),
    engagement_time_msec: typeof ctx.engagementTimeMsec === "number" ? ctx.engagementTimeMsec : 100
  };
  const body = {
    client_id: ctx.clientId,
    events: [{ name: event.type, params }]
  };
  if (ctx.userId) body.user_id = ctx.userId;
  if (ctx.consent) body.consent = ctx.consent;
  return body;
}

// connectors/ga4/connector.js
var GA4_EVENTS = Object.freeze(["*"]);
var GA4_EGRESS_PURPOSES = Object.freeze(["analytics_storage"]);
function createGa4Connector(config = {}) {
  const {
    endpoints = [],
    trackers = endpoints.length,
    workFactor = 0,
    ctx
  } = config;
  const manifest = {
    name: "airlock/ga4",
    // GA4 is the analytics CATCH-ALL: it maps every event type to MP and accepts
    // arbitrary custom event names by design (contracts/ga4-mp.md), so enumeration
    // is impossible — `["*"]` declares "all event types route here" (declared, NOT
    // enforced). Contrast alloy's fixed single-event MVP2 proof scope.
    events: GA4_EVENTS,
    // `reads` = PROJECTION snapshot fields (ADR-0003 default-deny). GA4's handle
    // maps the event PAYLOAD (event.params) + host-sourced ctx — it reads NO
    // projection snapshot fields (never touches event.snapshot) — so `reads` is
    // EMPTY. (The open param set GA4 forwards is the event PAYLOAD, which crosses
    // ungoverned per ADR-0006 — a DIFFERENT channel from `reads`.)
    reads: [],
    capabilities: {
      // client_id (_ga) / session_id (_ga_<stream>) persistence — declared for
      // MVP3 disclosure; connectors/ga4/cookies.js is the (unwired-here) source.
      // "_ga_" is a PREFIX (the real name carries a dynamic per-stream suffix),
      // mirroring alloy's own prefix-style dynamic-suffix cookie declarations
      // ("kndctr_", "AMCV_").
      cookies: ["_ga", "_ga_"],
      // it emits one MP request per tracker (the ready EgressRequest[] below).
      egress: true
    },
    // 012-04-style ADVISORY endpoints (ADR-0006 — host allow-list wins): the
    // per-tracker MP collect URLs this instance was configured with.
    endpoints: [...new Set(endpoints)],
    // ADR-0007 consent-purpose annotation: GA4 is analytics-only (no ads/
    // personalization signal it emits) — the Consent Mode `analytics_storage`
    // purpose tags every declared endpoint/cookie and egress overall. `reads` is
    // OMITTED because `reads` is EMPTY (GA4 reads no projection fields — nothing to
    // purpose-tag); the event payload it forwards crosses ungoverned (ADR-0006),
    // outside the per-field purpose model.
    purposes: {
      egress: GA4_EGRESS_PURPOSES,
      endpoints: Object.fromEntries(
        [...new Set(endpoints)].map((e) => [e, ["analytics_storage"]])
      ),
      cookies: {
        _ga: ["analytics_storage"],
        _ga_: ["analytics_storage"]
      }
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    const legacyEvent = {
      type: event && event.type,
      params: event && (event.params || event.payload) || {}
    };
    const requests = [];
    for (let t = 0; t < trackers; t++) {
      const body = mapToMp(legacyEvent, ctx);
      busy(workFactor);
      requests.push({ url: endpoints[t], body: JSON.stringify(body) });
    }
    return requests;
  }
  return { manifest, init, handle };
}
function busy(micros) {
  if (micros <= 0) return;
  const end = performance.now() + micros / 1e3;
  while (performance.now() < end) {
  }
}

// core/chamber.worker.js
var host = null;
var initPromise = null;
if (typeof self !== "undefined") {
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const { type, ...config } = m;
      host = createConnectorHost(createGa4Connector, config);
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
