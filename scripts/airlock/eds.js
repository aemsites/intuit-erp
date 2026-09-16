// connectors/ga4/map.js
function validatePurchase(params) {
  const isNonEmptyString = (v2) => typeof v2 === "string" && v2.length > 0;
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

// core/egress.js
var KEEPALIVE_BUDGET_BYTES = 64 * 1024;
function fetchInit(method, body) {
  return method === "GET" ? { method: "GET", keepalive: true } : { method: "POST", body, keepalive: true };
}
function createCriticalDispatcher({
  ctx,
  endpoints,
  trackers,
  // 030-01: the main-thread unload mapper is connector-generic. Default = GA4's
  // `mapToMp` (byte-unchanged for every existing caller); a worker-mapped connector
  // whose map lives in the chamber (e.g. helix-rum) passes a closure binding its own
  // main-thread mapper — `(event, ctx) => mapToRum(event, ctx, sampling)` — so its
  // unload-critical events (RUM's INP/late-CLS at page-hide) egress correctly instead
  // of being GA4-mis-mapped or dropped.
  mapper = mapToMp,
  budgetBytes = KEEPALIVE_BUDGET_BYTES,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  encode = (s2) => new TextEncoder().encode(s2).length,
  requestMapper
}) {
  let used = 0;
  let dispatched = 0;
  let dropped = 0;
  const n2 = typeof trackers === "number" ? trackers : endpoints ? endpoints.length : 0;
  function dispatch(event) {
    if (typeof requestMapper === "function") {
      const requests = requestMapper(event) || [];
      for (const req of requests) {
        try {
          const p2 = fetchImpl(req.url, fetchInit(req.method, req.body));
          if (p2 && typeof p2.then === "function") p2.then(() => {
          }, () => {
          });
          dispatched++;
        } catch {
          dropped++;
        }
      }
      return;
    }
    for (let t2 = 0; t2 < n2; t2++) {
      const body = JSON.stringify(mapper(event, ctx));
      const bytes = encode(body);
      if (used + bytes > budgetBytes) {
        dropped++;
        continue;
      }
      used += bytes;
      try {
        const p2 = fetchImpl(endpoints[t2], { method: "POST", body, keepalive: true });
        if (p2 && typeof p2.then === "function") p2.then(() => {
        }, () => {
        });
        dispatched++;
      } catch {
        dropped++;
      }
    }
  }
  return {
    dispatch,
    bytesUsed: () => used,
    stats: () => ({
      fastDispatched: dispatched,
      fastDropped: dropped,
      keepaliveBytesUsed: used
    })
  };
}

// connectors/helix-rum/map.js
var RATE_WEIGHTS = { on: 1, off: 0, high: 10, medium: 100, low: 1e3 };
function resolveWeight({ rate, weight } = {}) {
  if (typeof weight === "number") return weight;
  if (typeof rate === "string" && Object.prototype.hasOwnProperty.call(RATE_WEIGHTS, rate)) {
    return RATE_WEIGHTS[rate];
  }
  return RATE_WEIGHTS.medium;
}
function rumUrl(collectBaseURL, weight) {
  return new URL(`.rum/${weight}`, collectBaseURL).href;
}
function errorFields(event) {
  const data = event && (event.params || event.payload) || {};
  return { source: data.source, target: data.target };
}
var CWV_ATTRIBUTION_FIELDS = [
  // LCPAttribution (lcp.d.ts:14-67) — excludes navigationEntry/
  // lcpResourceEntry/lcpEntry (each PerformanceEntry-shaped).
  "target",
  "url",
  "timeToFirstByte",
  "resourceLoadDelay",
  "resourceLoadDuration",
  "elementRenderDelay",
  // CLSAttribution (cls.d.ts:14-51) — excludes largestShiftEntry (a
  // LayoutShift entry) and largestShiftSource (carries a live DOM Node ref).
  "largestShiftTarget",
  "largestShiftTime",
  "largestShiftValue",
  "loadState",
  // INPAttribution (inp.d.ts:36-155) — excludes processedEventEntries /
  // longAnimationFrameEntries (entry arrays) and longestScript (nests a
  // PerformanceScriptTiming `.entry`; its two safe sub-scalars, `subpart`/
  // `intersectingDuration`, are dropped WHOLESALE along with it by
  // `projectCwv`'s shallow filter rather than partially unwrapped — see that
  // function's doc). `loadState` is shared with CLSAttribution, listed once.
  "interactionTarget",
  "interactionTime",
  "interactionType",
  "nextPaintTime",
  "inputDelay",
  "processingDuration",
  "presentationDelay",
  "totalScriptDuration",
  "totalStyleAndLayoutDuration",
  "totalPaintDuration",
  "totalUnattributedDuration"
];
function cwvFields(event) {
  const data = event && (event.params || event.payload) || {};
  const fields = { name: data.name, value: data.value };
  for (const key of CWV_ATTRIBUTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) fields[key] = data[key];
  }
  return fields;
}
function mapToRum(event, ctx, sampling) {
  const body = {
    weight: sampling.weight,
    id: sampling.id,
    referer: ctx && ctx.referer || "",
    checkpoint: event.type,
    t: typeof event.ts === "number" ? event.ts : 0
  };
  if (event.type === "error") return { ...body, ...errorFields(event) };
  if (event.type === "cwv") return { ...body, ...cwvFields(event) };
  return body;
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
function egressVerdict(vector, purposes, { strict = false, holdOnDenied = false } = {}) {
  let verdict = "send";
  for (const p2 of purposes || []) {
    const state = resolveConsent(vector, p2);
    if (strict && state !== "granted") return "drop";
    if (state === "pending" && verdict === "send") verdict = "hold";
    if (holdOnDenied && state === "denied" && verdict === "send") verdict = "hold";
  }
  return verdict;
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

// core/cookie-parse.js
function getCookieValue(cookieString, name) {
  if (typeof cookieString !== "string" || cookieString.length === 0) return void 0;
  for (const pair of cookieString.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const raw = pair.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return void 0;
}

// connectors/google-ads/cookies.js
var DIGITS = /^\d+$/;
function parseGclAuId(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(".");
  if (parts.length < 2) return null;
  const random = parts[parts.length - 2];
  const seconds = parts[parts.length - 1];
  if (!DIGITS.test(random) || !DIGITS.test(seconds)) return null;
  return `${random}.${seconds}`;
}
var CLICK_ID_PARAMS = ["gclid", "wbraid", "gbraid"];
function readClickIds(landingUrl) {
  const out = {};
  if (typeof landingUrl !== "string" || landingUrl.length === 0) return out;
  let searchParams;
  try {
    searchParams = new URL(landingUrl).searchParams;
  } catch {
    return out;
  }
  for (const param of CLICK_ID_PARAMS) {
    const value = searchParams.get(param);
    if (value !== null && value !== "") out[param] = value;
  }
  return out;
}
function sourceGoogleAdsCtx({ cookieString = "", landingUrl = "", adStorageGranted = true } = {}) {
  const ctx = {};
  if (adStorageGranted) {
    const auid = parseGclAuId(getCookieValue(cookieString, "_gcl_au"));
    if (auid !== null) ctx.auid = auid;
  }
  Object.assign(ctx, readClickIds(landingUrl));
  return ctx;
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
function createGoogleAdsRemap({
  conversionId,
  endpoint = GOOGLE_ADS_CCM_COLLECT_ENDPOINT,
  consentDefault,
  readCookieString,
  landingUrl
}) {
  return (event, consent) => {
    const adStorageGranted = resolveConsent(consent, "ad_storage") === "granted";
    const sourced = sourceGoogleAdsCtx({ cookieString: readCookieString(), landingUrl, adStorageGranted });
    return mapToAwCollect(event, { conversionId, ctx: { ...sourced, consent, consentDefault }, endpoint });
  };
}

// core/path-matrix.js
function appendMatrixParam(segments, key, value) {
  if (value === void 0 || value === null) return;
  segments.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}
function joinMatrixUrl(base, segments) {
  return segments.length ? `${base};${segments.join(";")}` : String(base);
}

// connectors/floodlight/connector.js
var FLOODLIGHT_CCM_COLLECT_ENDPOINT = "https://www.google.com/ccm/collect";
var FLOODLIGHT_ACTIVITY_ENDPOINT = "https://ad.doubleclick.net/activity";
function deriveActivityCeilingEndpoint({ src, activityEndpoint = FLOODLIGHT_ACTIVITY_ENDPOINT } = {}) {
  const segments = [];
  appendMatrixParam(segments, "src", src);
  return joinMatrixUrl(activityEndpoint, segments);
}
var PAGE_LOAD_EVENT2 = "page_view";
var FLOODLIGHT_EVENTS = Object.freeze([PAGE_LOAD_EVENT2]);
var FLOODLIGHT_EGRESS_PURPOSES = Object.freeze(["ad_storage"]);
function mapToDcCollect(event, { conversionId, ctx, endpoint }) {
  const source = event && (event.params || event.payload) || {};
  const query = [];
  appendParam(query, "tid", conversionId);
  appendParam(query, "en", event && event.type);
  appendParam(query, "dl", source.page_location);
  appendParam(query, "dt", source.page_title);
  appendParam(query, "auid", ctx && ctx.auid);
  appendParam(query, "gcs", encodeGcs(ctx && ctx.consent));
  appendParam(query, "gcd", encodeGcd(ctx && ctx.consent, ctx && ctx.consentDefault));
  appendParam(query, "npa", encodeNpa(ctx && ctx.consent));
  const url = query.length ? `${endpoint}?${query.join("&")}` : String(endpoint);
  return { url, method: "GET" };
}
function mapToDcActivity(_event, { src, type, cat, ctx, endpoint }) {
  const segments = [];
  appendMatrixParam(segments, "src", src);
  appendMatrixParam(segments, "type", type);
  appendMatrixParam(segments, "cat", cat);
  appendMatrixParam(segments, "npa", encodeNpa(ctx && ctx.consent));
  appendMatrixParam(segments, "gcs", encodeGcs(ctx && ctx.consent));
  appendMatrixParam(segments, "gcd", encodeGcd(ctx && ctx.consent, ctx && ctx.consentDefault));
  appendMatrixParam(segments, "auiddc", ctx && ctx.auid);
  const url = joinMatrixUrl(endpoint, segments);
  return { url, method: "GET" };
}
function createFloodlightConnector(config = {}) {
  const {
    conversionId,
    // The Floodlight-native activity identity (046-02) — src/type/cat, config-provided exactly like
    // conversionId. `src` also anchors the activity endpoint's declared ceiling prefix, and its mere
    // PRESENCE (below) gates whether the activity beacon/endpoint exist at all.
    src,
    type,
    cat,
    ctx = {},
    endpoint = FLOODLIGHT_CCM_COLLECT_ENDPOINT,
    activityEndpoint = FLOODLIGHT_ACTIVITY_ENDPOINT
  } = config;
  const hasActivityIdentity = src !== void 0 && src !== null;
  const activityCeilingEndpoint = deriveActivityCeilingEndpoint({ src, activityEndpoint });
  const manifest = {
    name: "airlock/floodlight",
    // The page-load beacon fires on page_view (contrast GA4-gtag's `["*"]` catch-all): a captured
    // event of any other type maps to [] — the true conversion activity ping is MVP9 (§A5).
    events: FLOODLIGHT_EVENTS,
    // `reads` = PROJECTION snapshot fields (ADR-0003 default-deny). handle() reads the event PAYLOAD
    // + host-sourced ctx, never event.snapshot -> EMPTY (same as the AW/GA4/pixel connectors).
    reads: [],
    capabilities: {
      // The first-party conversion-linker cookie airlock READS host-side for `auid` (never writes —
      // §A5, via the REUSED sourceGoogleAdsCtx). Declared for MVP3 disclosure.
      cookies: ["_gcl_au"],
      egress: true
    },
    // ADVISORY endpoints (ADR-0006 — host allow-list wins): the fixed `ccm/collect` (046-01, exact
    // origin+path) endpoint ALWAYS; the `;`-matrix `activity` prefix (046-02, segment-anchored prefix
    // match) ONLY when the activity identity is configured (`hasActivityIdentity`) — a `src`-less
    // connector declares a single endpoint, exactly like 046-01 (AC5).
    endpoints: hasActivityIdentity ? [endpoint, activityCeilingEndpoint] : [endpoint],
    // ADR-0007 consent-purpose annotation: each DECLARED page-load beacon's egress is governed by
    // `ad_storage` — declaring it here is what lets THE SEAL hold them under `ad_storage`-denial
    // (046-03). `gcs`/`gcd`/`npa` COMMUNICATE the consent decision (carried state), they are not a
    // second egress purpose. The `_gcl_au` read is `ad_storage`-purposed too (AC3's gate).
    purposes: {
      egress: FLOODLIGHT_EGRESS_PURPOSES,
      endpoints: hasActivityIdentity ? { [endpoint]: ["ad_storage"], [activityCeilingEndpoint]: ["ad_storage"] } : { [endpoint]: ["ad_storage"] },
      cookies: { _gcl_au: ["ad_storage"] }
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    if (!event || event.type !== PAGE_LOAD_EVENT2) return [];
    const requests = [{ ...mapToDcCollect(event, { conversionId, ctx, endpoint }), event, remapKey: "ccm" }];
    if (hasActivityIdentity) {
      requests.push({
        ...mapToDcActivity(event, { src, type, cat, ctx, endpoint: activityEndpoint }),
        event,
        remapKey: "activity"
      });
    }
    return requests;
  }
  return { manifest, init, handle };
}
function createFloodlightRemap({
  conversionId,
  src,
  type,
  cat,
  endpoint = FLOODLIGHT_CCM_COLLECT_ENDPOINT,
  activityEndpoint = FLOODLIGHT_ACTIVITY_ENDPOINT,
  consentDefault,
  readCookieString,
  landingUrl
}) {
  return (event, consent, remapKey) => {
    try {
      const adStorageGranted = resolveConsent(consent, "ad_storage") === "granted";
      const sourced = sourceGoogleAdsCtx({ cookieString: readCookieString(), landingUrl, adStorageGranted });
      const ctx = { ...sourced, consent, consentDefault };
      if (remapKey === "activity") {
        return mapToDcActivity(event, { src, type, cat, ctx, endpoint: activityEndpoint });
      }
      return mapToDcCollect(event, { conversionId, ctx, endpoint });
    } catch {
      return void 0;
    }
  };
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
      endpoints: Object.fromEntries(declaredEndpoints.map((e2) => [e2, [...egressPurposes]]))
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
var collapse = (v2) => String(v2).trim().toLowerCase().replace(/[\s\p{P}]/gu, "");
var NORMALIZERS = {
  em: (v2) => String(v2).trim().toLowerCase(),
  ph: (v2) => String(v2).replace(/[^0-9]/g, "").replace(/^0+/, ""),
  fn: collapse,
  ln: collapse,
  db: (v2) => String(v2).replace(/[^0-9]/g, ""),
  ge: (v2) => String(v2).trim().toLowerCase().slice(0, 1),
  ct: collapse,
  st: collapse,
  zp: (v2) => collapse(v2).slice(0, 5),
  country: collapse,
  external_id: (v2) => String(v2)
};
var ADVANCED_MATCHING_FIELDS = Object.freeze(Object.keys(NORMALIZERS));
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

// core/endpoint-ceiling.js
function originPath(url) {
  try {
    const u2 = new URL(url, "https://airlock.local");
    return u2.origin + u2.pathname;
  } catch {
    return null;
  }
}
function checkEndpointCeiling(url, declaredEndpoints) {
  const destination = originPath(url);
  const exact = /* @__PURE__ */ new Set();
  const prefixes = [];
  for (const endpoint of declaredEndpoints || []) {
    const reduced = originPath(endpoint);
    if (!reduced) continue;
    if (reduced.includes(";")) prefixes.push(reduced);
    else exact.add(reduced);
  }
  if (exact.size === 0 && prefixes.length === 0) {
    return { verdict: "hold", destination, reason: "endpoint-ceiling: no declared endpoints \u2014 fail closed (hold)" };
  }
  if (destination === null) {
    return { verdict: "hold", destination, reason: "endpoint-ceiling: unparseable outbound url \u2014 fail closed (hold)" };
  }
  if (exact.has(destination)) {
    return { verdict: "allow", destination, reason: "ok" };
  }
  for (const prefix of prefixes) {
    if (destination === prefix || destination.startsWith(`${prefix};`)) {
      return { verdict: "allow", destination, reason: "ok" };
    }
  }
  return {
    verdict: "hold",
    destination,
    reason: `endpoint-ceiling: outbound ${destination} not in declared endpoints \u2014 held at the seal`
  };
}

// core/payload-governance.js
var DEFAULT_DENYLIST = [
  "password",
  "passwd",
  "pwd",
  "cvv",
  "cvv2",
  "cvc",
  "ssn",
  "social_security_number",
  "card_number",
  "cardnumber",
  "credit_card",
  "creditcard",
  "cc_number"
];
function findKeyCaseInsensitive(obj, name) {
  if (obj == null || typeof obj !== "object") return void 0;
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) return key;
  }
  return void 0;
}
function matchingKeysCaseInsensitive(obj, name) {
  if (obj == null || typeof obj !== "object") return [];
  const lower = name.toLowerCase();
  return Object.keys(obj).filter((key) => key.toLowerCase() === lower);
}
function stripDottedPath(governed, segments) {
  let cur = governed;
  const actualKeys = [];
  for (let i2 = 0; i2 < segments.length - 1; i2++) {
    const key = findKeyCaseInsensitive(cur, segments[i2]);
    if (key === void 0) return false;
    actualKeys.push(key);
    cur = cur[key];
  }
  const leafKeys = matchingKeysCaseInsensitive(cur, segments[segments.length - 1]);
  if (leafKeys.length === 0) return false;
  let node = governed;
  for (const key of actualKeys) {
    node[key] = { ...node[key] };
    node = node[key];
  }
  for (const leafKey of leafKeys) delete node[leafKey];
  return true;
}
function governPayload(params, denylist) {
  const entries = Array.isArray(denylist) ? denylist.filter((e2) => typeof e2 === "string" && e2.length > 0) : [];
  if (entries.length === 0) return { governed: params, stripped: [] };
  try {
    const governed = { ...params };
    const stripped = [];
    for (const entry of entries) {
      if (entry.includes(".")) continue;
      const keys = matchingKeysCaseInsensitive(governed, entry);
      if (keys.length) {
        for (const key of keys) delete governed[key];
        stripped.push(entry);
      }
    }
    for (const entry of entries) {
      if (!entry.includes(".")) continue;
      const segments = entry.split(".").filter(Boolean);
      if (segments.length < 2) continue;
      if (stripDottedPath(governed, segments)) stripped.push(entry);
    }
    return { governed: stripped.length ? governed : params, stripped };
  } catch {
    try {
      return { governed: { ...params }, stripped: [], error: true };
    } catch {
      return { governed: params, stripped: [], error: true };
    }
  }
}

// core/airlock.js
function consoleDiagnostic(record) {
  const fn = record.level === "error" ? console.error : console.warn;
  fn("airlock:", record);
}
var EGRESS_TEXT_ENCODER = new TextEncoder();
function createAirlock({
  trackers,
  workFactor,
  endpoints,
  ctx,
  unloadCritical,
  onDiagnostic,
  consent = null,
  egressPurposes = [],
  consentStrict = false,
  // 045-01 (ADR-0023 Option E): the per-connector `holdOnDenied` opt-in,
  // mirroring `consentStrict` above. When true, a DENIED governing egress
  // purpose HOLDS (buffer + flush-on-grant) instead of the default send —
  // grounded per vendor by the consumer (g-ads 044-02), never blanket-by-
  // purpose. Default false -> the seal behaves exactly as today (denied ->
  // send). Threaded to all three `egressVerdict` sites below.
  holdOnDenied = false,
  // 045-01: the per-connector main-thread RE-MAPPER a `holdOnDenied` consumer
  // supplies — `(event, consentVector, remapKey?) => EgressRequest`. On a
  // grant-flush, a beacon HELD under denial is REBUILT from its source event
  // under the now-current consent/ctx (fresh `auid`, granted `gcs`/`npa`)
  // instead of re-sending the stale under-denial `{url,body}` (which would
  // fire an unattributable "user-declined" beacon — ADR-0023's load-bearing
  // correction). Absent -> a held beacon falls back to the 017-03 verbatim
  // re-send. This slice wires NO real connector; 044-02 supplies g-ads' `remap`.
  // 045-03 (ADR-0024): the optional third `remapKey` arg lets a single
  // key-aware `remap` disambiguate WHICH of a fan-out connector's N held
  // beacons is being rebuilt (`EgressRequest.remapKey`, connector.d.ts) — a
  // 1:1 remap that ignores the third arg is byte-unchanged.
  remap,
  payloadDenylist = [],
  // Connector-selection seam (spec 026-01 AC3, resolving the "GA4-hardcoded
  // connector factory + worker URL" gap; spec 025-03 AC6 adds a THIRD
  // branch): `connector: "pixel"` hosts `connectors/pixel/connector.js`'s
  // createPixelConnector via `core/pixel-chamber.worker.js`; `connector:
  // "dom"` hosts airlock's own worker-side DOM mirror
  // (`core/worker-dom/mirror.js`) via `core/dom-chamber.worker.js` — instead
  // of the default GA4 chamber. Both non-GA4 branches generalize the
  // `worker.postMessage({type:"init", …})` payload below to carry
  // `connectorConfig` VERBATIM (a free-form bag the specific chamber
  // interprets — the pixel chamber reads its declarative config fields, the
  // dom chamber reads `{authorSource, elements, workUs}`) instead of the
  // GA4-shaped `{trackers, workFactor, endpoints, ctx}` fields. Omitted (or
  // any value other than "pixel"/"dom") -> the GA4 default path,
  // BYTE-UNCHANGED (a regression test pins the worker URL + the exact init
  // message shape for both GA4 AND pixel).
  connector,
  connectorConfig,
  // 040-02 (ADR-0021 Option C): the OPTIONAL core-egress coalescing hook —
  // `(requests: EgressRequest[]) => EgressRequest[]` — a connector-agnostic
  // main-thread seam a caller may inject to merge same-endpoint (origin+path)
  // `ready` requests within ONE lock-through cycle, AFTER the per-request
  // egress verdict + endpoint-ceiling gates and BEFORE dispatch (never across
  // cycles, never on inputs those gates already dropped/held). Absent, or not
  // a function -> NO-COALESCE (the default): every survivor dispatches as its
  // own `fetch`, byte-identical to pre-040-02 behavior. This slice wires ONLY
  // the seam; the GA4-specific batching strategy is a later connector-level
  // concern (040-03), not this parameter. Distinct from — and NOT wired to —
  // `core/coalescing-broker.js` (Alloy's identity-mint deduper on a different,
  // round-trip path; ADR-0021 Amendment 2026-09-09).
  coalesce
}) {
  const diagnose = typeof onDiagnostic === "function" ? onDiagnostic : consoleDiagnostic;
  const inspectorTag = (Math.random().toString(36).slice(2) + "000000").slice(0, 6);
  let beaconSeq = 0;
  const effectiveDenylist = [...DEFAULT_DENYLIST, ...payloadDenylist || []];
  function governParams(params) {
    if (!effectiveDenylist.length) return params;
    const { governed, stripped, error } = governPayload(params, effectiveDenylist);
    if (error) {
      diagnose({ level: "error", kind: "payload-governance", disposition: "skipped", reason: "govern-failed" });
    }
    for (const field of stripped) {
      diagnose({ level: "warn", kind: "payload-governance", disposition: "stripped", field });
    }
    return governed;
  }
  const ceiling = (endpoints || []).map(originPath).filter(Boolean);
  let consentVector = consent || {};
  const heldBeacons = [];
  const identityCache = /* @__PURE__ */ Object.create(null);
  const log = [];
  const projection = /* @__PURE__ */ Object.create(null);
  const ring = [];
  let seq = 0;
  let dispatched = 0;
  let scheduled = false;
  const criticalTypes = new Set(unloadCritical || []);
  if (connector === "helix-rum" && !(connectorConfig && connectorConfig.sampling)) {
    console.error(
      "airlock: helix-rum instance constructed without connectorConfig.sampling \u2014 its unload CWV would fall back to GA4 mapping; bootHelixRum must pass { sampling: { weight, id } }."
    );
  }
  const pixelUnloadConnector = connector === "pixel" ? createPixelConnector((({ advancedMatching, ...rest }) => rest)(connectorConfig || {})) : null;
  const critical = createCriticalDispatcher({
    ctx,
    endpoints,
    trackers,
    ...connector === "helix-rum" && connectorConfig && connectorConfig.sampling ? { mapper: (event, mapCtx) => mapToRum(event, mapCtx, connectorConfig.sampling) } : {},
    // 042-01: ga4-gtag's map lives entirely in its own pure `handle` (no
    // main-thread `mapper` reshape needed, unlike helix-rum above) — the
    // SAME `EgressRequest[]`-returning function `core/ga4-gtag-chamber.worker.js`
    // hosts via `createConnectorHost`. Constructed ONCE here (not per dispatch),
    // mirroring the helix-rum branch's own single construction. `handle` is a
    // closure over `measurementId`/`ctx`/`endpoint` (no `this`), so passing it
    // directly as `requestMapper` is safe.
    ...connector === "ga4-gtag" ? { requestMapper: createGa4GtagConnector(connectorConfig || {}).handle } : {},
    // 048-01: google-ads is the SAME worker-mapped, GET-egress class as ga4-gtag — its
    // `handle` is a closure over `conversionId`/`ctx`/`endpoint` (no `this`), so passing
    // it directly as `requestMapper` is safe, mirroring the ga4-gtag branch above
    // verbatim (the unload/pushCritical GET tail for the AW ccm/collect beacon).
    ...connector === "google-ads" ? { requestMapper: createGoogleAdsConnector(connectorConfig || {}).handle } : {},
    // 048-02: floodlight is the SAME worker-mapped, GET-egress class as google-ads/ga4-gtag — its
    // `handle` is a closure over `conversionId`/`src`/`type`/`cat`/`ctx`/`endpoint`/`activityEndpoint`
    // (no `this`), so passing it directly as `requestMapper` is safe, mirroring the google-ads branch
    // above verbatim (the unload/pushCritical GET tail for BOTH DC beacon forms — ccm/collect always,
    // plus the `;`-matrix activity beacon when `src` is configured — `handle` fans out to both).
    ...connector === "floodlight" ? { requestMapper: createFloodlightConnector(connectorConfig || {}).handle } : {},
    // 042-02: generalizes the SAME mechanism to pixel. pixel's `handle` reads
    // NO `ctx` at all (only the declarative `{endpoint, eventMap, paramMap}`
    // config, unlike gtag's `ctx`-reading `handle` above) — the SIMPLER case,
    // still a pure closure over `config` (no `this`), so passing it directly
    // as `requestMapper` is safe. Constructed ONCE here, mirroring both
    // branches above. An unmapped `event.type` -> `handle` returns `[]`,
    // which `critical.dispatch` already tolerates as a clean no-op (042-01
    // AC2).
    //
    // 026-04 (ADR-0022): the pixel unload `requestMapper` merges the cached
    // advanced-matching hashes into the closing `/tr` GET — SYNCHRONOUSLY (read
    // the `identityCache`, no await; the eager hashing already warmed it). The
    // connector's own `handle` stays identity-agnostic (it built the base
    // `/tr`); `mergeAdvancedMatching` appends `ud[...]` per-field (a still-cold
    // field is omitted, never blanked, never raw). `pixelUnloadConnector` is
    // built ONCE from an advancedMatching-stripped config (defense: the connector
    // never even receives the raw boot identity).
    ...connector === "pixel" ? {
      requestMapper: (event) => mergeAdvancedMatching(pixelUnloadConnector.handle(event), identityCache)
    } : {}
  });
  const criticalDispatchGated = (d2) => {
    if (egressPurposes.length) {
      const v2 = egressVerdict(consentVector, egressPurposes, { strict: consentStrict, holdOnDenied });
      if (v2 !== "send") {
        diagnose({
          level: "warn",
          kind: "consent",
          disposition: "dropped",
          purpose: egressPurposes.join(","),
          reason: "sync/unload path \u2014 un-granted purpose dropped (no hold at teardown)"
        });
        return;
      }
    }
    critical.dispatch({ ...d2, params: governParams(d2.params) });
  };
  const worker = connector === "pixel" ? new Worker(new URL("./pixel-chamber.worker.js", import.meta.url), { type: "module" }) : connector === "dom" ? new Worker(new URL("./dom-chamber.worker.js", import.meta.url), { type: "module" }) : connector === "helix-rum" ? new Worker(new URL("./helix-rum-chamber.worker.js", import.meta.url), { type: "module" }) : connector === "ga4-gtag" ? new Worker(new URL("./ga4-gtag-chamber.worker.js", import.meta.url), { type: "module" }) : connector === "google-ads" ? new Worker(new URL("./google-ads-chamber.worker.js", import.meta.url), { type: "module" }) : connector === "floodlight" ? new Worker(new URL("./floodlight-chamber.worker.js", import.meta.url), { type: "module" }) : new Worker(new URL("./chamber.worker.js", import.meta.url), { type: "module" });
  worker.postMessage(
    connector === "floodlight" ? { type: "init", connectorConfig: connectorConfig || {} } : connector === "pixel" || connector === "dom" || connector === "helix-rum" || connector === "ga4-gtag" || connector === "google-ads" ? { type: "init", ...connectorConfig || {} } : { type: "init", trackers, workFactor, endpoints, ctx }
  );
  worker.onmessage = (e2) => {
    const data = e2.data;
    if (data && data.type === "identity" && data.ud && typeof data.ud === "object") {
      for (const field of Object.keys(data.ud)) {
        const hex = data.ud[field];
        if (hex != null) identityCache[field] = hex;
      }
      return;
    }
    const ready = data && data.ready;
    if (ready) {
      const holdIfOffCeiling = (url) => {
        if (!ceiling.length) return false;
        const c2 = checkEndpointCeiling(url, endpoints);
        if (c2.verdict === "hold") {
          diagnose({ level: "error", kind: "endpoint-ceiling", disposition: "held", destination: c2.destination, reason: c2.reason });
          return true;
        }
        return false;
      };
      const dispatch = (req) => {
        fetch(req.url, fetchInit(req.method, req.body)).then(
          () => {
            dispatched++;
          },
          () => {
            dispatched++;
            const isPost = req.method !== "GET";
            diagnose({
              level: "warn",
              kind: "egress-failure",
              destination: originPath(req.url),
              method: isPost ? "POST" : "GET",
              ...isPost && req.body != null ? { bytes: EGRESS_TEXT_ENCODER.encode(req.body).length } : {}
            });
          }
        );
      };
      const survivors = [];
      for (const r2 of ready) {
        if (egressPurposes.length) {
          const v2 = egressVerdict(consentVector, egressPurposes, { strict: consentStrict, holdOnDenied });
          if (v2 === "drop") {
            diagnose({
              level: "warn",
              kind: "consent",
              disposition: "dropped",
              purpose: egressPurposes.join(","),
              reason: "strict regime \u2014 un-granted purpose dropped"
            });
            continue;
          }
          if (v2 === "hold") {
            const beaconId = `${inspectorTag}#${beaconSeq += 1}`;
            const canRemap = holdOnDenied && typeof remap === "function" && r2.event != null;
            if (canRemap) {
              heldBeacons.push({ event: r2.event, remap: true, beaconId, remapKey: r2.remapKey });
            } else {
              heldBeacons.push({ url: r2.url, method: r2.method, body: r2.body, beaconId });
            }
            const deniedCause = holdOnDenied && egressPurposes.some((p2) => resolveConsent(consentVector, p2) === "denied");
            const stateWord = deniedCause ? "denied" : "pending";
            let heldReason;
            if (canRemap) {
              heldReason = `purpose ${stateWord} under holdOnDenied \u2014 held at the seal; re-maps on grant`;
            } else if (holdOnDenied) {
              heldReason = `purpose ${stateWord} under holdOnDenied \u2014 held at the seal; NO re-map wired (source event or remap fn missing) \u2014 flush will RE-SEND the under-consent payload verbatim`;
            } else {
              heldReason = "purpose pending \u2014 held at the seal";
            }
            diagnose({
              level: "warn",
              kind: "consent",
              disposition: "held",
              purpose: egressPurposes.join(","),
              reason: heldReason,
              beaconId,
              destination: r2.url
            });
            continue;
          }
        }
        if (holdIfOffCeiling(r2.url)) continue;
        survivors.push(r2);
      }
      if (typeof coalesce !== "function") {
        for (const r2 of survivors) {
          dispatch(r2);
        }
      } else {
        const groups = /* @__PURE__ */ new Map();
        for (const r2 of survivors) {
          const key = originPath(r2.url);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r2);
        }
        for (const groupRequests of groups.values()) {
          const outputs = coalesce(groupRequests) || [];
          for (const out of outputs) {
            if (holdIfOffCeiling(out.url)) continue;
            dispatch(out);
          }
        }
      }
    }
    const dropped = data && data.dropped;
    if (dropped && dropped.length) {
      for (const d2 of dropped) {
        diagnose({ level: "warn", kind: "dropped", type: d2.type, reason: d2.reason, index: d2.index });
      }
    }
  };
  worker.onerror = (err) => {
    diagnose({
      level: "error",
      kind: "chamber-error",
      message: err && err.message != null ? err.message : String(err),
      ...err && err.filename != null ? { filename: err.filename } : {},
      ...err && err.lineno != null ? { lineno: err.lineno } : {}
    });
  };
  const sendBatch = (batch) => {
    if (!effectiveDenylist.length) {
      worker.postMessage({ type: "events", batch });
      return;
    }
    const governedBatch = batch.map((d2) => ({ ...d2, params: governParams(d2.params) }));
    worker.postMessage({ type: "events", batch: governedBatch });
  };
  const drain = () => {
    scheduled = false;
    if (!ring.length) return;
    const batch = ring.splice(0, 50);
    sendBatch(batch);
    if (ring.length) schedule();
  };
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestIdleCallback(drain, { timeout: 50 });
    }
  }
  const unloadFlush = () => {
    if (!ring.length) return;
    const remaining = ring.splice(0, ring.length);
    remaining.sort(
      (a2, b2) => (criticalTypes.has(b2.type) ? 1 : 0) - (criticalTypes.has(a2.type) ? 1 : 0)
    );
    for (const d2 of remaining) criticalDispatchGated({ type: d2.type, params: d2.params, ts: d2.ts });
  };
  function onVisibilityChange() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") unloadFlush();
  }
  if (typeof addEventListener === "function") {
    addEventListener("visibilitychange", onVisibilityChange);
    addEventListener("pagehide", unloadFlush);
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof removeEventListener === "function") {
      removeEventListener("visibilitychange", onVisibilityChange);
      removeEventListener("pagehide", unloadFlush);
    }
    if (worker && typeof worker.terminate === "function") worker.terminate();
  }
  return {
    /**
     * Interaction-path entry: append + fold + enqueue. O(1), no mapping.
     *
     * Accepts the PINNED contract shape `push({ event: "name", ...params })`
     * (contracts/push-api.md): the reserved `event` key is the GA4 event name,
     * every other key is a param. We normalize to the internal `{ type, params }`
     * descriptor here — the log/projection/ring/worker and the golden `mapToMp` all
     * stay on `{ type, params }`, so reconciling the surface is a one-line unpack.
     */
    push(evt) {
      const { event: type, ...params } = evt || {};
      if (typeof type !== "string" || type.length === 0) {
        console.warn("airlock: push() dropped \u2014 missing/empty `event` name", evt);
        return;
      }
      const descriptor = { seq: seq++, type, ts: performance.now(), params };
      log.push(descriptor);
      projection[type] = descriptor;
      ring.push(descriptor);
      schedule();
    },
    /**
     * Unload-critical entry (OQ10 fast path): map + send SYNCHRONOUSLY on the main
     * thread, right now, bypassing the worker. Call from an outbound-link click or
     * a `pagehide`/`beforeunload` handler for the canonical last beacon — the event
     * generated inside the unload window that the async worker path would lose.
     * Steady-state events MUST use `push()`; this path is INP-unsafe by design and
     * only justified when the page is going away.
     */
    pushCritical(evt) {
      const { event: type, ...params } = evt || {};
      if (typeof type !== "string" || type.length === 0) {
        console.warn("airlock: pushCritical() dropped \u2014 missing/empty `event` name", evt);
        return;
      }
      criticalDispatchGated({ type, params, ts: performance.now() });
    },
    /**
     * 017-03 AC2 (ADR-0007 point ③ — THIS slice's own main-thread
     * consent-update path; NOT 017-01's deferred worker `ctx` re-send, which
     * governs only the mapper reshape ① and stays deferred). Merges `vector`
     * into the mutable main-thread consent state. On a hold→send edge for a
     * HELD egress purpose (now granted), the buffered beacons are FLUSHED:
     *   - a 017-03 RE-SEND item re-`fetch`es its already-mapped `{ url, body }`
     *     verbatim (no worker, no re-map) — so it still carries its BOOT-TIME
     *     mapper reshape (a named residual — docs/refinement-todo.md);
     *   - a 045-01 RE-MAP item (a `holdOnDenied` hold with `remap` wired) is
     *     REBUILT from its source event under the NOW-CURRENT consent/ctx
     *     (fresh `auid`, granted `gcs`/`npa`) via the connector's `remap`, then
     *     fired — resolving the stale-payload residual for the seal path
     *     (ADR-0023's load-bearing correction: a re-sent under-denial beacon
     *     would be an unattributable "user-declined" ping, the exact non-parity
     *     hold-until-granted exists to prevent).
     * A re-mapped URL is re-checked against the host-owned endpoint ceiling
     * before egress (a connector cannot widen its declared ceiling via the flush
     * path); a re-map that declines (produces no beacon) emits a terminal
     * `dropped` record so the held→flushed chain is never silently broken.
     * A still-un-granted purpose's beacons stay held.
     * @param {Record<string, string>} vector a partial consent-vector update
     *   (core/consent.js's shape), merged over the existing state.
     */
    setConsent(vector) {
      consentVector = { ...consentVector, ...vector || {} };
      if (egressPurposes.length && heldBeacons.length && egressVerdict(consentVector, egressPurposes, { strict: consentStrict, holdOnDenied }) === "send") {
        const flushing = heldBeacons.splice(0, heldBeacons.length);
        for (const b2 of flushing) {
          const req = b2.remap ? b2.remapKey !== void 0 ? remap(b2.event, consentVector, b2.remapKey) : remap(b2.event, consentVector) : { url: b2.url, method: b2.method, body: b2.body };
          if (!req || req.url == null) {
            diagnose({
              level: "warn",
              kind: "consent",
              disposition: "dropped",
              purpose: egressPurposes.join(","),
              reason: "purpose granted \u2014 re-map declined (produced no beacon); held beacon discarded",
              beaconId: b2.beaconId
            });
            continue;
          }
          if (b2.remap && ceiling.length) {
            const c2 = checkEndpointCeiling(req.url, endpoints);
            if (c2.verdict === "hold") {
              diagnose({
                level: "error",
                kind: "endpoint-ceiling",
                disposition: "held",
                destination: c2.destination,
                reason: c2.reason,
                beaconId: b2.beaconId
              });
              continue;
            }
          }
          fetch(req.url, fetchInit(req.method, req.body)).then(() => {
            dispatched++;
          }, () => {
            dispatched++;
          });
          diagnose({
            level: "warn",
            kind: "consent",
            disposition: "flushed",
            purpose: egressPurposes.join(","),
            // A verbatim RE-SEND on an OPTED-IN instance (no re-map wired) flags
            // the footgun (arch review): the flushed payload was mapped under
            // denial and may be stale/non-parity for a consent-dependent beacon.
            reason: b2.remap ? "purpose granted \u2014 held beacon re-mapped + flushed" : holdOnDenied ? "purpose granted \u2014 held beacon flushed VERBATIM (no re-map wired \u2014 a consent-dependent payload may be stale/non-parity)" : "purpose granted \u2014 held beacon flushed",
            beaconId: b2.beaconId,
            // 028-02: same id as this beacon's `held` record → the held→flushed chain
            destination: req.url
          });
        }
      }
    },
    /**
     * 026-04 (ADR-0022): feed raw advanced-matching identity to the pixel
     * chamber on the DEDICATED `identity` channel — `{ em, ph, fn, … }` set once
     * the visitor is identified (`external_id` rides the boot `init` message
     * instead). This posts the raw values straight to the worker, BYPASSING the
     * input `governParams`/`payloadDenylist` (which would strip email/phone
     * before they could be hashed) — safe because the worker is egress-confined
     * (A5): it eager-normalizes + SHA-256-hashes each field and posts back ONLY
     * the hash (cached above for the unload merge). The raw value is not retained
     * on the main thread. A no-op for a non-pixel worker (its chamber ignores the
     * `identity` message type).
     * @param {Record<string, string>} raw the raw PII fields to hash (em/ph/…).
     */
    setIdentity(raw) {
      worker.postMessage({ type: "identity", raw });
    },
    /**
     * Synchronous read (AD-3): no argument → the whole projection; a dotted path
     * (`getState("a.b.c")`, contracts/push-api.md) → the value at that path in the
     * projection, `undefined` if any hop is absent. Never throws on a missing path.
     */
    getState(path) {
      if (path == null) return projection;
      let cur = projection;
      for (const key of String(path).split(".")) {
        if (cur == null) return void 0;
        cur = cur[key];
      }
      return cur;
    },
    flushNow() {
      while (ring.length) sendBatch(ring.splice(0, 50));
    },
    stats() {
      return { dispatched, logged: log.length, ...critical.stats() };
    },
    /**
     * 021-01 AC1 (OQ12 item 4): tear this instance down — removes the
     * visibilitychange/pagehide listeners and terminates the Worker. Idempotent
     * (a second call is a no-op) and null-safe (no addEventListener/Worker.terminate
     * -> skipped, never throws). See the `dispose` closure above for the guard.
     */
    dispose,
    // spec 025-03 AC6: expose the raw `worker` ONLY for connector:"dom" —
    // GA4/pixel stay byte-unchanged (no `worker` key at all — this handle's
    // shape for those two connectors is unaffected). A dom-chamber tag's
    // protocol (main->worker event-forward, worker->main mutation-flush,
    // `core/worker-dom/protocol.js`) is architecturally DIFFERENT from GA4/
    // pixel's ready/dropped egress protocol this handle's `push`/
    // `pushCritical`/`worker.onmessage` machinery is built for — a dom-tag
    // adapter (a `bootWorkerDomTag`-style boot, or a rig) drives that
    // DIFFERENT protocol directly against the SAME underlying worker this
    // seam already constructed + initialized, rather than this module
    // growing a second, unrelated dispatch shape it would otherwise need to
    // understand. Freely reassigning `worker.onmessage` is expected (this
    // module's OWN ready/dropped handler is a harmless no-op for the
    // `{type:"mutations"}` shape the dom chamber posts).
    ...connector === "dom" ? { worker } : {}
  };
}

