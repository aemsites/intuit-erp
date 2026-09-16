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

// core/confine-google-ads-chamber.js
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
var NPA_PURPOSES = ["ad_user_data", "ad_personalization"];
function encodeNpa(vector) {
  const granted = NPA_PURPOSES.every((purpose) => resolveConsent(vector, purpose) === "granted");
  return granted ? "0" : "1";
}

// connectors/google-ads/connector.js
var GOOGLE_ADS_CCM_COLLECT_ENDPOINT = "https://www.google.com/ccm/collect";
var PAGE_LOAD_EVENT = "page_view";
var GOOGLE_ADS_EVENTS = Object.freeze([PAGE_LOAD_EVENT]);
var GOOGLE_ADS_EGRESS_PURPOSES = Object.freeze(["ad_storage"]);
function mapToAwCollect(event, { conversionId, ctx, endpoint }) {
  const source = event && (event.params || event.payload) || {};
  const query = [];
  appendParam(query, "tid", conversionId);
  appendParam(query, "en", event && event.type);
  appendParam(query, "dl", source.page_location);
  appendParam(query, "dt", source.page_title);
  appendParam(query, "auid", ctx && ctx.auid);
  appendParam(query, "gclid", ctx && ctx.gclid);
  appendParam(query, "wbraid", ctx && ctx.wbraid);
  appendParam(query, "gbraid", ctx && ctx.gbraid);
  appendParam(query, "gcs", encodeGcs(ctx && ctx.consent));
  appendParam(query, "gcd", encodeGcd(ctx && ctx.consent, ctx && ctx.consentDefault));
  appendParam(query, "npa", encodeNpa(ctx && ctx.consent));
  const url = query.length ? `${endpoint}?${query.join("&")}` : String(endpoint);
  return { url, method: "GET" };
}
function createGoogleAdsConnector(config = {}) {
  const { conversionId, ctx = {}, endpoint = GOOGLE_ADS_CCM_COLLECT_ENDPOINT } = config;
  const manifest = {
    name: "airlock/google-ads",
    // The page-load remarketing beacon fires on page_view (contrast GA4-gtag's `["*"]` catch-all):
    // a captured event of any other type maps to [] — the conversion ping is MVP9 (§A3).
    events: GOOGLE_ADS_EVENTS,
    // `reads` = PROJECTION snapshot fields (ADR-0003 default-deny). handle() reads the event PAYLOAD
    // + host-sourced ctx, never event.snapshot -> EMPTY (same as the GA4/pixel connectors).
    reads: [],
    capabilities: {
      // The first-party conversion-linker cookie airlock READS host-side for `auid` (never writes —
      // §A5). Declared for MVP3 disclosure; sourceGoogleAdsCtx is the (host-side) source.
      cookies: ["_gcl_au"],
      egress: true
    },
    // ADVISORY endpoint (ADR-0006 — host allow-list wins): the resolved ccm/collect endpoint.
    endpoints: [endpoint],
    // ADR-0007 consent-purpose annotation: Google Ads remarketing/conversion egress is governed by
    // `ad_storage` — declaring it here is what lets THE SEAL hold the beacon under `ad_storage`-denial
    // (slice 044-02). `gcs`/`gcd`/`npa` COMMUNICATE the consent decision (carried state), they are
    // not a second egress purpose. The `_gcl_au` read is `ad_storage`-purposed too (AC3's gate).
    purposes: {
      egress: GOOGLE_ADS_EGRESS_PURPOSES,
      endpoints: { [endpoint]: ["ad_storage"] },
      cookies: { _gcl_au: ["ad_storage"] }
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    if (!event || event.type !== PAGE_LOAD_EVENT) return [];
    return [{ ...mapToAwCollect(event, { conversionId, ctx, endpoint }), event }];
  }
  return { manifest, init, handle };
}

// core/google-ads-chamber.worker.js
var host = null;
var initPromise = null;
if (typeof self !== "undefined") {
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const { type, ...config } = m;
      host = createConnectorHost(createGoogleAdsConnector, config);
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
