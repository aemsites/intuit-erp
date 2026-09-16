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

// core/confine-helix-rum-chamber.js
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

// connectors/helix-rum/connector.js
var DEFAULT_COLLECT_BASE_URL = "https://ot.aem.live";
var DEFAULT_WEIGHT = RATE_WEIGHTS.medium;
var HELIX_RUM_EVENTS = Object.freeze(["top", "error", "cwv"]);
function createHelixRumConnector(config = {}) {
  const {
    collectBaseURL = DEFAULT_COLLECT_BASE_URL,
    rate,
    weight: weightConfig,
    ctx = {},
    // 030-02: OPTIONAL main-thread-minted sampling overrides. When airlock runs
    // this connector in a chamber, the SAME per-page `{weight, id, isSelected}`
    // must also drive the main-thread unload dispatcher (mapToRum) + the endpoint
    // ceiling — so `bootHelixRum` mints them ONCE on the main thread and passes
    // them here, keeping main↔worker byte-identical. Absent (022's own seam tests),
    // they fall back to per-construction generation — byte-unchanged.
    id: idOverride,
    isSelected: isSelectedOverride
  } = config;
  const weight = resolveWeight({ rate, weight: weightConfig });
  const id = idOverride || crypto.randomUUID().slice(-9);
  const isSelected = isSelectedOverride !== void 0 ? isSelectedOverride : weight > 0 && Math.random() * weight < 1;
  const endpoint = rumUrl(collectBaseURL, weight);
  const manifest = {
    name: "airlock/helix-rum",
    // 022-01 shipped the `top`/page-view checkpoint only. 022-02 widened to
    // the `error` checkpoints (3 window listeners — error/
    // unhandledrejection/securitypolicyviolation, aem.js:68-92). 022-04
    // (this slice) widens again to `cwv` (LCP/CLS/INP via
    // `connectors/helix-rum/cwv-capture.js`'s new `web-vitals/attribution`
    // main-thread capture — 022-01's grounding showed the enhancer itself
    // can't host in a chamber). The remaining interaction/lifecycle
    // enhancer checkpoints stay out of scope (022-05).
    events: HELIX_RUM_EVENTS,
    reads: [],
    // RUM reads no projection snapshot field — only host-sourced ctx.referer
    capabilities: {
      // NO cookie capability requested — `id` is ephemeral/per-page (never
      // persisted), unlike GA4's _ga/_ga_ or alloy's kndctr_/AMCV_/demdex.
      egress: true
    },
    // ADR-0006 ADVISORY endpoint — the host allow-list (core/airlock.js's
    // endpoint ceiling) is authoritative. Computed from the SAME
    // {collectBaseURL, weight} handle() uses, so the ceiling's origin+pathname
    // exact-match (core/endpoint-ceiling.js) matches the runtime URL byte-for-byte.
    endpoints: [endpoint],
    // ADR-0007 purpose annotation — DELIBERATELY EMPTY egress purposes (not
    // omitted): RUM's governance class is "NOT consent-gated" (spec 022 §
    // Governance class, maintainer 2026-08-31) — a conscious declaration, not a
    // missing one. The empty array documents "no consent purpose governs this
    // egress"; core/airlock.js's seal skips the consent gate on the CALLER's
    // (not this manifest's) empty `egressPurposes` config — see this file's
    // header and the seam tests (test/helix-rum-seam.test.js).
    purposes: {
      egress: [],
      endpoints: { [endpoint]: [] }
    }
  };
  function init(_caps) {
  }
  function handle(event) {
    if (!isSelected) return [];
    const body = mapToRum(event, ctx, { weight, id });
    return [{ url: endpoint, body: JSON.stringify(body) }];
  }
  return { manifest, init, handle };
}

// core/helix-rum-chamber.worker.js
var host = null;
var initPromise = null;
if (typeof self !== "undefined") {
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const { type, ...config } = m;
      host = createConnectorHost(createHelixRumConnector, config);
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