// core/config-integrity.js
function outboundTenants(url, tenantKey) {
  try {
    return new URL(url, "https://airlock.local").searchParams.getAll(tenantKey);
  } catch {
    return [];
  }
}
function hostOf(url) {
  try {
    return new URL(url, "https://airlock.local").host;
  } catch {
    return null;
  }
}
function schemeOf(url) {
  try {
    return new URL(url, "https://airlock.local").protocol;
  } catch {
    return null;
  }
}
var DEFAULT_PINNED_SCHEME = "https:";
function normalizeScheme(scheme) {
  if (!scheme) return null;
  const s2 = String(scheme).toLowerCase();
  return s2.endsWith(":") ? s2 : `${s2}:`;
}
function checkConfigIntegrity(url, pin) {
  const { pinnedHost, tenantKey, pinnedTenant, pinnedScheme } = pin || {};
  if (!pinnedHost || !tenantKey || !pinnedTenant) {
    return {
      verdict: "hold",
      host: hostOf(url),
      outboundTenants: outboundTenants(url, tenantKey),
      reason: "config-integrity: incomplete pin (misconfiguration)"
    };
  }
  const host = hostOf(url);
  if (host !== pinnedHost) {
    return {
      verdict: "hold",
      host,
      outboundTenants: outboundTenants(url, tenantKey),
      reason: "config-integrity: outbound host != pinned host (foreign-host egress)"
    };
  }
  const expectedScheme = normalizeScheme(pinnedScheme) || DEFAULT_PINNED_SCHEME;
  if (schemeOf(url) !== expectedScheme) {
    return {
      verdict: "hold",
      host,
      outboundTenants: outboundTenants(url, tenantKey),
      reason: "config-integrity: outbound scheme != pinned scheme (transport downgrade)"
    };
  }
  const tenants = outboundTenants(url, tenantKey);
  if (tenants.length === 0) {
    return { verdict: "hold", host, outboundTenants: tenants, reason: `config-integrity: no ${tenantKey} on the interact` };
  }
  if (tenants.length > 1) {
    return { verdict: "hold", host, outboundTenants: tenants, reason: `config-integrity: multiple ${tenantKey} params (parameter pollution)` };
  }
  if (tenants[0] !== pinnedTenant) {
    return { verdict: "hold", host, outboundTenants: tenants, reason: `config-integrity: outbound ${tenantKey} != host-pinned tenant (same-host tenant re-route)` };
  }
  return { verdict: "allow", host, outboundTenants: tenants, reason: "ok" };
}
function pinnedDispatchUrl(url, pin) {
  const u2 = new URL(url, "https://airlock.local");
  u2.protocol = normalizeScheme(pin.pinnedScheme) || DEFAULT_PINNED_SCHEME;
  u2.host = pin.pinnedHost;
  u2.searchParams.delete(pin.tenantKey);
  u2.searchParams.set(pin.tenantKey, pin.pinnedTenant);
  return u2.toString();
}

// core/cookie-scope.js
var COOKIE_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function isValidCookieName(name) {
  return typeof name === "string" && COOKIE_NAME_TOKEN.test(name);
}
function matchesGrantedName(name, grantedNames) {
  if (typeof name !== "string" || !Array.isArray(grantedNames)) return false;
  return grantedNames.some((entry) => typeof entry === "string" && (entry.endsWith("_") ? name.startsWith(entry) : name === entry));
}
function scopeSeedCookies(jar, grantedNames) {
  if (typeof jar !== "string" || !jar.trim()) return "";
  return jar.split(";").map((pair) => pair.trim()).filter((pair) => pair.includes("=")).filter((pair) => matchesGrantedName(pair.slice(0, pair.indexOf("=")).trim(), grantedNames)).join("; ");
}

// core/wrapped-sdk-host.js
function consoleDiagnostic2(record) {
  const fn = record.level === "error" ? console.error : console.warn;
  fn("airlock:", record);
}
function createWrappedSdkHost({
  chamber,
  caps,
  timeoutMs = 5e3,
  configIntegrity = null,
  endpointCeiling = null,
  consent = null,
  egressPurposes = [],
  payloadDenylist = null,
  grantedCookieNames = null,
  onDiagnostic
}) {
  const diagnose = typeof onDiagnostic === "function" ? onDiagnostic : consoleDiagnostic2;
  const inspectorTag = (Math.random().toString(36).slice(2) + "000000").slice(0, 6);
  if (consent && !egressPurposes.length) {
    diagnose({
      level: "warn",
      kind: "consent",
      disposition: "not-enforced",
      reason: "consent vector wired without egressPurposes \u2014 the TRUSTED seam-side drop is OFF; only the in-chamber setConsent delegate is active"
    });
  }
  const state = {
    phases: [],
    writeBacks: [],
    mainDispatch: { count: 0, requests: [] },
    summary: null,
    ready: [],
    fatal: null,
    held: 0,
    overridden: 0,
    ceilingHeld: 0,
    consentHeld: 0,
    cookieScopeHeld: 0
  };
  let queuedEvent = null;
  let onResult = null;
  let configured = false;
  function dispatchInterceptedFetch(m2) {
    if (endpointCeiling) {
      const c2 = checkEndpointCeiling(m2.url, endpointCeiling);
      if (c2.verdict === "hold") {
        state.ceilingHeld += 1;
        diagnose({ level: "error", kind: "endpoint-ceiling", disposition: "held", destination: c2.destination, reason: c2.reason, beaconId: `${inspectorTag}#${m2.id}` });
        chamber.postMessage({ type: "intercepted-fetch-response", id: m2.id, status: 0, statusText: "held at the seal: endpoint-ceiling", body: "" });
        return;
      }
    }
    const runConfigIntegrity = configIntegrity && (!endpointCeiling || hostOf(m2.url) === configIntegrity.pinnedHost);
    if (runConfigIntegrity) {
      const check = checkConfigIntegrity(m2.url, configIntegrity);
      if (check.verdict === "hold") {
        const pinComplete = !!(configIntegrity.pinnedHost && configIntegrity.tenantKey && configIntegrity.pinnedTenant);
        if (configIntegrity.disposition === "override" && pinComplete) {
          state.overridden += 1;
          diagnose({ level: "error", kind: "config-integrity", disposition: "overridden", reason: check.reason, beaconId: `${inspectorTag}#${m2.id}`, destination: hostOf(m2.url) });
          m2 = { ...m2, url: pinnedDispatchUrl(m2.url, configIntegrity) };
        } else {
          state.held += 1;
          diagnose({ level: "error", kind: "config-integrity", disposition: "held", reason: check.reason, beaconId: `${inspectorTag}#${m2.id}`, destination: hostOf(m2.url) });
          chamber.postMessage({ type: "intercepted-fetch-response", id: m2.id, status: 0, statusText: "held at the seal: config-integrity", body: "" });
          return;
        }
      }
    } else if (endpointCeiling && configIntegrity && hostOf(m2.url) !== configIntegrity.pinnedHost) {
      diagnose({
        level: "warn",
        kind: "config-integrity",
        disposition: "unpinned-declared-origin",
        reason: "config-integrity: declared origin is not the tenant-pinned host \u2014 tenant NOT checked here (multi-tenant-pin follow-up)"
      });
    }
    if (egressPurposes.length) {
      const splitPersonalization = egressPurposes.includes("personalization") && resolveConsent(consent, "personalization") !== "granted" && egressPurposes.some((p2) => p2 !== "personalization");
      const effectivePurposes = splitPersonalization ? egressPurposes.filter((p2) => p2 !== "personalization") : egressPurposes;
      const verdict = egressVerdict(consent, effectivePurposes, { strict: true });
      if (verdict !== "send") {
        state.consentHeld += 1;
        diagnose({
          level: "warn",
          kind: "consent",
          disposition: "held",
          purpose: egressPurposes.join(","),
          reason: "un-granted governing purpose \u2014 alloy interact held at the seal",
          beaconId: `${inspectorTag}#${m2.id}`,
          destination: hostOf(m2.url)
        });
        chamber.postMessage({ type: "intercepted-fetch-response", id: m2.id, status: 0, statusText: "held at the seal: consent", body: "" });
        return;
      }
      if (splitPersonalization && m2.body) {
        const strippedBody = stripInterceptedPersonalizationQuery(
          m2.body,
          () => diagnose({
            level: "warn",
            kind: "consent",
            disposition: "personalization-stripped",
            purpose: "personalization",
            reason: "personalization un-granted \u2014 per-event query stripped; analytics-only interact dispatched",
            beaconId: `${inspectorTag}#${m2.id}`,
            destination: hostOf(m2.url)
          })
        );
        if (strippedBody !== m2.body) m2 = { ...m2, body: strippedBody };
      }
    }
    if (payloadDenylist && payloadDenylist.length && m2.body) {
      const strippedBody = stripInterceptedXdmBody(
        m2.body,
        payloadDenylist,
        (field) => diagnose({ level: "warn", kind: "payload-governance", disposition: "stripped", field }),
        (reason) => diagnose({ level: "error", kind: "payload-governance", disposition: "skipped", reason })
      );
      if (strippedBody !== m2.body) m2 = { ...m2, body: strippedBody };
    }
    state.mainDispatch.count += 1;
    state.mainDispatch.requests.push({ url: m2.url, method: m2.method, body: m2.body });
    let settled = false;
    const respond = (payload) => {
      if (settled) return;
      settled = true;
      chamber.postMessage({ type: "intercepted-fetch-response", id: m2.id, ...payload });
    };
    const timer = setTimeout(() => {
      respond({
        status: 0,
        statusText: `intercepted-fetch timed out after ${timeoutMs}ms (no main-thread response)`,
        body: ""
      });
    }, timeoutMs);
    Promise.resolve().then(() => caps.egress.dispatch({ url: m2.url, method: m2.method, headers: m2.headers, body: m2.body })).then((res) => {
      clearTimeout(timer);
      respond({
        status: res && res.status || 0,
        statusText: res && res.statusText || "",
        headers: res && res.headers || { "content-type": "application/json" },
        body: res && res.body != null ? res.body : ""
      });
    }).catch((err) => {
      clearTimeout(timer);
      respond({ status: 0, statusText: String(err && err.message || err), body: "" });
    });
  }
  function handleMessage(raw) {
    const m2 = raw || {};
    if (m2.type === "phase") {
      state.phases.push(m2.name);
      if (m2.name === "configured") {
        configured = true;
        if (queuedEvent) {
          const event = queuedEvent;
          queuedEvent = null;
          chamber.postMessage({ type: "event", event });
        }
      }
    } else if (m2.type === "intercepted-fetch") {
      dispatchInterceptedFetch(m2);
    } else if (m2.type === "decisions") {
      if (caps.decisions && typeof caps.decisions.deliver === "function") {
        try {
          caps.decisions.deliver(m2.decisions);
        } catch (e2) {
        }
      }
    } else if (m2.type === "cookie-writeback") {
      state.writeBacks.push(m2.value);
      const cookieName = String(m2.value).split("=")[0].trim();
      const invalidName = grantedCookieNames && !isValidCookieName(cookieName);
      const ungranted = grantedCookieNames && !invalidName && !matchesGrantedName(cookieName, grantedCookieNames);
      if (invalidName || ungranted) {
        state.cookieScopeHeld += 1;
        diagnose({
          level: "error",
          kind: "cookie-scope",
          disposition: "dropped",
          reason: invalidName ? "invalid cookie-name token \u2014 write-back dropped at the seal" : "un-granted cookie name \u2014 write-back dropped at the seal",
          name: cookieName
        });
      } else {
        const reconciled = reconcileForBrokerJar(m2.value);
        if (caps.cookies && typeof caps.cookies.reconcile === "function") {
          try {
            caps.cookies.reconcile(reconciled);
          } catch (e2) {
          }
        }
      }
    } else if (m2.type === "result") {
      state.summary = m2.summary;
      state.ready = m2.ready || [];
      if (onResult) {
        const { resolve } = onResult;
        onResult = null;
        resolve({ summary: m2.summary, ready: m2.ready || [] });
      }
    } else if (m2.type === "fatal") {
      state.fatal = m2;
      if (onResult) {
        const { reject } = onResult;
        onResult = null;
        reject(Object.assign(new Error(m2.message || "chamber fatal"), { detail: m2 }));
      }
    }
  }
  chamber.onMessage(handleMessage);
  return {
    /** Boot the chamber: posts `{ type: "init", ...initMsg }`. */
    init(initMsg) {
      chamber.postMessage({ type: "init", ...initMsg || {} });
    },
    /**
     * Drive one page event through the chamber, and settle when the chamber
     * reports back — resolves `{ summary, ready }` on `result`, rejects on
     * `fatal`. Single-slot: exactly one event may be in flight at a time
     * (re-entry is rejected), but — unlike 014-01 — the host may be driven
     * REPEATEDLY once configured (033-02 AC2). Before the chamber reports
     * `phase:"configured"`, the event is QUEUED and sent on that message (the
     * unchanged 014-01 boot flow); AFTER configured, the chamber is already
     * live, so the event is posted IMMEDIATELY. The adapter (bootAlloy)
     * serializes its `push`/`pushCritical` through this call so the re-entry
     * guard is never tripped — one page event per host round-trip, N in
     * sequence.
     */
    driveEvent(event) {
      return new Promise((resolve, reject) => {
        if (onResult) {
          reject(new Error("driveEvent already in flight \u2014 call once, after init()"));
          return;
        }
        onResult = { resolve, reject };
        if (configured) {
          chamber.postMessage({ type: "event", event });
        } else {
          queuedEvent = event;
        }
      });
    },
    /**
     * Post a mid-session consent update to the chamber (spec 045-02, ADR-0023).
     * ADDITIVE — the chamber's alloy-boot glue drives alloy's OWN `setConsent`
     * on this message, which natively FLUSHES alloy's `defaultConsent:"pending"`
     * queue (grounded: rig/alloy-consent-pending.mjs). This does NOT touch the
     * TRUSTED seam enforcement (the strict `egressVerdict` + the 034-01 strip in
     * `dispatchInterceptedFetch`), which reads the caller's LIVE `consent` ref
     * and stays the byte-unchanged backstop — the adapter (bootAlloy) mutates
     * that ref separately, so a flushed interact is still gated by the seam.
     * @param {Record<string, string>|null} vector the ADR-0007 consent vector.
     */
    setConsent(vector) {
      chamber.postMessage({ type: "setConsent", consent: vector });
    },
    /** A snapshot of everything observed so far (for rig/test assertions). */
    getState() {
      return {
        phases: state.phases.slice(),
        writeBacks: state.writeBacks.slice(),
        mainDispatch: { count: state.mainDispatch.count, requests: state.mainDispatch.requests.slice() },
        summary: state.summary,
        ready: state.ready.slice(),
        fatal: state.fatal,
        held: state.held,
        overridden: state.overridden,
        ceilingHeld: state.ceilingHeld,
        consentHeld: state.consentHeld,
        cookieScopeHeld: state.cookieScopeHeld
      };
    }
  };
}
function reconcileForBrokerJar(raw) {
  return String(raw).split(";").map((s2) => s2.trim()).filter((seg) => {
    const s2 = seg.toLowerCase();
    return !s2.startsWith("domain=") && s2 !== "secure" && !s2.startsWith("samesite=");
  }).join("; ");
}
function stripInterceptedXdmBody(rawBody, denylist, onStripped, onError) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e2) {
    return rawBody;
  }
  if (!parsed || !Array.isArray(parsed.events)) return rawBody;
  let changed = false;
  const events = parsed.events.map((evt) => {
    if (!evt || typeof evt !== "object" || evt.xdm == null || typeof evt.xdm !== "object") return evt;
    const { governed, stripped, error } = governPayload(evt.xdm, denylist);
    if (error && typeof onError === "function") onError("govern-failed");
    if (!stripped.length) return evt;
    changed = true;
    for (const field of stripped) {
      if (typeof onStripped === "function") onStripped(field);
    }
    return { ...evt, xdm: governed };
  });
  return changed ? JSON.stringify({ ...parsed, events }) : rawBody;
}
function stripInterceptedPersonalizationQuery(rawBody, onStripped) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e2) {
    return rawBody;
  }
  if (!parsed || !Array.isArray(parsed.events)) return rawBody;
  let changed = false;
  const events = parsed.events.map((evt) => {
    if (!evt || typeof evt !== "object" || evt.query == null || typeof evt.query !== "object") return evt;
    if (!Object.prototype.hasOwnProperty.call(evt.query, "personalization")) return evt;
    changed = true;
    if (typeof onStripped === "function") onStripped();
    const nextQuery = { ...evt.query };
    delete nextQuery.personalization;
    if (Object.keys(nextQuery).length === 0) {
      const nextEvt = { ...evt };
      delete nextEvt.query;
      return nextEvt;
    }
    return { ...evt, query: nextQuery };
  });
  return changed ? JSON.stringify({ ...parsed, events }) : rawBody;
}

// drivers/consent/onetrust.js
var CONSENT_MODE_V2_PURPOSES = ["analytics_storage", "ad_storage", "ad_user_data", "ad_personalization"];
var ERP_INTUIT_GROUP_PURPOSE_MAP = Object.freeze({
  4: ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]
});
function parseActiveGroups(activeGroups) {
  if (typeof activeGroups !== "string" || !activeGroups.includes(",")) {
    return { resolved: false, granted: /* @__PURE__ */ new Set() };
  }
  const granted = /* @__PURE__ */ new Set();
  for (const part of activeGroups.split(",")) {
    const id = part.trim();
    if (id) granted.add(id);
  }
  return { resolved: granted.size > 0, granted };
}
function coverageByPurpose(groupPurposeMap) {
  const coverage = /* @__PURE__ */ new Map();
  if (!groupPurposeMap || typeof groupPurposeMap !== "object") return coverage;
  for (const [groupId, purposes] of Object.entries(groupPurposeMap)) {
    if (!Array.isArray(purposes)) continue;
    for (const raw of purposes) {
      if (typeof raw !== "string") continue;
      const purpose = raw.toLowerCase();
      if (!CONSENT_MODE_V2_PURPOSES.includes(purpose)) continue;
      const groups = coverage.get(purpose) ?? [];
      groups.push(String(groupId));
      coverage.set(purpose, groups);
    }
  }
  return coverage;
}
function mapOnetrustConsent(activeGroups, groupPurposeMap) {
  const { resolved, granted } = parseActiveGroups(activeGroups);
  const vector = {};
  if (!resolved) return vector;
  const coverage = coverageByPurpose(groupPurposeMap);
  for (const purpose of CONSENT_MODE_V2_PURPOSES) {
    const groups = coverage.get(purpose);
    if (!groups || groups.length === 0) continue;
    vector[purpose] = groups.some((groupId) => granted.has(groupId)) ? "granted" : "denied";
  }
  return vector;
}
function readOnetrustActiveGroups(win) {
  if (!win || typeof win !== "object") return null;
  const value = win.OnetrustActiveGroups;
  return typeof value === "string" ? value : null;
}
function resolveOnetrustBootConsent({ groupPurposeMap, activeGroups, read = readOnetrustActiveGroups, win } = {}) {
  const source = activeGroups !== void 0 ? activeGroups : read(win);
  return mapOnetrustConsent(source, groupPurposeMap);
}
function subscribeOnetrustConsentChanges({
  onetrust,
  win,
  groupPurposeMap,
  read = readOnetrustActiveGroups,
  onChange
} = {}) {
  if (typeof onChange !== "function") return () => {
  };
  const handleChange = () => onChange(mapOnetrustConsent(read(win), groupPurposeMap));
  const teardowns = [];
  if (onetrust && typeof onetrust === "object" && typeof onetrust.OnConsentChanged === "function") {
    if (!onetrust.__onetrustConsentChangeWired) {
      onetrust.__onetrustConsentChangeWired = true;
      onetrust.OnConsentChanged(() => {
        const active = onetrust.__onetrustActiveHandler;
        if (active) active();
      });
    }
    onetrust.__onetrustActiveHandler = handleChange;
    teardowns.push(() => {
      if (onetrust.__onetrustActiveHandler === handleChange) onetrust.__onetrustActiveHandler = null;
    });
  }
  if (win && typeof win === "object") {
    if (!win.__onetrustOptanonWrapperWired) {
      win.__onetrustOptanonWrapperWired = true;
      const priorWrapper = typeof win.OptanonWrapper === "function" ? win.OptanonWrapper : null;
      win.OptanonWrapper = function onetrustConsentChangeWrapper(...args) {
        if (priorWrapper) priorWrapper.apply(this, args);
        const active = win.__onetrustActiveHandler;
        if (active) active();
      };
    }
    win.__onetrustActiveHandler = handleChange;
    teardowns.push(() => {
      if (win.__onetrustActiveHandler === handleChange) win.__onetrustActiveHandler = null;
    });
  }
  return () => {
    for (const teardown of teardowns) teardown();
  };
}

// connectors/alloy/decisions.js
var VIEW_SCOPE = "__view__";
var HTML_CONTENT_ITEM_SCHEMA = "https://ns.adobe.com/personalization/html-content-item";
function contentOf(x2) {
  return x2 && x2.content && typeof x2.content === "object" ? x2.content : x2;
}
function htmlOfDecision(decision) {
  const proposition = contentOf(decision);
  const items = proposition && Array.isArray(proposition.items) ? proposition.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const data = item.data;
    const isHtml = item.schema === HTML_CONTENT_ITEM_SCHEMA || data && typeof data.content === "string" && /^text\/html/.test(String(data.format || ""));
    if (isHtml && data && typeof data.content === "string") return data.content;
  }
  return null;
}

// connectors/alloy/connector.js
var ALLOY_INTERACT_ENDPOINT = "https://adobedc.demdex.net/ee/v1/interact";
var ALLOY_COOKIE_NAMES = ["com.adobe.alloy.getTld", "kndctr_", "AMCV_", "demdex", "s_ecid"];
var ALLOY_EVENTS = Object.freeze(["page_view"]);
var ALLOY_EGRESS_PURPOSES = Object.freeze(["analytics_storage", "personalization"]);

// connectors/ga4/connector.js
var GA4_EVENTS = Object.freeze(["*"]);
var GA4_EGRESS_PURPOSES = Object.freeze(["analytics_storage"]);

// adapters/eds/decisions-exposure.js
var PROPOSITION_EXPOSURE_EVENT = "proposition_display";
function propositionOf(x2) {
  if (x2 && typeof x2 === "object" && x2.content && typeof x2.content === "object" && ("scope" in x2.content || "id" in x2.content)) {
    return contentOf(x2);
  }
  return x2;
}
function mapPropositionToExposure(decisionOrProposition) {
  const p2 = propositionOf(decisionOrProposition);
  if (!p2 || typeof p2 !== "object") return null;
  const scope = p2.scope;
  const propositionId = p2.id;
  if (!scope || !propositionId) return null;
  const sd = p2.scopeDetails || {};
  const activityId = sd.activity && sd.activity.id;
  const experienceId = sd.experience && sd.experience.id;
  return {
    event: PROPOSITION_EXPOSURE_EVENT,
    proposition_id: propositionId,
    scope,
    ...activityId ? { activity_id: activityId } : {},
    ...experienceId ? { experience_id: experienceId } : {}
  };
}
function createPropositionExposureReporter(handle, { seen = /* @__PURE__ */ new Set() } = {}) {
  const report = (decisionOrProposition) => {
    const evt = mapPropositionToExposure(decisionOrProposition);
    if (!evt) return;
    const key = evt.scope + ":" + evt.proposition_id;
    if (seen.has(key)) return;
    seen.add(key);
    handle.push(evt);
  };
  return {
    report,
    reportAll(decisions) {
      for (const d2 of decisions || []) report(d2);
    }
  };
}

// adapters/eds/placements.js
function firstDuplicateScope(items) {
  const seen = /* @__PURE__ */ new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const scope = it && typeof it.scope === "string" ? it.scope : null;
    if (scope == null) continue;
    if (seen.has(scope)) return scope;
    seen.add(scope);
  }
  return null;
}

// connectors/ga4/cookies.js
var DIGITS2 = /^\d+$/;
var GA_COOKIE_MAX_AGE_S = 63072e3;
function parseGaClientId(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(".");
  if (parts.length < 2) return null;
  const random = parts[parts.length - 2];
  const seconds = parts[parts.length - 1];
  if (!DIGITS2.test(random) || !DIGITS2.test(seconds)) return null;
  return `${random}.${seconds}`;
}
function parseGaSessionId(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(".");
  if (parts.length < 3) return null;
  const field = parts[2];
  if (field.includes("$") || field.startsWith("s")) {
    for (const f2 of field.split("$")) {
      const m2 = /^s(\d+)$/.exec(f2);
      if (m2) return m2[1];
    }
    return null;
  }
  return DIGITS2.test(field) ? field : null;
}
function findGaStreamCookie(cookieString) {
  if (typeof cookieString !== "string" || cookieString.length === 0) return null;
  for (const pair of cookieString.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (name.startsWith("_ga_") && name.length > 4) {
      const raw = pair.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}
function formatGaCookieValue(clientId) {
  return `GA1.1.${clientId}`;
}
async function sourceGa4Ctx({
  cookies,
  cookieString = "",
  now = Date.now,
  random = Math.random,
  storageGranted = true
}) {
  const bootSeconds = Math.floor(now() / 1e3);
  const mintEphemeralClientId = () => `${String(1e9 + Math.floor(random() * 9e9))}.${bootSeconds}`;
  if (!storageGranted) {
    return { clientId: mintEphemeralClientId(), sessionId: String(bootSeconds) };
  }
  const rawGa = await cookies.get("_ga");
  let clientId = parseGaClientId(rawGa);
  if (clientId === null) {
    clientId = mintEphemeralClientId();
    if (rawGa == null) {
      await cookies.set("_ga", formatGaCookieValue(clientId), {
        maxAge: GA_COOKIE_MAX_AGE_S,
        path: "/",
        sameSite: "lax"
      });
    }
  }
  const sessionId = parseGaSessionId(findGaStreamCookie(cookieString)) ?? String(bootSeconds);
  return { clientId, sessionId };
}
var DEFAULT_GA_SESSION_TIMEOUT_MINUTES = 30;
var GS2_TAIL_DEFAULT = ["j60", "l0", "h0"];
function parseGa4SessionState(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(".");
  if (parts[0] !== "GS2" || parts.length < 3) return null;
  const known = {};
  const tail = [];
  for (const f2 of parts[2].split("$")) {
    const s2 = /^s(\d+)$/.exec(f2);
    if (s2 && known.sid === void 0) {
      known.sid = s2[1];
      continue;
    }
    const o2 = /^o(\d+)$/.exec(f2);
    if (o2 && known.sct === void 0) {
      known.sct = o2[1];
      continue;
    }
    const g2 = /^g(\d+)$/.exec(f2);
    if (g2 && known.engaged === void 0) {
      known.engaged = g2[1];
      continue;
    }
    const t2 = /^t(\d+)$/.exec(f2);
    if (t2 && known.lastHit === void 0) {
      known.lastHit = t2[1];
      continue;
    }
    tail.push(f2);
  }
  if (known.sid === void 0 || known.sct === void 0 || known.engaged === void 0 || known.lastHit === void 0) {
    return null;
  }
  return { sid: known.sid, sct: known.sct, engaged: known.engaged, lastHit: known.lastHit, tail };
}
function formatGa4SessionCookieValue({ sid, sct, engaged, lastHit, tail }) {
  const suffix = (tail || []).map((f2) => `$${f2}`).join("");
  return `GS2.1.s${sid}$o${sct}$g${engaged}$t${lastHit}${suffix}`;
}
async function writeGa4SessionState({
  cookies,
  streamCookieName,
  now = Date.now,
  sessionTimeoutMinutes = DEFAULT_GA_SESSION_TIMEOUT_MINUTES,
  storageGranted = true
}) {
  if (!storageGranted) {
    return null;
  }
  const nowSeconds = Math.floor(now() / 1e3);
  const existing = parseGa4SessionState(await cookies.get(streamCookieName));
  let next;
  let beacon;
  if (existing === null) {
    const sid = String(nowSeconds);
    next = { sid, sct: "1", engaged: "0", lastHit: sid, tail: [...GS2_TAIL_DEFAULT] };
    beacon = { sessionId: sid, sct: "1", seg: "0", _fv: "1", _ss: "1", _nsi: "1" };
  } else {
    const timeoutSeconds = sessionTimeoutMinutes * 60;
    const gapSeconds = nowSeconds - Number(existing.lastHit);
    if (gapSeconds > timeoutSeconds) {
      const sid = String(nowSeconds);
      const sct = String(Number(existing.sct) + 1);
      next = { sid, sct, engaged: "0", lastHit: sid, tail: existing.tail };
      beacon = { sessionId: sid, sct, seg: "0", _ss: "1", _nsi: "1" };
    } else {
      next = { sid: existing.sid, sct: existing.sct, engaged: "1", lastHit: String(nowSeconds), tail: existing.tail };
      beacon = { sessionId: existing.sid, sct: existing.sct, seg: "1" };
    }
  }
  await cookies.set(streamCookieName, formatGa4SessionCookieValue(next), {
    maxAge: GA_COOKIE_MAX_AGE_S,
    path: "/",
    sameSite: "lax"
  });
  return beacon;
}

// connectors/ga4/consent.js
var DATA_USE_PURPOSES = ["ad_user_data", "ad_personalization"];
var MP_VALUE = { granted: "GRANTED", denied: "DENIED" };
function shapeMpConsent(vector) {
  const consent = {};
  for (const purpose of DATA_USE_PURPOSES) {
    const state = resolveConsent(vector, purpose);
    if (state === "pending") continue;
    consent[purpose] = MP_VALUE[state];
  }
  return Object.keys(consent).length > 0 ? consent : void 0;
}

// connectors/ga4/coalesce.js
var GA4_BATCH_MAX_BYTES = 6e4;
var GA4_BATCH_MAX_EVENTS = 25;
function classifyKey(key) {
  if (key === "en" || key === "_et" || key.startsWith("ep.") || key.startsWith("epn.")) {
    return "per-event";
  }
  return "shared";
}
function splitUrl(url) {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return { base: url, query: "" };
  return { base: url.slice(0, qIndex), query: url.slice(qIndex + 1) };
}
function parseParamPairs(query) {
  if (!query) return [];
  return query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    return { key: decodeURIComponent(rawKey), pair };
  });
}
function parseRequest(request) {
  const { base, query } = splitUrl(request.url);
  const pairs = parseParamPairs(query);
  const sharedPairs = pairs.filter((p2) => classifyKey(p2.key) === "shared");
  const perEventPairs = pairs.filter((p2) => classifyKey(p2.key) === "per-event");
  const sharedSignature = sharedPairs.map((p2) => p2.pair).sort().join("&");
  return { original: request, base, sharedPairs, perEventPairs, sharedSignature };
}
function buildBodyLine(perEventPairs) {
  const enPair = perEventPairs.find((p2) => p2.key === "en");
  const etPair = perEventPairs.find((p2) => p2.key === "_et");
  const customPairs = perEventPairs.filter((p2) => p2 !== enPair && p2 !== etPair);
  const parts = [];
  if (enPair) parts.push(enPair.pair);
  parts.push("_ee=1");
  for (const p2 of customPairs) parts.push(p2.pair);
  if (etPair) parts.push(etPair.pair);
  return parts.join("&");
}
function buildBatchPost(items) {
  const { base, sharedPairs } = items[0];
  const url = sharedPairs.length ? `${base}?${sharedPairs.map((p2) => p2.pair).join("&")}` : base;
  const body = items.map((item) => buildBodyLine(item.perEventPairs)).join("\r\n");
  return { url, method: "POST", body };
}
function byteLength(str) {
  return new TextEncoder().encode(str).length;
}
function splitIntoPostGroups(items) {
  const groups = [];
  let current = [];
  let currentLines = [];
  for (const item of items) {
    const line = buildBodyLine(item.perEventPairs);
    const candidateLines = [...currentLines, line];
    const fitsCount = candidateLines.length <= GA4_BATCH_MAX_EVENTS;
    const fitsBytes = byteLength(candidateLines.join("\r\n")) <= GA4_BATCH_MAX_BYTES;
    if (current.length > 0 && (!fitsCount || !fitsBytes)) {
      groups.push(current);
      current = [];
      currentLines = [];
    }
    current.push(item);
    currentLines.push(line);
    if (current.length === 1 && byteLength(line) > GA4_BATCH_MAX_BYTES) {
      groups.push(current);
      current = [];
      currentLines = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
function coalesceGa4(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return [];
  const groups = [];
  for (const request of requests) {
    const parsed = parseRequest(request);
    let group = groups.find((g2) => g2.signature === parsed.sharedSignature);
    if (!group) {
      group = { signature: parsed.sharedSignature, items: [] };
      groups.push(group);
    }
    group.items.push(parsed);
  }
  const outputs = [];
  for (const group of groups) {
    if (group.items.length === 1) {
      outputs.push(group.items[0].original);
    } else {
      for (const chunk of splitIntoPostGroups(group.items)) {
        outputs.push(buildBatchPost(chunk));
      }
    }
  }
  return outputs;
}

// connectors/pixel/vendors/meta.js
var META_TR_ENDPOINT = "https://www.facebook.com/tr";
var SYNTHETIC_META_PIXEL_ID = "000000000000000";
var META_EGRESS_PURPOSES = ["ad_storage"];
function createMetaPixelConfig({ pixelId = SYNTHETIC_META_PIXEL_ID, endpoint = META_TR_ENDPOINT, externalId } = {}) {
  return {
    name: "airlock/pixel/meta",
    endpoint,
    eventMap: {
      page_view: "PageView",
      lead: "Lead"
    },
    paramMap: {
      id: { from: "static", value: pixelId },
      ev: { from: "event" },
      "cd[value]": { from: "params", key: "value" },
      "cd[currency]": { from: "params", key: "currency" },
      "cd[content_name]": { from: "params", key: "content_name" },
      "cd[content_category]": { from: "params", key: "content_category" }
    },
    egressPurposes: META_EGRESS_PURPOSES,
    // 026-04: the boot-time raw identity for the chamber's DEDICATED advanced-
    // matching channel — present ONLY when the host supplied `externalId`, so a
    // default Meta config stays byte-identical (no `advancedMatching` key, no
    // identity channel, no `ud[...]`). This is NOT a `paramMap` entry: `handle`
    // never reads it (026-01 AC1); the chamber hashes it off-`handle`.
    ...externalId != null && externalId !== "" ? { advancedMatching: { external_id: String(externalId) } } : {}
  };
}

// connectors/pixel/vendors/linkedin.js
var LINKEDIN_COLLECT_ENDPOINT = "https://px.ads.linkedin.com/collect";
var SYNTHETIC_LINKEDIN_PARTNER_ID = "0000000";
var SYNTHETIC_LINKEDIN_CONVERSION_ID = "00000000";
var LINKEDIN_EGRESS_PURPOSES = ["ad_storage"];
function createLinkedInInsightConfig({
  partnerId = SYNTHETIC_LINKEDIN_PARTNER_ID,
  conversionId = SYNTHETIC_LINKEDIN_CONVERSION_ID,
  endpoint = LINKEDIN_COLLECT_ENDPOINT
} = {}) {
  return {
    name: "airlock/pixel/linkedin",
    endpoint,
    eventMap: {
      page_view: null,
      // the base tag: fires with NO event-name/conversionId key at all
      lead: conversionId
      // a conversion: the "vendor event" IS the conversion id itself
    },
    paramMap: {
      pid: { from: "static", value: partnerId },
      fmt: { from: "static", value: "gif" },
      conversionId: { from: "event" }
      // omitted for page_view (null vendorEvent), present for lead
    },
    egressPurposes: LINKEDIN_EGRESS_PURPOSES
  };
}

// connectors/pixel/vendors/bing.js
var BING_UET_ENDPOINT = "https://bat.bing.com/action/0";
var SYNTHETIC_BING_TAG_ID = "00000000";
var BING_EGRESS_PURPOSES = ["ad_storage"];
function createBingUetConfig({ tagId = SYNTHETIC_BING_TAG_ID, endpoint = BING_UET_ENDPOINT } = {}) {
  return {
    name: "airlock/pixel/bing",
    endpoint,
    eventMap: {
      page_view: "pageLoad",
      lead: "custom"
    },
    paramMap: {
      ti: { from: "static", value: tagId },
      evt: { from: "event" },
      gv: { from: "params", key: "value" },
      ec: { from: "params", key: "event_category" }
    },
    egressPurposes: BING_EGRESS_PURPOSES
  };
}

// adapters/eds/cookies.js
function createCookieCapability(doc = typeof document !== "undefined" ? document : void 0) {
  return {
    async get(name) {
      return getCookieValue(doc && doc.cookie || "", name) ?? null;
    },
    async set(name, value, opts = {}) {
      if (!doc) return;
      let str = `${name}=${encodeURIComponent(value)}`;
      if (opts.maxAge !== void 0) str += `; max-age=${opts.maxAge}`;
      if (opts.path) str += `; path=${opts.path}`;
      if (opts.domain) str += `; domain=${opts.domain}`;
      if (opts.sameSite) str += `; samesite=${opts.sameSite}`;
      if (opts.secure) str += "; secure";
      doc.cookie = str;
    }
  };
}

// adapters/eds/exposure.js
var EXPOSURE_EVENT = "experiment_impression";
function readAppliedExperiment(doc) {
  const dataset = doc && doc.body && doc.body.dataset;
  if (!dataset) return null;
  const experimentId = dataset.experiment;
  const variantId = dataset.variant;
  if (!experimentId || !variantId) return null;
  return { experimentId, variantId };
}
function createExposureReporter(handle, { seen = /* @__PURE__ */ new Set() } = {}) {
  const report = (experimentId, variantId) => {
    if (!experimentId || !variantId) return;
    const key = `${experimentId}:${variantId}`;
    if (seen.has(key)) return;
    seen.add(key);
    handle.push({ event: EXPOSURE_EVENT, experiment_id: experimentId, variant_id: variantId });
  };
  return {
    /**
     * AC1 — eager page-level exposure: read the applied variant from the durable
     * body dataset and report it once. No experiment applied → no event.
     */
    reportFromBody(doc) {
      const applied = readAppliedExperiment(doc);
      if (!applied) return;
      report(applied.experimentId, applied.variantId);
    },
    /**
     * AC2 — post-boot exposure: the `aem:experimentation` CustomEvent's `detail`
     * carries `experiment`/`variant` (testbed plugin). Deduped against the boot read.
     */
    onAemExperimentation(detail) {
      if (!detail) return;
      report(detail.experiment, detail.variant);
    }
  };
}

// adapters/eds/blocks.js
var VIEW_BLOCK_EVENT = "view_block";
var metaMap = /* @__PURE__ */ new WeakMap();
function discoverBlocks(main) {
  if (!main || typeof main.querySelectorAll !== "function") return [];
  return Array.from(main.querySelectorAll("[data-block-status]"));
}
function blockName(el) {
  if (!el) return null;
  const fromData = el.dataset && el.dataset.blockName;
  if (fromData) return fromData;
  const cls = el.classList && el.classList[0];
  return cls || null;
}
function createBlockInstrumenter(handle, { observerFactory } = {}) {
  const onIntersect = (entries, observer) => {
    for (const entry of entries || []) {
      if (!entry || !entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const target = entry.target;
      const meta = metaMap.get(target);
      if (!meta) continue;
      handle.push({ event: VIEW_BLOCK_EVENT, block_name: meta.block_name });
      if (observer && typeof observer.unobserve === "function") observer.unobserve(target);
    }
  };
  return {
    /**
     * Instrument the decorated blocks within `main`: associate each in the WeakMap
     * (no DOM write) and register it for a first-view report at threshold 0.5. A
     * no-op when there is no observer factory, no `main`, or no blocks.
     */
    instrument(main) {
      if (typeof observerFactory !== "function") return;
      const blocks = discoverBlocks(main);
      if (blocks.length === 0) return;
      const observer = observerFactory(onIntersect, { threshold: 0.5 });
      if (!observer || typeof observer.observe !== "function") return;
      for (const block of blocks) {
        metaMap.set(block, { block_name: blockName(block) });
        observer.observe(block);
      }
    }
  };
}

// connectors/helix-rum/cwv-capture.js
function isScalar(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function projectCwv(metric) {
  const projected = { name: metric && metric.name, value: metric && metric.value };
  const attribution = metric && metric.attribution;
  if (attribution && typeof attribution === "object") {
    for (const key of Object.keys(attribution)) {
      if (isScalar(attribution[key])) projected[key] = attribution[key];
    }
  }
  return projected;
}
function startCwvCapture({ push, onLCP, onCLS, onINP }) {
  const onMetric = (metric) => push({ event: "cwv", ...projectCwv(metric) });
  onLCP(onMetric);
  onCLS(onMetric);
  onINP(onMetric);
}

// connectors/helix-rum/connector.js
var DEFAULT_COLLECT_BASE_URL = "https://ot.aem.live";
var DEFAULT_WEIGHT = RATE_WEIGHTS.medium;
var HELIX_RUM_EVENTS = Object.freeze(["top", "error", "cwv"]);

// node_modules/web-vitals/dist/web-vitals.attribution.js
var t = class {
  t;
  o = 0;
  i = [];
  l(t2) {
    if (t2.hadRecentInput) return;
    const n2 = this.i[0], e2 = this.i.at(-1);
    this.o && n2 && e2 && t2.startTime - e2.startTime < 1e3 && t2.startTime - n2.startTime < 5e3 ? (this.o += t2.value, this.i.push(t2)) : (this.o = t2.value, this.i = [t2]), this.t?.(t2);
  }
};
var n = () => {
  const t2 = performance.getEntriesByType("navigation")[0];
  if (t2 && t2.responseStart > 0 && t2.responseStart < performance.now()) return t2;
};
var e = (t2) => {
  if ("loading" === document.readyState) return "loading";
  const e2 = n();
  if (e2) {
    if (t2 < e2.domInteractive) return "loading";
    if (0 === e2.domContentLoadedEventStart || t2 < e2.domContentLoadedEventStart) return "dom-interactive";
    if (0 === e2.domComplete || t2 < e2.domComplete) return "dom-content-loaded";
  }
  return "complete";
};
var o = (t2) => {
  const n2 = t2.nodeName;
  return 1 === t2.nodeType ? n2.toLowerCase() : n2.toUpperCase().replace(/^#/, "");
};
var i = (t2) => {
  let n2 = "";
  try {
    for (; 9 !== t2?.nodeType; ) {
      const e2 = t2, i2 = e2.id ? "#" + e2.id : [o(e2), ...Array.from(e2.classList ?? []).sort()].join(".");
      if (n2.length + i2.length > 99) return n2 || i2;
      if (n2 = n2 ? i2 + ">" + n2 : i2, e2.id) break;
      t2 = e2.parentNode;
    }
  } catch {
  }
  return n2;
};
var a = /* @__PURE__ */ new WeakMap();
function r(t2, n2) {
  let e2 = a.get(n2);
  return e2 || (e2 = /* @__PURE__ */ new WeakMap(), a.set(n2, e2)), e2.get(t2) || e2.set(t2, new n2()), e2.get(t2);
}
var s = -1;
var c = () => s;
var f = (t2) => {
  addEventListener("pageshow", (n2) => {
    n2.persisted && (s = n2.timeStamp, t2(n2));
  }, true);
};
var l = (t2, n2, e2, o2) => {
  let i2, a2;
  return (r2) => {
    n2.value >= 0 && (r2 || o2) && (a2 = n2.value - (i2 ?? 0), (a2 || void 0 === i2) && (i2 = n2.value, n2.delta = a2, n2.rating = ((t3, n3) => t3 > n3[1] ? "poor" : t3 > n3[0] ? "needs-improvement" : "good")(n2.value, e2), t2(n2)));
  };
};
var u = (t2) => {
  requestAnimationFrame(() => requestAnimationFrame(() => t2()));
};
var d = () => n()?.activationStart ?? 0;
var h = -1;
var g = /* @__PURE__ */ new Set();
var v = () => "hidden" !== document.visibilityState || document.prerendering ? 1 / 0 : 0;
var p = (t2) => {
  if ("hidden" === document.visibilityState) {
    if ("visibilitychange" === t2.type) for (const t3 of g) t3();
    isFinite(h) || (h = "visibilitychange" === t2.type ? t2.timeStamp : 0, removeEventListener("prerenderingchange", p, true));
  }
};
var m = (t2 = false) => {
  if (t2 && (h = 1 / 0), h < 0) {
    const t3 = d(), n2 = document.prerendering ? void 0 : globalThis.performance.getEntriesByType("visibility-state").find((n3) => "hidden" === n3.name && n3.startTime >= t3)?.startTime;
    h = n2 ?? v(), addEventListener("visibilitychange", p, true), addEventListener("prerenderingchange", p, true), f(() => {
      setTimeout(() => {
        h = v();
      });
    });
  }
  return { get firstHiddenTime() {
    return h;
  }, onHidden(t3) {
    g.add(t3);
  } };
};
var y = (t2, e2 = -1, o2, i2 = 0, a2, r2, s2) => {
  const f2 = n(), l2 = f2?.navigationId || 0;
  let u2 = "navigate";
  o2 ? u2 = o2 : c() >= 0 ? u2 = "back-forward-cache" : f2 && (document.prerendering || d() > 0 ? u2 = "prerender" : document.wasDiscarded ? u2 = "restore" : f2.type && (u2 = f2.type.replace(/_/g, "-")));
  return { name: t2, value: e2, rating: "good", delta: 0, entries: [], id: `v6-${Date.now()}-${Math.floor(8999999999999 * Math.random()) + 1e12}`, navigationType: u2, navigationId: i2 || l2, navigationInteractionId: a2, navigationURL: r2 || f2?.name, navigationStartTime: s2 || 0 };
};
var b = (t2, n2, e2 = {}) => {
  try {
    const o2 = t2.filter((t3) => PerformanceObserver.supportedEntryTypes.includes(t3));
    if (o2.length > 0) {
      const t3 = new PerformanceObserver((t4) => {
        queueMicrotask(() => {
          const e3 = t4.getEntries();
          o2.length > 1 && e3.sort((t5, n3) => t5.startTime + t5.duration - (n3.startTime + n3.duration)), n2(e3);
        });
      });
      for (const n3 of o2) t3.observe({ type: n3, buffered: true, ...e2 });
      return t3;
    }
  } catch {
  }
};
var M = (t2) => globalThis.PerformanceObserver?.supportedEntryTypes?.includes("soft-navigation") && "function" == typeof globalThis.PerformanceSoftNavigation?.prototype?.getLargestInteractionContentfulPaint && t2 && t2.reportSoftNavs;
var T = (t2, n2) => {
  if (t2.set(n2.navigationId, n2), t2.size > 2) {
    const n3 = t2.keys().next().value;
    void 0 !== n3 && t2.delete(n3);
  }
};
var E = (t2) => {
  let n2 = false;
  return () => {
    n2 || (t2(), n2 = true);
  };
};
var D = class {
  u;
};
var w = (t2) => {
  document.prerendering ? addEventListener("prerenderingchange", t2, true) : t2();
};
var S = [1800, 3e3];
var k = (t2, n2 = {}) => {
  const e2 = M(n2);
  w(() => {
    const o2 = r(n2, D), i2 = m();
    let a2, s2 = y("FCP");
    const h2 = b(["paint"], (t3) => {
      for (const n3 of t3) "first-contentful-paint" === n3.name && (h2.disconnect(), n3.startTime < i2.firstHiddenTime && (s2.value = Math.max(n3.startTime - d(), 0), s2.entries.push(n3), s2.navigationId = n3.navigationId || s2.navigationId, a2(true)));
    });
    if (h2 && (a2 = l(t2, s2, S, n2.reportAllChanges), f((e3) => {
      s2 = y("FCP", -1, "back-forward-cache", s2.navigationId, s2.navigationInteractionId, s2.navigationURL, c()), a2 = l(t2, s2, S, n2.reportAllChanges), u(() => {
        s2.value = performance.now() - e3.timeStamp, a2(true);
      });
    })), e2) {
      b(["soft-navigation"], (e3) => {
        e3.forEach((e4) => {
          o2.u && e4.navigationId && T(o2.u, e4);
          const i3 = Math.max((e4.presentationTime || e4.paintTime || 0) - e4.startTime, 0);
          s2 = y("FCP", i3, "soft-navigation", e4.navigationId, e4.interactionId, e4.name, e4.startTime), a2 = l(t2, s2, S, n2.reportAllChanges), a2(true);
        });
      }, n2);
    }
  });
};
var L = [0.1, 0.25];
var P = (t2) => t2.find((t3) => 1 === t3.node?.nodeType) || t2[0];
var F = (n2, o2 = {}) => {
  const a2 = r(o2 = Object.assign({}, o2), t), s2 = /* @__PURE__ */ new WeakMap();
  a2.t = (t2) => {
    if (t2?.sources?.length) {
      const n3 = P(t2.sources), e2 = n3?.node;
      if (e2) {
        const t3 = o2.generateTarget?.(e2) ?? i(e2);
        s2.set(n3, t3);
      }
    }
  };
  ((n3, e2 = {}) => {
    const o3 = m();
    k(E(() => {
      let i2, a3 = y("CLS", 0);
      const s3 = r(e2, t), d2 = (t2, o4, r2, c2, f2) => {
        a3 = y("CLS", 0, t2, o4, r2, c2, f2), s3.o = 0, i2 = l(n3, a3, L, e2.reportAllChanges);
      }, h2 = (t2 = false) => {
        s3.o > a3.value && (a3.value = s3.o, a3.entries = s3.i), i2(t2);
      }, g2 = (t2) => {
        h2(true), d2("soft-navigation", t2.navigationId, t2.interactionId, t2.name, t2.startTime);
      }, v2 = (t2) => {
        for (const n4 of t2) "soft-navigation" !== n4.entryType ? s3.l(n4) : g2(n4);
        h2();
      }, p2 = ["layout-shift"];
      M(e2) && p2.push("soft-navigation");
      const m2 = b(p2, v2);
      m2 && (i2 = l(n3, a3, L, e2.reportAllChanges), o3.onHidden(() => {
        v2(m2.takeRecords()), i2(true);
      }), f(() => {
        d2("back-forward-cache", a3.navigationId, a3.navigationInteractionId, a3.navigationURL, c()), u(i2);
      }), setTimeout(i2));
    }));
  })((t2) => {
    n2(((t3) => {
      let n3 = {};
      if (t3.entries.length) {
        const o3 = t3.entries.reduce((t4, n4) => t4.value > n4.value ? t4 : n4);
        if (o3?.sources?.length) {
          const t4 = P(o3.sources);
          t4 && (n3 = { largestShiftTarget: s2.get(t4), largestShiftTime: o3.startTime, largestShiftValue: o3.value, largestShiftSource: t4, largestShiftEntry: o3, loadState: e(o3.startTime) });
        }
      }
      return Object.assign(t3, { attribution: n3 });
    })(t2));
  }, o2);
};
var C = 0;
var I = 1 / 0;
var B = 0;
var O = (t2) => {
  for (const n2 of t2) n2.interactionId && (I = Math.min(I, n2.interactionId), B = Math.max(B, n2.interactionId), C = B ? (B - I) / 7 + 1 : 0);
};
var j;
var A = () => j ? C : performance.interactionCount ?? 0;
var N = () => {
  "interactionCount" in performance || j || (j = b(["event"], O, { durationThreshold: 0 }));
};
var q = class {
  h = 0;
  v = [];
  p = /* @__PURE__ */ new Map();
  m;
  M;
  T() {
    return A() - this.h;
  }
  D() {
    this.h = A(), this.v.length = 0, this.p.clear();
  }
  S(t2) {
    const n2 = this.T(), e2 = Math.min(this.v.length - 1, Math.floor(n2 / 50));
    return !n2 || -1 !== e2 || "soft-navigation" !== t2 && "back-forward-cache" !== t2 ? this.v[e2] : { k: 8, id: -1, entries: [] };
  }
  l(t2) {
    if (this.m?.(t2), !t2.interactionId) return;
    const n2 = this.v.at(-1);
    let e2 = this.p.get(t2.interactionId);
    if (e2 || this.v.length < 10 || t2.duration > n2.k) {
      if (e2 ? t2.duration > e2.k ? (e2.entries = [t2], e2.k = t2.duration) : t2.duration === e2.k && t2.startTime === e2.entries[0].startTime && e2.entries.push(t2) : (e2 = { id: t2.interactionId, entries: [t2], k: t2.duration }, this.p.set(e2.id, e2), this.v.push(e2)), this.v.sort((t3, n3) => n3.k - t3.k), this.v.length > 10) {
        const t3 = this.v.splice(10);
        for (const n3 of t3) this.p.delete(n3.id);
      }
      this.M?.(e2);
    }
  }
};
var W = (t2) => {
  const n2 = "requestIdleCallback" in globalThis ? 1e3 : 0, e2 = globalThis.requestIdleCallback || setTimeout, o2 = globalThis.cancelIdleCallback || clearTimeout;
  if ("hidden" === document.visibilityState) t2();
  else {
    const i2 = E(t2);
    let a2 = -1;
    const r2 = () => {
      o2(a2), i2();
    };
    addEventListener("visibilitychange", r2, { once: true, capture: true }), a2 = e2(() => {
      removeEventListener("visibilitychange", r2, { capture: true }), i2();
    }, { timeout: n2 });
  }
};
var x = [200, 500];
var R = (t2, n2 = {}) => {
  const o2 = r(n2 = Object.assign({}, n2), q);
  let a2 = [], s2 = [], u2 = 0;
  const d2 = /* @__PURE__ */ new WeakMap(), h2 = /* @__PURE__ */ new WeakMap();
  let g2 = false;
  const v2 = () => {
    g2 || (W(p2), g2 = true);
  }, p2 = () => {
    const t3 = new Set(o2.v.map((t4) => d2.get(t4.entries[0]))), n3 = s2.length - 10;
    s2 = s2.filter((e3, o3) => o3 >= n3 || t3.has(e3));
    const e2 = /* @__PURE__ */ new Set();
    for (const t4 of s2) {
      const n4 = T2(t4.startTime, t4.processingEnd);
      for (const t5 of n4) e2.add(t5);
    }
    a2 = a2.filter((t4) => t4.startTime > u2 || e2.has(t4)), g2 = false;
  };
  o2.m = (t3) => {
    const e2 = t3.startTime + t3.duration;
    let o3;
    u2 = Math.max(u2, t3.processingEnd);
    for (let i2 = s2.length - 1; i2 >= 0; i2--) {
      const a3 = s2[i2];
      if (Math.abs(e2 - a3.renderTime) <= 8) {
        o3 = a3, o3.startTime = Math.min(t3.startTime, o3.startTime), o3.processingStart = Math.min(t3.processingStart, o3.processingStart), o3.processingEnd = Math.max(t3.processingEnd, o3.processingEnd), n2.includeProcessedEventEntries && o3.entries.push(t3);
        break;
      }
    }
    o3 || (o3 = { startTime: t3.startTime, processingStart: t3.processingStart, processingEnd: t3.processingEnd, renderTime: e2, entries: n2.includeProcessedEventEntries ? [t3] : [] }, s2.push(o3)), t3.interactionId && d2.set(t3, o3), v2();
  }, o2.M = (t3) => {
    if (!h2.get(t3)) {
      const e2 = t3.entries.find((t4) => t4.target)?.target;
      if (e2) {
        const o3 = n2.generateTarget?.(e2) ?? i(e2);
        h2.set(t3, o3);
      } else {
        const n3 = t3.entries.find((t4) => t4.targetSelector)?.targetSelector;
        n3 && h2.set(t3, n3);
      }
    }
  };
  const T2 = (t3, n3) => {
    const e2 = [];
    for (const o3 of a2) if (!(o3.startTime + o3.duration < t3)) {
      if (o3.startTime > n3) break;
      e2.push(o3);
    }
    return e2;
  }, E2 = (t3) => {
    if (0 === t3.entries.length) {
      const n4 = t3.navigationStartTime || 0, o3 = { processedEventEntries: [], longAnimationFrameEntries: [], inputDelay: 0, processingDuration: 0, presentationDelay: t3.value, loadState: e(n4) };
      return Object.assign(t3, { attribution: o3 });
    }
    const n3 = t3.entries[0], i2 = d2.get(n3), a3 = Math.max(i2.processingStart, n3.startTime), r2 = Math.max(n3.startTime + n3.duration, a3), s3 = Math.min(i2.processingEnd, r2), c2 = i2.entries.sort((t4, n4) => t4.processingStart - n4.processingStart), f2 = T2(n3.startTime, s3), l2 = o2.p.get(n3.interactionId), u3 = { interactionTarget: h2.get(l2), interactionType: n3.name.startsWith("key") ? "keyboard" : "pointer", interactionTime: n3.startTime, nextPaintTime: r2, processedEventEntries: c2, longAnimationFrameEntries: f2, inputDelay: a3 - n3.startTime, processingDuration: s3 - a3, presentationDelay: r2 - s3, loadState: e(n3.startTime), longestScript: void 0, totalScriptDuration: void 0, totalStyleAndLayoutDuration: void 0, totalPaintDuration: void 0, totalUnattributedDuration: void 0 };
    return ((t4) => {
      const n4 = t4.interactionTime, e2 = t4.nextPaintTime;
      if (!t4.longAnimationFrameEntries?.length || !n4 || !e2) return;
      const o3 = t4.inputDelay, i3 = t4.processingDuration;
      let a4, r3, s4 = 0, c3 = 0, f3 = 0, l3 = 0;
      for (const e3 of t4.longAnimationFrameEntries) {
        c3 = c3 + e3.startTime + e3.duration - e3.styleAndLayoutStart;
        for (const t5 of e3.scripts) {
          const e4 = t5.startTime + t5.duration;
          if (e4 < n4) continue;
          const f4 = e4 - Math.max(n4, t5.startTime), u5 = t5.duration ? f4 / t5.duration * t5.forcedStyleAndLayoutDuration : 0;
          s4 += f4 - u5, c3 += u5, f4 > l3 && (r3 = t5.startTime < n4 + o3 ? "input-delay" : t5.startTime >= n4 + o3 + i3 ? "presentation-delay" : "processing-duration", a4 = t5, l3 = f4);
        }
      }
      const u4 = t4.longAnimationFrameEntries.at(-1), d3 = u4 ? u4.startTime + u4.duration : 0;
      d3 >= n4 + o3 + i3 && (f3 = e2 - d3), a4 && r3 && (t4.longestScript = { entry: a4, subpart: r3, intersectingDuration: l3 }), t4.totalScriptDuration = s4, t4.totalStyleAndLayoutDuration = c3, t4.totalPaintDuration = f3, t4.totalUnattributedDuration = e2 - n4 - s4 - c3 - f3;
    })(u3), Object.assign(t3, { attribution: u3 });
  };
  b(["long-animation-frame"], (t3) => {
    a2 = a2.concat(t3), v2();
  }, n2), ((t3, n3 = {}) => {
    if (!globalThis.PerformanceEventTiming || !("interactionId" in PerformanceEventTiming.prototype)) return;
    const e2 = m();
    w(() => {
      N();
      let o3, i2 = y("INP");
      const a3 = r(n3, q), s3 = (e3, r2, s4, c2, f2) => {
        a3.D(), i2 = y("INP", -1, e3, r2, s4, c2, f2), o3 = l(t3, i2, x, n3.reportAllChanges);
      }, u3 = () => {
        const t4 = a3.S(i2.navigationType);
        t4 && t4.k !== i2.value && (i2.value = t4.k, i2.entries = t4.entries, o3());
      }, d3 = (t4) => {
        u3(), o3(true), s3("soft-navigation", t4.navigationId, t4.interactionId, t4.name, t4.startTime);
      }, h3 = (t4, n4 = false) => {
        W(() => {
          for (const n5 of t4) "soft-navigation" !== n5.entryType ? a3.l(n5) : d3(n5);
          u3(), n4 && o3(true);
        });
      }, g3 = ["event", "first-input"];
      M(n3) && g3.push("soft-navigation");
      const v3 = b(g3, h3, { ...n3, durationThreshold: n3.durationThreshold ?? 40 });
      o3 = l(t3, i2, x, n3.reportAllChanges), v3 && (e2.onHidden(() => {
        h3(v3.takeRecords(), true);
      }), f(() => {
        s3("back-forward-cache", i2.navigationId, i2.navigationInteractionId, i2.navigationURL, c());
      }));
    });
  })((n3) => {
    t2(E2(n3));
  }, n2);
};
var U = class {
  m;
  u;
  l(t2) {
    this.m?.(t2);
  }
};
var $ = [2500, 4e3];
var H = 50;
var V = [];
b(["resource"], (t2) => {
  for (const n2 of t2) V.push(n2), V.length > H && V.shift();
});
var z = (t2, e2 = {}) => {
  null != (e2 = Object.assign({}, e2)).resourceBufferSize && (H = e2.resourceBufferSize);
  const o2 = r(e2, U), a2 = /* @__PURE__ */ new WeakMap();
  M(e2) && (o2.u = /* @__PURE__ */ new Map()), o2.m = (t3) => {
    const n2 = t3.element;
    if (n2) {
      const o3 = e2.generateTarget?.(n2) ?? i(n2);
      a2.set(t3, o3);
    } else t3.id && a2.set(t3, `#${t3.id}`);
  };
  ((t3, n2 = {}) => {
    let e3 = false;
    const o3 = M(n2);
    w(() => {
      let i2, a3 = m(), s2 = y("LCP");
      const h2 = r(n2, U), g2 = (o4, r2, c2, f2, u2) => {
        s2 = y("LCP", -1, o4, r2, c2, f2, u2), i2 = l(t3, s2, $, n2.reportAllChanges), e3 = false, "soft-navigation" === o4 && (a3 = m(true));
      }, v2 = (t4) => {
        h2.u && t4.navigationId && T(h2.u, t4), e3 || i2(true), g2("soft-navigation", t4.navigationId, t4.interactionId, t4.name, t4.startTime);
        const n3 = t4.getLargestInteractionContentfulPaint?.();
        n3 && p2([n3]);
      }, p2 = (t4) => {
        n2.reportAllChanges || o3 || (t4 = t4.slice(-1));
        for (const n3 of t4) {
          if (!n3) continue;
          if ("soft-navigation" === n3.entryType) {
            v2(n3);
            continue;
          }
          let t5 = 0, e4 = [], o4 = n3.startTime;
          if ("largest-contentful-paint" === n3.entryType) t5 = Math.max(n3.startTime - d(), 0), h2.l(n3), e4 = [n3];
          else if ("interaction-contentful-paint" === n3.entryType) {
            const i3 = n3;
            if (!s2.navigationId) continue;
            if ("interactionId" in i3 && i3.interactionId != s2.navigationInteractionId) continue;
            o4 = i3.largestContentfulPaint?.renderTime || 0, t5 = Math.max(o4 - n3.startTime, 0), i3.largestContentfulPaint && (h2.l(i3.largestContentfulPaint), e4 = [i3.largestContentfulPaint]);
          }
          o4 < a3.firstHiddenTime && (s2.value = t5, s2.entries = e4, i2());
        }
      }, M2 = ["largest-contentful-paint"];
      o3 && M2.push("interaction-contentful-paint", "soft-navigation");
      const E2 = b(M2, p2);
      if (E2) {
        i2 = l(t3, s2, $, n2.reportAllChanges);
        const a4 = ["keydown", "click", "visibilitychange"], r2 = (t4) => {
          if (t4.isTrusted && !e3) {
            const t5 = s2.id;
            W(() => {
              if (!e3) {
                if (!o3) {
                  E2.disconnect();
                  for (const t6 of a4) removeEventListener(t6, r2, { capture: true });
                }
                t5 === s2.id && (e3 = true, i2(true));
              }
            });
          }
        };
        for (const t4 of a4) addEventListener(t4, r2, { capture: true });
        f((o4) => {
          g2("back-forward-cache", s2.navigationId, s2.navigationInteractionId, s2.navigationURL, c()), i2 = l(t3, s2, $, n2.reportAllChanges), u(() => {
            s2.value = performance.now() - o4.timeStamp, e3 = true, i2(true);
          });
        });
      }
    });
  })((e3) => {
    t2(((t3) => {
      let e4 = { timeToFirstByte: 0, resourceLoadDelay: 0, resourceLoadDuration: 0, elementRenderDelay: t3.value };
      if (t3.entries.length) {
        const i2 = t3.entries.at(-1), r2 = i2.url && (V.findLast((t4) => t4.name === i2.url) || performance.getEntriesByType("resource").findLast((t4) => t4.name === i2.url));
        let s2;
        e4.target = a2.get(i2), e4.lcpEntry = i2, i2.url && (e4.url = i2.url), r2 && (e4.lcpResourceEntry = r2);
        let c2 = 0, f2 = 0;
        if ("soft-navigation" !== t3.navigationType ? (s2 = n(), c2 = s2?.activationStart ?? 0, f2 = s2?.responseStart ?? 0) : (c2 = t3.navigationStartTime || 0, s2 = o2.u?.get(t3.navigationId)), s2) {
          const n2 = Math.max(0, f2 - c2), o3 = Math.max(n2, r2 ? (r2.requestStart || r2.startTime) - c2 : 0), i3 = Math.min(t3.value, Math.max(o3, r2 ? r2.responseEnd - c2 : 0));
          e4 = { ...e4, timeToFirstByte: n2, resourceLoadDelay: o3 - n2, resourceLoadDuration: i3 - o3, elementRenderDelay: t3.value - i3, navigationEntry: s2 };
        }
      }
      return Object.assign(t3, { attribution: e4 });
    })(e3));
  }, e2);
};

// adapters/eds/index.js
var DEFAULT_ENDPOINTS = ["https://www.google-analytics.com/mp/collect"];
var UC2_EVENTS = {
  engage: "cta_engage",
  // AC1: non-navigating CTA → steady-state worker cycle (push)
  outbound: "outbound_click",
  // AC2: navigating anchor leaving the page → fast path (pushCritical)
  closing: "page_view"
  // AC2: closing beacon on pagehide → fast path (pushCritical)
};
function pageOrigin(loc) {
  try {
    return new URL(loc.href).origin;
  } catch {
    return null;
  }
}
function navigatesAway(anchor, loc) {
  const href = anchor && anchor.href;
  if (typeof href !== "string" || href.length === 0) return false;
  let url;
  try {
    url = new URL(href, loc.href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const origin = pageOrigin(loc);
  if (origin && url.origin !== origin) return true;
  return url.pathname === "/signup";
}
function opensElsewhere(e2, anchor) {
  if (e2.defaultPrevented || e2.metaKey || e2.ctrlKey || e2.shiftKey || e2.altKey) return true;
  if (!anchor) return false;
  if (anchor.target === "_blank") return true;
  return typeof anchor.hasAttribute === "function" && anchor.hasAttribute("download");
}
function wireInteractions(handle, io = {}) {
  const doc = io.doc || (typeof document !== "undefined" ? document : void 0);
  const win = io.win || (typeof window !== "undefined" ? window : void 0);
  const loc = io.loc || (typeof location !== "undefined" ? location : void 0);
  if (!doc || !win || !loc || typeof doc.addEventListener !== "function") return;
  if (doc.__airlockWired) return;
  doc.__airlockWired = true;
  doc.addEventListener("click", (e2) => {
    const t2 = e2 && e2.target;
    if (!t2 || typeof t2.closest !== "function") return;
    const engage = t2.closest("#cta-engage");
    if (engage) {
      const label = String(engage.textContent || "").trim().slice(0, 100);
      handle.push({ event: UC2_EVENTS.engage, link_text: label, page_location: loc.href });
      return;
    }
    const anchor = t2.closest("a[href]");
    if (anchor && !opensElsewhere(e2, anchor) && navigatesAway(anchor, loc)) {
      handle.pushCritical({
        event: UC2_EVENTS.outbound,
        link_url: anchor.href,
        page_location: loc.href
      });
    }
  });
  win.addEventListener("pagehide", () => {
    handle.pushCritical({ event: UC2_EVENTS.closing, page_location: loc.href });
  });
}
function wireExposure(handle, io = {}) {
  const doc = io.doc || (typeof document !== "undefined" ? document : void 0);
  if (!doc || typeof doc.addEventListener !== "function") return;
  if (doc.__airlockExposureWired) return;
  doc.__airlockExposureWired = true;
  const reporter = createExposureReporter(handle, { seen: /* @__PURE__ */ new Set() });
  reporter.reportFromBody(doc);
  doc.addEventListener(
    "aem:experimentation",
    (e2) => reporter.onAemExperimentation(e2 && e2.detail)
  );
}
function wireBlocks(handle, io = {}) {
  const doc = io.doc || (typeof document !== "undefined" ? document : void 0);
  const win = io.win || (typeof window !== "undefined" ? window : void 0);
  if (!doc || typeof doc.querySelector !== "function") return;
  if (doc.__airlockBlocksWired) return;
  const IntersectionObserverCtor = win && win.IntersectionObserver;
  if (typeof IntersectionObserverCtor !== "function") return;
  const main = doc.querySelector("main");
  if (!main) return;
  doc.__airlockBlocksWired = true;
  const observerFactory = (cb, opts) => new IntersectionObserverCtor(cb, opts);
  createBlockInstrumenter(handle, { observerFactory }).instrument(main);
}
function installOnWindow(handle) {
  if (typeof window === "undefined") return handle;
  if (window.airlock && typeof window.airlock.dispose === "function") window.airlock.dispose();
  window.airlock = handle;
  return handle;
}
async function bootGa4Core(opts = {}) {
  const {
    ctx: providedCtx,
    consent: providedConsent,
    onetrust,
    consentStrict = false,
    endpoints = DEFAULT_ENDPOINTS,
    trackers = endpoints.length,
    payloadDenylist,
    onDiagnostic
  } = opts;
  const globalWin = typeof window !== "undefined" ? window : void 0;
  const consent = onetrust ? resolveOnetrustBootConsent({ ...onetrust, win: globalWin }) : providedConsent;
  const storageGranted = consent ? resolveConsent(consent, "analytics_storage") === "granted" : true;
  const ctx = providedCtx ?? await sourceGa4Ctx({
    cookies: createCookieCapability(document),
    cookieString: document.cookie,
    storageGranted
  });
  const shapedConsent = consent ? shapeMpConsent(consent) : void 0;
  const ctxWithConsent = shapedConsent ? { ...ctx, consent: shapedConsent } : ctx;
  const airlock = createAirlock({
    trackers,
    workFactor: 0,
    endpoints,
    ctx: ctxWithConsent,
    consent,
    egressPurposes: consent ? GA4_EGRESS_PURPOSES : [],
    consentStrict,
    payloadDenylist,
    // spec 028: thread the inspector's diagnostic sink so a PROD-booted instance's
    // enforcement decisions (held/dropped/stripped) are observable — without it the
    // 028 inspector is blind to production boots (docs/inbox.md, 2026-09-03). Absent
    // -> createAirlock falls back to its console default (back-compat).
    onDiagnostic
  });
  let unsubscribeOnetrust = null;
  const handle = {
    push: (evt) => airlock.push(evt),
    pushCritical: (evt) => airlock.pushCritical(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    // 017-03 AC2: mid-session grant -> flushes held beacons
    getState: (path) => airlock.getState(path),
    // whole projection or dotted-path read (push-api.md)
    flushNow: () => airlock.flushNow(),
    // force-drain the ring to the worker (deterministic teardown/test)
    stats: () => airlock.stats(),
    dispose: () => {
      if (unsubscribeOnetrust) unsubscribeOnetrust();
      airlock.dispose();
    }
  };
  if (onetrust) {
    unsubscribeOnetrust = subscribeOnetrustConsentChanges({
      onetrust: onetrust.onetrust ?? (globalWin && globalWin.OneTrust),
      win: onetrust.win ?? globalWin,
      groupPurposeMap: onetrust.groupPurposeMap,
      onChange: (vector) => handle.setConsent(vector)
    });
  }
  wireInteractions(handle);
  wireExposure(handle);
  wireBlocks(handle);
  return handle;
}
async function bootEdsAnalytics(opts = {}) {
  return installOnWindow(await bootGa4Core(opts));
}
async function bootGa4Gtag(opts = {}) {
  const {
    ctx: providedCtx,
    measurementId,
    consent,
    consentDefault,
    consentStrict = false,
    payloadDenylist,
    streamCookieName,
    endpoint = GA4_GTAG_COLLECT_ENDPOINT,
    onDiagnostic
  } = opts;
  const storageGranted = consent ? resolveConsent(consent, "analytics_storage") === "granted" : true;
  const cookies = providedCtx ? null : createCookieCapability(document);
  const ctx = providedCtx ?? await sourceGa4Ctx({
    cookies,
    cookieString: document.cookie,
    storageGranted
  });
  let ctxWithSessionState = ctx;
  if (!providedCtx && streamCookieName) {
    const sessionWrite = await writeGa4SessionState({
      streamCookieName,
      cookies,
      storageGranted
    });
    if (sessionWrite) {
      const { sessionId, ...sessionState } = sessionWrite;
      ctxWithSessionState = { ...ctx, sessionId, sessionState };
    }
  }
  const ctxWithConsent = { ...ctxWithSessionState, consent, consentDefault };
  const airlock = createAirlock({
    connector: "ga4-gtag",
    connectorConfig: { measurementId, ctx: ctxWithConsent, endpoint },
    endpoints: [endpoint],
    ctx: ctxWithConsent,
    consent,
    egressPurposes: consent ? GA4_GTAG_EGRESS_PURPOSES : [],
    consentStrict,
    payloadDenylist,
    // 041-03: wire the 040-03/040-05 GA4 batching strategy onto the 040-02 core
    // coalescing seam — a same-context cycle of >=2 /g/collect GETs now
    // egresses as gtag's own batched-POST convention (split when oversized),
    // matching the container tag this connector reproduces. `coalesceGa4` is
    // GA4-specific and DEFAULT-OFF everywhere else (no other `createAirlock`
    // caller in this file passes `coalesce` — the pixel/RUM/MP paths are
    // byte-unchanged; Alloy boots via `core/wrapped-sdk-host.js`, not
    // `createAirlock`, so it is trivially unaffected); governance (seal +
    // endpoint ceiling) is unaffected — it already runs on every input AND
    // every coalesced output (040-02 AC1).
    coalesce: coalesceGa4,
    onDiagnostic
    // spec 028: inspector diagnostic sink pass-through (see bootGa4Core)
  });
  return {
    push: (evt) => airlock.push(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    getState: (path) => airlock.getState(path),
    flushNow: () => airlock.flushNow(),
    stats: () => airlock.stats(),
    dispose: () => airlock.dispose()
  };
}
async function bootGoogleAds(opts = {}) {
  const {
    ctx: providedCtx,
    conversionId,
    consent,
    consentDefault,
    consentStrict = false,
    payloadDenylist,
    endpoint = GOOGLE_ADS_CCM_COLLECT_ENDPOINT,
    onDiagnostic
  } = opts;
  const adStorageGranted = consent ? resolveConsent(consent, "ad_storage") === "granted" : true;
  const ctx = providedCtx ?? sourceGoogleAdsCtx({
    cookieString: typeof document !== "undefined" ? document.cookie : "",
    landingUrl: typeof document !== "undefined" && document.location ? document.location.href : "",
    adStorageGranted
  });
  const ctxWithConsent = { ...ctx, consent, consentDefault };
  const airlock = createAirlock({
    connector: "google-ads",
    connectorConfig: { conversionId, ctx: ctxWithConsent, endpoint },
    endpoints: [endpoint],
    ctx: ctxWithConsent,
    consent,
    egressPurposes: consent ? GOOGLE_ADS_EGRESS_PURPOSES : [],
    consentStrict,
    // 045-01/044-02 (ADR-0023 Option E): g-ads OPTS IN to hold-on-denied — grounded on
    // R-009 §(b) (the container HELD the AW family under reject-all). Unconditional:
    // inert when egressPurposes is [] (no consent wired), because the seal's hold/gate
    // logic is itself gated on `egressPurposes.length` in core/airlock.js — back-compat
    // safe, exactly like bootGa4Gtag's own unconditional `coalesce: coalesceGa4` wiring.
    holdOnDenied: true,
    // The connector's held→grant-flush re-mapper (045-01, test/google-ads-seal.test.js).
    // A fresh `readCookieString` closure re-reads `document.cookie` on EVERY call (never
    // cached) — the load-bearing re-source-at-flush-time behavior AC4 proves. `consentDefault`
    // MUST be threaded here too (fix round, 2026-09-14): `createGoogleAdsRemap` re-encodes
    // `gcd` via the SAME `encodeGcd(consent, consentDefault)` the steady-state path uses
    // (connectors/google-ads/connector.js) — an omitted `consentDefault` here would make a
    // flushed beacon fall back to the absent-default (implicit denied-all) `gcd` scope gate
    // instead of the host's ACTUAL declared default, diverging from the steady-state beacon's
    // own `gcd` whenever that declared default isn't denied-all.
    remap: createGoogleAdsRemap({
      conversionId,
      endpoint,
      consentDefault,
      readCookieString: () => typeof document !== "undefined" ? document.cookie : ""
    }),
    payloadDenylist,
    onDiagnostic
  });
  return {
    push: (evt) => airlock.push(evt),
    pushCritical: (evt) => airlock.pushCritical(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    getState: (path) => airlock.getState(path),
    flushNow: () => airlock.flushNow(),
    stats: () => airlock.stats(),
    dispose: () => airlock.dispose()
  };
}
async function bootFloodlight(opts = {}) {
  const {
    ctx: providedCtx,
    conversionId,
    src,
    activityType,
    cat,
    consent,
    consentDefault,
    consentStrict = false,
    payloadDenylist,
    endpoint = FLOODLIGHT_CCM_COLLECT_ENDPOINT,
    activityEndpoint = FLOODLIGHT_ACTIVITY_ENDPOINT,
    onDiagnostic
  } = opts;
  const adStorageGranted = consent ? resolveConsent(consent, "ad_storage") === "granted" : true;
  const ctx = providedCtx ?? sourceGoogleAdsCtx({
    cookieString: typeof document !== "undefined" ? document.cookie : "",
    landingUrl: typeof document !== "undefined" && document.location ? document.location.href : "",
    adStorageGranted
  });
  const ctxWithConsent = { ...ctx, consent, consentDefault };
  const connectorConfig = { conversionId, src, type: activityType, cat, ctx: ctxWithConsent, endpoint, activityEndpoint };
  const hasActivityIdentity = src !== void 0 && src !== null;
  const endpoints = hasActivityIdentity ? [endpoint, deriveActivityCeilingEndpoint({ src, activityEndpoint })] : [endpoint];
  const airlock = createAirlock({
    connector: "floodlight",
    connectorConfig,
    endpoints,
    ctx: ctxWithConsent,
    consent,
    egressPurposes: consent ? FLOODLIGHT_EGRESS_PURPOSES : [],
    consentStrict,
    // 045-01 (ADR-0023 Option E): DC OPTS IN to hold-on-denied — grounded on R-009 §(b) (the container
    // held the WHOLE DC family under reject-all, "none — fully held"), mirrors bootGoogleAds/044-02.
    holdOnDenied: true,
    // The connector's KEY-AWARE held->grant-flush re-mapper (046-03/ADR-0024) — dispatches on the
    // seal's third `remap` argument (`remapKey: "ccm"`/`"activity"`) to rebuild the correct wire form
    // per beacon. `consentDefault` threaded too (mirrors bootGoogleAds' own fix-round correction) so a
    // held->flushed beacon's `gcd` matches a steady-state granted beacon's, for BOTH forms.
    remap: createFloodlightRemap({
      conversionId,
      src,
      type: activityType,
      cat,
      endpoint,
      activityEndpoint,
      consentDefault,
      readCookieString: () => typeof document !== "undefined" ? document.cookie : ""
    }),
    payloadDenylist,
    onDiagnostic
  });
  return {
    push: (evt) => airlock.push(evt),
    pushCritical: (evt) => airlock.pushCritical(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    getState: (path) => airlock.getState(path),
    flushNow: () => airlock.flushNow(),
    stats: () => airlock.stats(),
    dispose: () => airlock.dispose()
  };
}
var PIXEL_VENDORS = {
  // 026-04: `advancedMatching: true` marks the vendors whose connector supports
  // hashed `ud[...]` advanced matching — bootPixelConnector then sources
  // `external_id` host-side and exposes `setIdentity` for that vendor. Meta is
  // the grounded case; linkedin/bing stay identity-free (no flag -> byte-identical).
  meta: { createConfig: createMetaPixelConfig, egressPurposes: META_EGRESS_PURPOSES, advancedMatching: true },
  linkedin: { createConfig: createLinkedInInsightConfig, egressPurposes: LINKEDIN_EGRESS_PURPOSES },
  bing: { createConfig: createBingUetConfig, egressPurposes: BING_EGRESS_PURPOSES }
};
function bootPixelConnector(vendor, opts = {}) {
  const entry = PIXEL_VENDORS[vendor];
  if (!entry) {
    throw new Error(`airlock: unknown pixel vendor "${vendor}" (expected one of ${Object.keys(PIXEL_VENDORS).join(", ")})`);
  }
  const { consent, consentStrict = false, payloadDenylist, externalId, externalIdCookie, onDiagnostic, ...ids } = opts;
  const resolvedExternalId = entry.advancedMatching ? externalId != null && externalId !== "" ? String(externalId) : externalIdCookie ? getCookieValue(typeof document !== "undefined" ? document.cookie : "", externalIdCookie) : void 0 : void 0;
  const connectorConfig = entry.createConfig(
    resolvedExternalId != null && resolvedExternalId !== "" ? { ...ids, externalId: resolvedExternalId } : ids
  );
  const airlock = createAirlock({
    trackers: 1,
    workFactor: 0,
    endpoints: [connectorConfig.endpoint],
    ctx: {},
    // no host-sourced ctx crosses into a pixel instance (026-01 scope); advanced-matching identity rides the dedicated channel, not ctx
    connector: "pixel",
    connectorConfig,
    consent,
    egressPurposes: consent ? entry.egressPurposes : [],
    consentStrict,
    payloadDenylist,
    onDiagnostic
    // spec 028: inspector diagnostic sink pass-through (see bootGa4Core)
  });
  const handle = {
    push: (evt) => airlock.push(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    getState: (path) => airlock.getState(path),
    flushNow: () => airlock.flushNow(),
    stats: () => airlock.stats(),
    dispose: () => airlock.dispose()
  };
  if (entry.advancedMatching) handle.setIdentity = (raw) => airlock.setIdentity(raw);
  return handle;
}
async function bootMetaPixel(opts = {}) {
  return bootPixelConnector("meta", opts);
}
async function bootLinkedInInsight(opts = {}) {
  return bootPixelConnector("linkedin", opts);
}
async function bootBingUet(opts = {}) {
  return bootPixelConnector("bing", opts);
}
function bootHelixRum(opts = {}) {
  const {
    collectBaseURL = DEFAULT_COLLECT_BASE_URL,
    rate,
    weight: weightOverride,
    referer = typeof document !== "undefined" && document.referrer || "",
    forceSelect,
    onLCP: onLCPImpl = z,
    onCLS: onCLSImpl = F,
    onINP: onINPImpl = R,
    onDiagnostic
  } = opts;
  const weight = resolveWeight({ rate, weight: weightOverride });
  const id = crypto.randomUUID().slice(-9);
  const isSelected = forceSelect !== void 0 ? !!forceSelect : weight > 0 && Math.random() * weight < 1;
  const endpoint = rumUrl(collectBaseURL, weight);
  if (!isSelected) {
    const noop = () => {
    };
    return { push: noop, pushCritical: noop, setConsent: noop, getState: () => void 0, flushNow: noop, stats: () => ({}), dispose: noop, sampled: false };
  }
  const ctx = { referer };
  const airlock = createAirlock({
    connector: "helix-rum",
    // The worker connector gets the SAME sampling (id/weight/isSelected) so its
    // steady-state beacons match; `sampling` also drives the main-thread unload
    // mapper (mapToRum) via core/airlock.js's 030-01 criticalMapper selection.
    connectorConfig: { collectBaseURL, weight, id, isSelected: true, ctx, sampling: { weight, id } },
    endpoints: [endpoint],
    // host-owned ceiling (ADR-0006) — byte-matches the connector's endpoint
    ctx,
    egressPurposes: [],
    // RUM governance class: confined, NOT consent-gated (spec 022)
    trackers: 1,
    onDiagnostic
    // spec 028: inspector diagnostic sink pass-through (see bootGa4Core)
  });
  const push = (evt) => airlock.push(evt);
  push({ event: "top" });
  if (typeof addEventListener === "function") {
    addEventListener("error", (e2) => push({ event: "error", source: e2 && e2.filename, target: e2 && e2.message }));
    addEventListener("unhandledrejection", (e2) => push({ event: "error", source: "unhandledrejection", target: e2 && String(e2.reason) }));
    addEventListener("securitypolicyviolation", (e2) => push({ event: "error", source: e2 && e2.blockedURI, target: e2 && e2.violatedDirective }));
  }
  startCwvCapture({ push, onLCP: onLCPImpl, onCLS: onCLSImpl, onINP: onINPImpl });
  return {
    push,
    pushCritical: (evt) => airlock.pushCritical(evt),
    setConsent: (v2) => airlock.setConsent(v2),
    getState: (p2) => airlock.getState(p2),
    flushNow: () => airlock.flushNow(),
    stats: () => airlock.stats(),
    dispose: () => airlock.dispose(),
    sampled: true
  };
}
function decisionDiagnostic(record) {
  const fn = record.level === "error" ? console.error : console.warn;
  fn("airlock:", record);
}
function deriveDecisionScopes(placements, reserved) {
  const fromPlacements = Array.isArray(placements) ? placements.map((p2) => p2 && p2.scope) : [];
  const fromReserved = reserved && typeof reserved === "object" ? Object.keys(reserved) : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const s2 of [...fromPlacements, ...fromReserved]) {
    if (typeof s2 === "string" && s2 && !seen.has(s2)) {
      seen.add(s2);
      out.push(s2);
    }
  }
  return out;
}
function wireAlloyDecisions({ caps, reserved, diagnose, compositeEmit }) {
  const exposureReporter = createPropositionExposureReporter(
    {
      // The exposure routes through the WIRED composite-emit ref (034-03 AC2/AC3) — `{ accepts,
      // emit }` bound by boot() to THE composite this alloy booted under, NOT the mutable
      // window.airlock global (which a mid-session re-boot swaps — the reachable misroute this
      // fixes). The ref is deferred (populated after createComposite), so this closure reads it
      // LAZILY at report time. GATE via accepts("proposition_display") — the unambiguous
      // analytics-["*"]-sink signal (034-03 AC1, replacing 033-03's push count-return):
      //   - no ref / un-populated ref (a standalone bootAlloy, never wired) -> drop + diagnose;
      //   - ref present but accepts()===false (alloy-only boot, no ["*"] sink) -> drop + diagnose;
      //   - else emit() -> the composite fans the exposure to GA4 (["*"], captures); alloy's own
      //     ["page_view"] handle IGNORES it (no second interact / no proposition loop).
      // Either drop is never a throw: the DISPLAY already happened (fill); only exposure
      // TELEMETRY needs an analytics connector in the same boot(config) (documented, AC3).
      push: (evt) => {
        const ref = compositeEmit;
        if (!ref || typeof ref.accepts !== "function" || typeof ref.emit !== "function") {
          diagnose({ level: "warn", kind: "decisions", disposition: "exposure-dropped", reason: "no analytics sink for the proposition_display exposure (no wired composite-emit ref \u2014 a standalone bootAlloy)", scope: evt && evt.scope });
          return;
        }
        if (!ref.accepts(PROPOSITION_EXPOSURE_EVENT)) {
          diagnose({ level: "warn", kind: "decisions", disposition: "exposure-dropped", reason: "no analytics ['*'] sink accepted the proposition_display exposure (alloy-only boot) \u2014 the display works; exposure telemetry needs an analytics connector in the same boot(config)", scope: evt && evt.scope });
          return;
        }
        ref.emit(evt);
      }
    },
    { seen: /* @__PURE__ */ new Set() }
  );
  caps.decisions = {
    deliver: async (decisions) => {
      for (const decision of decisions || []) {
        const scope = decision && decision.scope;
        const handlePromise = scope != null ? reserved[scope] : void 0;
        if (!handlePromise) {
          diagnose({ level: "warn", kind: "decisions", disposition: "dropped", reason: "no reserved placement for this scope \u2014 the eager reservePersonalization was skipped/mis-wired, or the scope is unconfigured (NOT lazily reserved \u2014 that would reintroduce the flicker AC2 fixes)", scope });
          continue;
        }
        let handle;
        try {
          handle = await handlePromise;
        } catch (e2) {
          diagnose({ level: "warn", kind: "decisions", disposition: "dropped", reason: "the reserved placement handle rejected (selector matched nothing at reserve time) \u2014 the prehide-timeout backstop reveals the box", scope });
          continue;
        }
        const html = htmlOfDecision(decision);
        if (!html) {
          diagnose({ level: "warn", kind: "decisions", disposition: "dropped", reason: "the decision carried no renderable html-content-item (a JSON offer / redirect)", scope });
          continue;
        }
        handle.fill(html);
        exposureReporter.report(decision);
      }
    }
  };
}
async function bootAlloy(opts = {}) {
  const { bundleUrl, datastreamId, orgId, datastream, edgeConfigId, context = [], consent, payloadDenylist, workerUrl, reservedPlacements, compositeEmit } = opts;
  if (typeof bundleUrl !== "string" || bundleUrl.length === 0) {
    throw new Error("airlock bootAlloy: `bundleUrl` is required (the adopter-supplied stock @adobe/alloy bundle URL \u2014 ADR-0016)");
  }
  const resolvedDatastreamId = datastreamId ?? datastream ?? edgeConfigId;
  if (typeof resolvedDatastreamId !== "string" || resolvedDatastreamId.length === 0) {
    throw new Error("airlock bootAlloy: a datastream id is required (`datastreamId`, or its `datastream`/`edgeConfigId` alias) \u2014 alloy configure() + the config-integrity tenant pin both need it");
  }
  const worker = workerUrl ? new Worker(workerUrl) : new Worker(new URL("./alloy-chamber.worker.js", import.meta.url));
  const chamber = {
    postMessage: (msg) => worker.postMessage(msg),
    onMessage: (cb) => worker.addEventListener("message", (e2) => cb(e2.data))
  };
  const consentRef = consent ? { ...consent } : null;
  const caps = {
    egress: {
      // The ADR-0010 capability's orchestrator-side implementation: the REAL
      // main-thread fetch (ADR-0004). The host runs the endpoint/consent/config
      // gates BEFORE calling this, so a held interact never reaches the network.
      async dispatch(req) {
        const res = await fetch(req.url, { method: req.method || "POST", headers: req.headers || {}, body: req.body });
        const body = typeof res.text === "function" ? await res.text() : "";
        const ct = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : null;
        return { status: res.status, statusText: res.statusText, headers: { "content-type": ct || "application/json" }, body };
      }
    },
    cookies: {
      // The chamber's async cookie write-back (the server-assigned ECID), reconciled
      // by the host into a form the real jar accepts (Domain/Secure/SameSite dropped).
      reconcile: (reconciled) => {
        try {
          if (typeof document !== "undefined") document.cookie = reconciled;
        } catch (e2) {
        }
      }
    }
  };
  const diagnose = typeof opts.onDiagnostic === "function" ? opts.onDiagnostic : decisionDiagnostic;
  const reserved = reservedPlacements && typeof reservedPlacements === "object" ? reservedPlacements : {};
  const personalizationConfigured = Array.isArray(opts.placements) && opts.placements.length > 0 || Object.keys(reserved).length > 0;
  if (personalizationConfigured) wireAlloyDecisions({ caps, reserved, diagnose, compositeEmit });
  const host = createWrappedSdkHost({
    chamber,
    caps,
    // spec 028: thread the inspector's diagnostic sink onto THIS seam — critically,
    // config-integrity emits from createWrappedSdkHost ALONE (collector.js's three-seam
    // note), so an alloy boot that only wired createAirlock would leave the inspector
    // blind to re-tenant holds. Pass `opts.onDiagnostic` DIRECTLY, not the `diagnose`
    // wrapper above (which defaults to decisionDiagnostic): absent -> the host keeps its
    // own console fallback, so back-compat is byte-exact.
    onDiagnostic: opts.onDiagnostic,
    // ADR-0011 / spec 015 — the TRUSTED config-integrity TENANT pin. A cross-origin/untrusted
    // adopter bundle (ADR-0016) can re-`configure` alloy or craft its own interact fetch to an
    // ATTACKER's Adobe org; the seam pins the tenant to the host-owned datastream (`configId` on
    // adobedc.demdex.net — the live Edge routes by it, 013-03) and HOLDS (fail-closed) any
    // re-tenant. The pin is chamber-immutable (built here, on main), not chamber-supplied.
    configIntegrity: {
      pinnedHost: hostOf(ALLOY_INTERACT_ENDPOINT),
      tenantKey: "configId",
      pinnedTenant: resolvedDatastreamId,
      disposition: "hold"
    },
    // ADR-0006 / spec 016 — the host-owned endpoint CEILING, wired to the GROUNDED interact FLOOR
    // (016-02 AC3/AC5's accepted trade-off): the honest interact origin+path passes; any off-floor
    // destination is HELD. The un-grounded server-directed breadth (demdex/ID-sync URLs the Edge
    // response returns at runtime) is held+surfaced fail-closed — grounding that breadth is the
    // creds-gated live-Alloy follow-on (docs/refinement-todo.md), NOT a silent drop.
    endpointCeiling: [ALLOY_INTERACT_ENDPOINT],
    consent: consentRef,
    // 020-02: the TRUSTED strict seam gate. Gated on `consent` being wired (back-compat:
    // no consent → [] → gate off, byte-unchanged), mirroring every other boot.
    egressPurposes: consent ? ALLOY_EGRESS_PURPOSES : [],
    payloadDenylist,
    // spec 035-01 AC2/AC3 — the WRITE-side name-scope + validation gate, wired to
    // the SAME ALLOY_COOKIE_NAMES the READ-side seed filter uses (above) — one
    // source of truth, both enforcement seams.
    grantedCookieNames: ALLOY_COOKIE_NAMES
  });
  const decisionScopes = deriveDecisionScopes(opts.placements, reserved);
  const config = { datastreamId: resolvedDatastreamId, orgId, context, ...decisionScopes.length ? { decisionScopes } : {} };
  const rawSeedCookie = typeof document !== "undefined" && document.cookie || "";
  const seedCookie = scopeSeedCookies(rawSeedCookie, ALLOY_COOKIE_NAMES);
  host.init({ cookie: seedCookie, config, bundleUrl, consent });
  let tail = Promise.resolve();
  const enqueue = (event) => {
    const run = tail.then(() => host.driveEvent(event));
    tail = run.catch(() => {
    });
    return run;
  };
  const toDescriptor = (evt) => {
    const { event, ...params } = evt || {};
    return { type: event, params };
  };
  let disposed = false;
  return {
    push: (evt) => {
      enqueue(toDescriptor(evt));
    },
    // alloy's interact is a synchronous vendor round-trip (not a sync sendBeacon), so
    // pushCritical rides the SAME queued driveEvent — best-effort on unload; a true
    // unload fast path for the wrapped-SDK interact is a named follow-on.
    pushCritical: (evt) => {
      enqueue(toDescriptor(evt));
    },
    // spec 045-02 (ADR-0023): a mid-session consent update does BOTH halves, so a
    // grant that releases a pending hold is honored end-to-end:
    //   (a) mutate the TRUSTED seam's LIVE consent ref (the object the host reads
    //       per-interact) — so the flushed interact AND the set-consent request pass
    //       the strict seam gate (they are granted then), and the 034-01 strip re-derives;
    //   (b) drive alloy's OWN setConsent in the chamber (host.setConsent -> the
    //       {type:"setConsent"} message) — alloy natively FLUSHES its
    //       defaultConsent:"pending" queue (grounded: rig/alloy-consent-pending.mjs).
    // Gated on `consentRef` (opt-in via a boot that wired consent): a no-consent boot
    // leaves the gate off (egressPurposes stayed []) and posts NO chamber message —
    // byte-unchanged, mirroring every other connector.
    setConsent: (v2) => {
      if (!consentRef || !v2) return;
      Object.assign(consentRef, v2);
      host.setConsent(consentRef);
    },
    getState: () => host.getState(),
    stats: () => host.getState(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (worker && typeof worker.terminate === "function") worker.terminate();
    }
  };
}
var acceptsEvent = (events, name) => events.includes("*") || events.includes(name);
function createComposite(connectors) {
  return {
    // push/pushCritical FAN OUT (void — the public write-surface contract 032-01 established),
    // gated by each connector's declared vocabulary. (033-03 briefly overloaded these to RETURN
    // the fan-out count for the exposure sink's alloy-only detection; 034-03 AC1 reverted that in
    // favor of a scoped `accepts(name)` predicate — 037-01's 1.0 API pin (ADR-0017) then removed
    // `accepts` from the INSTALLED handle entirely (an internal fan-out detail, not part of the
    // frozen `window.airlock` surface, which is exactly `{ push, pushCritical, setConsent,
    // getState, flushNow, stats, dispose }`). `boot()` rebinds the alloy exposure reporter's
    // `compositeEmit.accepts` to a LOCAL predicate over `booted` instead — see `boot()` below.)
    push: (evt) => {
      const name = evt && evt.event;
      for (const c2 of connectors) if (acceptsEvent(c2.events, name)) c2.handle.push(evt);
    },
    pushCritical: (evt) => {
      const name = evt && evt.event;
      for (const c2 of connectors) {
        if (typeof c2.handle.pushCritical === "function" && acceptsEvent(c2.events, name)) c2.handle.pushCritical(evt);
      }
    },
    setConsent: (v2) => {
      for (const c2 of connectors) if (typeof c2.handle.setConsent === "function") c2.handle.setConsent(v2);
    },
    getState: (path) => connectors.length ? connectors[0].handle.getState(path) : void 0,
    flushNow: () => {
      for (const c2 of connectors) if (typeof c2.handle.flushNow === "function") c2.handle.flushNow();
    },
    stats: () => connectors.length ? connectors[0].handle.stats() : {},
    dispose: () => {
      for (const c2 of connectors) if (typeof c2.handle.dispose === "function") c2.handle.dispose();
    }
  };
}
var KNOWN_CONNECTOR_TYPES = ["ga4", "ga4-gtag", "pixel", "helix-rum", "alloy", "google-ads", "floodlight"];
var BOOT_CONFIG_TOP_LEVEL_FIELDS = ["connectors", "consent", "consentStrict", "payloadDenylist", "onetrust"];
var PIXEL_REQUIRED_ID = { meta: "pixelId", linkedin: "partnerId", bing: "tagId" };
function validateConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("airlock boot(config): config must be an object");
  }
  const { connectors, consent, consentStrict, payloadDenylist, onetrust } = config;
  if (connectors !== void 0 && !Array.isArray(connectors)) {
    throw new Error('airlock boot(config): "connectors" must be an array');
  }
  if (consent !== void 0 && (consent === null || typeof consent !== "object" || Array.isArray(consent))) {
    throw new Error('airlock boot(config): "consent" must be an object (a purpose -> state map)');
  }
  if (consentStrict !== void 0 && typeof consentStrict !== "boolean") {
    throw new Error('airlock boot(config): "consentStrict" must be a boolean');
  }
  if (payloadDenylist !== void 0 && (!Array.isArray(payloadDenylist) || payloadDenylist.some((k2) => typeof k2 !== "string"))) {
    throw new Error('airlock boot(config): "payloadDenylist" must be an array of strings');
  }
  if (onetrust !== void 0) {
    if (onetrust === null || typeof onetrust !== "object" || Array.isArray(onetrust)) {
      throw new Error('airlock boot(config): "onetrust" must be an object ({ groupPurposeMap, activeGroups? })');
    }
    const { groupPurposeMap } = onetrust;
    if (groupPurposeMap === void 0 || groupPurposeMap === null || typeof groupPurposeMap !== "object" || Array.isArray(groupPurposeMap)) {
      throw new Error('airlock boot(config): "onetrust.groupPurposeMap" must be an object (a group id -> purpose[] map)');
    }
  }
  for (const key of Object.keys(config)) {
    if (!BOOT_CONFIG_TOP_LEVEL_FIELDS.includes(key)) {
      throw new Error(
        `airlock boot(config): unknown config field ${JSON.stringify(key)} \u2014 expected one of: ${BOOT_CONFIG_TOP_LEVEL_FIELDS.join(", ")}`
      );
    }
  }
}
function validateConnectorEntry(entry, index) {
  const at = `connectors[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`airlock boot(config): ${at} must be a connector object`);
  }
  const { type } = entry;
  if (!KNOWN_CONNECTOR_TYPES.includes(type)) {
    throw new Error(
      `airlock boot(config): ${at} has unknown connector type ${JSON.stringify(type)} \u2014 expected one of: ${KNOWN_CONNECTOR_TYPES.join(", ")}`
    );
  }
  if (type === "pixel") {
    const idField = PIXEL_REQUIRED_ID[entry.vendor];
    if (!idField) {
      throw new Error(
        `airlock boot(config): ${at} (pixel) has unknown vendor ${JSON.stringify(entry.vendor)} \u2014 expected one of: ${Object.keys(PIXEL_REQUIRED_ID).join(", ")}`
      );
    }
    if (typeof entry[idField] !== "string" || entry[idField].length === 0) {
      throw new Error(
        `airlock boot(config): ${at} (pixel/${entry.vendor}) is missing required id field ${JSON.stringify(idField)} (a non-empty string)`
      );
    }
  }
  if (type === "ga4-gtag") {
    if (typeof entry.measurementId !== "string" || entry.measurementId.length === 0) {
      throw new Error(
        `airlock boot(config): ${at} (ga4-gtag) is missing required field "measurementId" (a non-empty string \u2014 the GA4 measurement id, "tid")`
      );
    }
  }
  if (type === "google-ads") {
    if (typeof entry.conversionId !== "string" || entry.conversionId.length === 0) {
      throw new Error(
        `airlock boot(config): ${at} (google-ads) is missing required field "conversionId" (a non-empty string \u2014 the AW conversion id, "tid")`
      );
    }
  }
  if (type === "floodlight") {
    if (typeof entry.conversionId !== "string" || entry.conversionId.length === 0) {
      throw new Error(
        `airlock boot(config): ${at} (floodlight) is missing required field "conversionId" (a non-empty string \u2014 the DC conversion id, "tid")`
      );
    }
  }
  if (type === "helix-rum" && "weight" in entry && typeof entry.weight !== "number") {
    throw new Error(`airlock boot(config): ${at} (helix-rum) field "weight" must be a number`);
  }
  if (type === "alloy") {
    if (typeof entry.bundleUrl !== "string" || entry.bundleUrl.length === 0) {
      throw new Error(`airlock boot(config): ${at} (alloy) is missing required field "bundleUrl" (a non-empty string \u2014 the adopter-supplied stock @adobe/alloy bundle URL, ADR-0016)`);
    }
    const dsId = entry.datastreamId ?? entry.datastream ?? entry.edgeConfigId;
    if (typeof dsId !== "string" || dsId.length === 0) {
      throw new Error(`airlock boot(config): ${at} (alloy) is missing a datastream id \u2014 set "datastreamId" (or its "datastream"/"edgeConfigId" alias); alloy configure() + the config-integrity tenant pin both require it`);
    }
    if ("placements" in entry && entry.placements !== void 0) {
      if (!Array.isArray(entry.placements)) {
        throw new Error(`airlock boot(config): ${at} (alloy) field "placements" must be an array of { scope, selector, minHeight }`);
      }
      for (const p2 of entry.placements) {
        if (!p2 || typeof p2 !== "object" || Array.isArray(p2)) {
          throw new Error(`airlock boot(config): ${at} (alloy) each placement must be an object { scope, selector, minHeight }`);
        }
        if (typeof p2.scope !== "string" || p2.scope.length === 0) {
          throw new Error(`airlock boot(config): ${at} (alloy) placement is missing required "scope" (a non-empty personalization scope string, e.g. "${VIEW_SCOPE}")`);
        }
        if (typeof p2.selector !== "string" || p2.selector.length === 0) {
          throw new Error(`airlock boot(config): ${at} (alloy) placement is missing required "selector" (a non-empty CSS selector string)`);
        }
        if (typeof p2.minHeight !== "number" || !Number.isFinite(p2.minHeight) || p2.minHeight < 0) {
          throw new Error(`airlock boot(config): ${at} (alloy) placement has a missing/invalid "minHeight" (a finite number >= 0 \u2014 the box's reserved height in px, sized before paint)`);
        }
      }
      const dup = firstDuplicateScope(entry.placements);
      if (dup) {
        throw new Error(`airlock boot(config): ${at} (alloy) has a duplicate placement scope ${JSON.stringify(dup)} \u2014 each scope may appear at most once (the scope\u2192placement map is keyed by scope; a duplicate would collapse last-wins)`);
      }
    }
  }
}
async function bootConnector(entry, governance, index, reservedPlacements, compositeEmit, onDiagnostic) {
  validateConnectorEntry(entry, index);
  const { type, onetrust: _ignoredPerConnectorOnetrust, ...rest } = entry || {};
  switch (type) {
    case "ga4":
      return { handle: await bootGa4Core({ ...rest, ...governance, onDiagnostic }), events: GA4_EVENTS };
    case "ga4-gtag":
      return { handle: await bootGa4Gtag({ ...rest, ...governance, onDiagnostic }), events: GA4_GTAG_EVENTS };
    case "google-ads":
      return { handle: await bootGoogleAds({ ...rest, ...governance, onDiagnostic }), events: GOOGLE_ADS_EVENTS };
    case "floodlight":
      return { handle: await bootFloodlight({ ...rest, ...governance, onDiagnostic }), events: FLOODLIGHT_EVENTS };
    case "pixel": {
      const { vendor, ...ids } = rest;
      const handle = bootPixelConnector(vendor, { ...ids, ...governance, onDiagnostic });
      const events = Object.keys(PIXEL_VENDORS[vendor].createConfig(ids).eventMap);
      return { handle, events };
    }
    case "helix-rum":
      return { handle: bootHelixRum({ ...rest, onDiagnostic }), events: HELIX_RUM_EVENTS };
    case "alloy":
      return { handle: await bootAlloy({ ...rest, ...governance, reservedPlacements, compositeEmit, onDiagnostic }), events: ALLOY_EVENTS };
    default:
      throw new Error(`airlock boot(config): unknown connector type ${JSON.stringify(type)}`);
  }
}
async function boot(config = {}, opts = {}) {
  validateConfig(config);
  const { connectors = [], consent, consentStrict, payloadDenylist, onetrust } = config;
  const globalWin = typeof window !== "undefined" ? window : void 0;
  const derivedConsent = onetrust ? resolveOnetrustBootConsent({ ...onetrust, win: globalWin }) : consent;
  const governance = { consent: derivedConsent, consentStrict, payloadDenylist };
  const reservedPlacements = opts && opts.reservedPlacements ? opts.reservedPlacements : void 0;
  const onDiagnostic = opts && opts.onDiagnostic;
  const compositeEmit = { accepts: null, emit: null };
  const booted = [];
  try {
    for (let i2 = 0; i2 < connectors.length; i2++) {
      booted.push(await bootConnector(connectors[i2], governance, i2, reservedPlacements, compositeEmit, onDiagnostic));
    }
  } catch (err) {
    for (const c2 of booted) {
      if (c2 && c2.handle && typeof c2.handle.dispose === "function") c2.handle.dispose();
    }
    throw err;
  }
  const composite = createComposite(booted);
  if (onetrust) {
    const unsubscribeOnetrust = subscribeOnetrustConsentChanges({
      onetrust: onetrust.onetrust ?? (globalWin && globalWin.OneTrust),
      win: onetrust.win ?? globalWin,
      groupPurposeMap: onetrust.groupPurposeMap,
      onChange: (vector) => composite.setConsent(vector)
    });
    const baseDispose = composite.dispose;
    composite.dispose = () => {
      unsubscribeOnetrust();
      baseDispose();
    };
  }
  compositeEmit.accepts = (name) => booted.some((c2) => acceptsEvent(c2.events, name));
  compositeEmit.emit = (evt) => composite.push(evt);
  return installOnWindow(composite);
}
var eds_default = bootEdsAnalytics;
export {
  BING_EGRESS_PURPOSES,
  LINKEDIN_EGRESS_PURPOSES,
  META_EGRESS_PURPOSES,
  UC2_EVENTS,
  boot,
  bootAlloy,
  bootBingUet,
  bootEdsAnalytics,
  bootFloodlight,
  bootGa4Gtag,
  bootGoogleAds,
  bootHelixRum,
  bootLinkedInInsight,
  bootMetaPixel,
  eds_default as default,
  wireBlocks,
  wireExposure,
  wireInteractions
};
