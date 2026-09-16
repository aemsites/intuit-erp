(() => {
  // core/connector-host.js
  function createConnectorHost(factory, config) {
    const connector = factory(config);
    let initStarted = false;
    let initResult;
    function init(caps2) {
      if (!initStarted) {
        initStarted = true;
        initResult = Promise.resolve(connector.init(caps2));
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

  // connectors/alloy/decisions.js
  var VIEW_SCOPE = "__view__";
  function extractDecisions(result, { scope = VIEW_SCOPE } = {}) {
    const propositions = result && Array.isArray(result.propositions) ? result.propositions : [];
    const out = [];
    for (const p of propositions) {
      if (!p || typeof p !== "object") continue;
      if (scope != null && p.scope !== scope) continue;
      out.push({ scope: p.scope, content: p });
    }
    return out;
  }

  // connectors/alloy/connector.js
  var ALLOY_INTERACT_ENDPOINT = "https://adobedc.demdex.net/ee/v1/interact";
  var ALLOY_COOKIE_NAMES = ["com.adobe.alloy.getTld", "kndctr_", "AMCV_", "demdex", "s_ecid"];
  var ALLOY_EVENTS = Object.freeze(["page_view"]);
  var ALLOY_EGRESS_PURPOSES = Object.freeze(["analytics_storage", "personalization"]);
  function createAlloyConnector(config = {}) {
    const {
      datastreamId,
      orgId,
      context = [],
      // [] disables ambient auto-collection — the chamber is headless (R-004)
      alloy,
      // the injected command fn; defaults to the chamber's self.alloy global
      // spec 034-02: the personalization decision scopes the host declared (from
      // `placements[].scope`, derived by bootAlloy). Carried on the interact so alloy
      // fetches EVERY declared scope. `personalization.decisionScopes` is accepted +
      // merged too (alloy's own sendEvent merges both forms). Destructured OUT of
      // `configureExtras` so neither leaks into `configure` (they are sendEvent-only).
      decisionScopes,
      personalization,
      ...configureExtras
      // debugEnabled / edgeDomain / etc. pass through to configure
    } = config;
    const configuredScopes = mergeDecisionScopes(decisionScopes, personalization);
    let granted = null;
    function getAlloy() {
      const fn = typeof alloy === "function" ? alloy : typeof globalThis !== "undefined" ? globalThis.alloy : void 0;
      if (typeof fn !== "function") {
        throw new Error(
          "alloy command function is unavailable in the chamber \u2014 the bundle did not install `self.alloy` (or none was injected via config.alloy)"
        );
      }
      return fn;
    }
    const manifest = {
      name: "airlock/alloy",
      // MVP2 proof scope: one Analytics pageView (R-004 / the slice's AC).
      events: ALLOY_EVENTS,
      // The projection fields the pageView XDM maps (ADR-0003 default-deny).
      reads: ["page_view.params.page_location", "page_view.params.page_title"],
      capabilities: {
        // alloy persists first-party identity + the getTld apex probe cookie
        // synchronously (R-004) -> it requests cookie access, served by the AC3
        // sync-read surface (caps.cookies.sync) via the chamber's document shim.
        // spec 035-01 AC3: declared FROM the module-level export above — the
        // SAME array reference — so this manifest and the host-side enforcement
        // seams can never drift apart.
        cookies: ALLOY_COOKIE_NAMES,
        // it emits one interact request (captured in-chamber this slice).
        egress: true,
        // it returns Target personalization as data for the host to apply (012-03).
        decisions: true
      },
      // 012-04 DECLARATION-SHAPE (declared, NOT enforced FROM HERE — the seal now EXISTS and
      // enforces (017-03/020-02/016-02), but reads the host-owned egressPurposes/endpointCeiling
      // wired in bootAlloy, NOT this manifest field; gating on the manifest itself is the tracked
      // "manifest mirror-drift" tightening, docs/inbox.md). ADVISORY endpoints (ADR-0006 — host
      // allow-list wins) — a FLOOR, not a complete map: the server-directed demdex/ID-sync
      // breadth is runtime-returned and creds-gated to MVP3 (see ALLOY_INTERACT_ENDPOINT).
      endpoints: [ALLOY_INTERACT_ENDPOINT],
      // ADR-0007 consent-purpose annotation: tags each declared endpoint / cookie /
      // read (and egress overall) with the purpose(s) it serves, so a grant resolves
      // per declared I/O — not per connector. DISCLOSURE ONLY in MVP2; the grant
      // resolver that reads it is MVP3 (ADR-0006 §Staging). Values are declared INTENT
      // grounded in alloy's functions (Adobe Analytics events, Target personalization,
      // ECID identity) + ADR-0007's Consent-Mode-v2 starter taxonomy — not a legal audit.
      purposes: {
        // Analytics events + the Target personalization query ride the same interact.
        egress: ALLOY_EGRESS_PURPOSES,
        endpoints: {
          [ALLOY_INTERACT_ENDPOINT]: ["analytics_storage", "personalization"]
        },
        cookies: {
          // apex-domain probe cookie — functional infrastructure, no data use.
          "com.adobe.alloy.getTld": ["functional"],
          // Adobe Edge consent/identity + Visitor ECID — a SHARED identity serving
          // BOTH analytics and personalization (ADR-0007: one I/O, several purposes).
          "kndctr_": ["analytics_storage", "personalization"],
          "AMCV_": ["analytics_storage", "personalization"],
          // third-party Audience Manager sync — ad/identity (server-directed; MVP3).
          "demdex": ["ad_storage"],
          // Analytics ECID mirror.
          "s_ecid": ["analytics_storage"]
        },
        reads: {
          "page_view.params.page_location": ["analytics_storage"],
          "page_view.params.page_title": ["analytics_storage"]
        }
      }
    };
    async function init(caps2) {
      granted = caps2 || null;
      await getAlloy()("configure", {
        datastreamId,
        orgId,
        context,
        ...configureExtras
      });
    }
    async function handle(event) {
      const options = {
        renderDecisions: false,
        // headless personalization: decisions as data (R-004)
        xdm: toXdm(event)
      };
      if (configuredScopes.length) {
        options.decisionScopes = configuredScopes;
        if (!configuredScopes.includes(VIEW_SCOPE)) {
          options.personalization = { defaultPersonalizationEnabled: false };
        }
      }
      const result = await getAlloy()("sendEvent", options);
      const decisions = extractDecisions(result, { scope: null });
      if (decisions.length && granted && granted.decisions && typeof granted.decisions.deliver === "function") {
        granted.decisions.deliver(decisions);
      }
      return [];
    }
    return { manifest, init, handle };
  }
  function mergeDecisionScopes(top, personalization) {
    const fromTop = Array.isArray(top) ? top : [];
    const fromPzn = personalization && Array.isArray(personalization.decisionScopes) ? personalization.decisionScopes : [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const s of [...fromTop, ...fromPzn]) {
      if (typeof s === "string" && s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }
  function toXdm(event) {
    const p = event && (event.params || event.payload) || {};
    return {
      eventType: "web.webpagedetails.pageViews",
      web: {
        webPageDetails: {
          URL: p.page_location || p.URL || "https://airlock.example/",
          name: p.page_title || p.name || "airlock"
        }
      }
    };
  }

  // connectors/alloy/sync-cookie-cache.js
  function createSyncCookieCache(seed = "", onWriteBack = () => {
  }) {
    let jar = typeof seed === "string" ? seed : "";
    function readSync() {
      return jar;
    }
    function writeSync(setCookie2) {
      const raw = String(setCookie2);
      const name = raw.split("=")[0].trim();
      const firstPair = raw.split(";")[0];
      const pairs = jar ? jar.split("; ").filter((p) => p.split("=")[0].trim() !== name) : [];
      pairs.push(firstPair);
      jar = pairs.join("; ");
      onWriteBack(raw);
    }
    return { readSync, writeSync };
  }

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

  // connectors/alloy/consent.js
  var PRIMARY_COLLECT_PURPOSE = "analytics_storage";
  function shapeAlloyConsent(vector) {
    if (vector == null) return void 0;
    const granted = resolveConsent(vector, PRIMARY_COLLECT_PURPOSE) === "granted";
    return {
      consent: [
        {
          standard: "Adobe",
          version: "2.0",
          value: { collect: { val: granted ? "y" : "n" } }
        }
      ]
    };
  }
  function shapeAlloyBoot(vector) {
    if (vector == null) {
      return { defaultConsent: void 0, setConsentOptions: void 0 };
    }
    if (resolveConsent(vector, PRIMARY_COLLECT_PURPOSE) === "pending") {
      return { defaultConsent: "pending", setConsentOptions: void 0 };
    }
    return { defaultConsent: void 0, setConsentOptions: shapeAlloyConsent(vector) };
  }

  // connectors/alloy/alloy-chamber.worker.js
  var summary = {
    booted: false,
    importScriptsRevoked: false,
    configureSettled: null,
    sendEventSettled: null,
    consentDriven: null,
    // 020-02: "fulfilled"/"rejected: …" once setConsent is driven; null if no consent vector was supplied (skipped)
    syncSurfacePresent: false,
    // caps.cookies.sync exists (AC3 additive surface)
    firstCookieRead: null,
    // { value, stack } — must be alloy's getApexDomain probe
    firstCookieReadServedFromSyncSurface: false,
    // the read went through caps.cookies.sync.readSync
    getTldProbeRoundTrip: false,
    // wrote the probe cookie then read it back (sync coherence)
    cookieReads: 0,
    cookieWrites: 0,
    writeBacks: 0,
    // async reconcile posts to the broker jar
    fetchCalls: [],
    // [{ via, url, method }] — AC4: every alloy fetch is INTERCEPTED
    workerRealFetchCalls: 0,
    // AC4: must stay 0 — the shim does NO real network fetch in the worker
    dropped: [],
    egressConfined: false,
    // AC5: applyEgressConfinement ran (allow-list posture active)
    egressConfinement: null
    // AC5: the record of what was withheld and how
  };
  function post(type, payload) {
    self.postMessage({ type, ...payload });
  }
  function shortStack() {
    return (new Error().stack || "").split("\n").slice(3, 8).map((l) => l.trim());
  }
  function loadStockBundle(bundleUrl) {
    let scriptUrl = bundleUrl;
    try {
      if (self.trustedTypes && typeof self.trustedTypes.createPolicy === "function") {
        const policy = self.trustedTypes.createPolicy("airlock-alloy", { createScriptURL: (s) => s });
        scriptUrl = policy.createScriptURL(bundleUrl);
      }
    } catch (e) {
      scriptUrl = bundleUrl;
    }
    self.importScripts(scriptUrl);
  }
  var cache = null;
  var caps = null;
  function buildCaps(seedCookie) {
    cache = createSyncCookieCache(seedCookie || "", (raw) => {
      summary.writeBacks++;
      post("cookie-writeback", { value: raw });
    });
    caps = {
      cookies: {
        get: async (name) => {
          const m = new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)").exec(cache.readSync());
          return m ? decodeURIComponent(m[1]) : null;
        },
        set: async (name, value, opts = {}) => {
          const attrs = [`${name}=${value}`];
          if (opts.maxAge != null) attrs.push(`max-age=${opts.maxAge}`);
          if (opts.path) attrs.push(`path=${opts.path}`);
          cache.writeSync(attrs.join("; "));
        },
        sync: { readSync: cache.readSync, writeSync: cache.writeSync }
      },
      storage: {
        get: async () => null,
        set: async () => {
        },
        remove: async () => {
        }
      },
      // 012-03: the decisions-as-data return channel. The connector calls
      // `deliver` with the Target decisions alloy returned (renderDecisions:false);
      // the chamber posts them to MAIN as DATA (the host applies them via
      // reserveSpace — the worker touches NO DOM, AC2). `fetch` is the deferred
      // capability.d.ts pull shape, reconciled to a no-op here since alloy PUSHES
      // decisions on the sendEvent response rather than answering a separate fetch.
      // Additive: 012-01/012-02 responses carry no propositions, so `deliver` is
      // never called there and no "decisions" message is posted.
      decisions: {
        deliver: (decisions) => {
          post("decisions", { decisions });
        },
        // 018-02 AC3 (refinement-todo.md item f): declared-not-built made LOUD —
        // mirrors adapters/eds/dom.js's insertAfterInteraction. alloy PUSHES
        // decisions via `deliver` on the sendEvent response; there is no pull
        // consumer, so a call rejects rather than silently resolving [], which
        // was ambiguous between "no decisions this cycle" and "not built".
        fetch: async () => {
          throw new Error("decisions.fetch: declared-not-built \u2014 alloy pushes via deliver; no pull consumer");
        }
      }
    };
    summary.syncSurfacePresent = typeof caps.cookies.sync.readSync === "function" && typeof caps.cookies.sync.writeSync === "function";
    return caps;
  }
  function makeStorage() {
    const m = /* @__PURE__ */ new Map();
    const api = {
      getItem: (k) => m.has(k) ? m.get(k) : null,
      setItem: (k, v) => {
        m.set(k, String(v));
      },
      removeItem: (k) => {
        m.delete(k);
      },
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      }
    };
    return new Proxy(api, {
      get(t, p) {
        if (p in t) return t[p];
        return m.get(p);
      },
      set(t, p, v) {
        m.set(p, String(v));
        return true;
      }
    });
  }
  function makeEl(tag) {
    return {
      tagName: String(tag || "div").toUpperCase(),
      style: {},
      dataset: {},
      setAttribute() {
      },
      getAttribute() {
        return null;
      },
      removeAttribute() {
      },
      appendChild(c) {
        return c;
      },
      insertBefore(c) {
        return c;
      },
      removeChild(c) {
        return c;
      },
      cloneNode() {
        return makeEl(tag);
      },
      addEventListener() {
      },
      removeEventListener() {
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      remove() {
      },
      setAttributeNS() {
      },
      contains() {
        return false;
      },
      classList: { add() {
      }, remove() {
      }, contains() {
        return false;
      } },
      childNodes: [],
      children: [],
      parentNode: null,
      firstChild: null
    };
  }
  function getCookie() {
    summary.cookieReads++;
    const value = caps.cookies.sync.readSync();
    if (!summary.firstCookieRead) {
      summary.firstCookieRead = { value, stack: shortStack() };
      summary.firstCookieReadServedFromSyncSurface = true;
    }
    return value;
  }
  function setCookie(v) {
    summary.cookieWrites++;
    caps.cookies.sync.writeSync(String(v));
    if (String(v).indexOf("com.adobe.alloy.getTld") === 0 && caps.cookies.sync.readSync().indexOf("com.adobe.alloy.getTld") !== -1) {
      summary.getTldProbeRoundTrip = true;
    }
  }
  var docBack = {
    referrer: "",
    title: "airlock",
    visibilityState: "visible",
    hidden: false,
    readyState: "complete",
    documentElement: makeEl("html"),
    head: makeEl("head"),
    body: makeEl("body"),
    location: null,
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createDocumentFragment: () => makeEl("#fragment"),
    createTextNode: () => ({ nodeType: 3 }),
    getElementsByTagName: () => [],
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {
    },
    removeEventListener: () => {
    },
    dispatchEvent: () => true
  };
  var documentShim = new Proxy(docBack, {
    get(t, p) {
      if (p === "cookie") return getCookie();
      if (p in t) return t[p];
      return void 0;
    },
    set(t, p, v) {
      if (p === "cookie") {
        setCookie(v);
        return true;
      }
      t[p] = v;
      return true;
    }
  });
  var locationShim = {
    href: "https://airlock.example/",
    origin: "https://airlock.example",
    protocol: "https:",
    host: "airlock.example",
    hostname: "airlock.example",
    port: "",
    pathname: "/",
    search: "",
    hash: "",
    toString() {
      return this.href;
    }
  };
  docBack.location = locationShim;
  var navBack = {
    userAgent: self.navigator && self.navigator.userAgent || "airlock-chamber",
    language: "en-US",
    languages: ["en-US"],
    cookieEnabled: true,
    onLine: true,
    doNotTrack: null,
    sendBeacon: (url) => {
      summary.fetchCalls.push({ via: "sendBeacon", url: String(url) });
      return true;
    }
  };
  var navigatorShim = new Proxy(navBack, {
    get(t, p) {
      if (p in t) return t[p];
      try {
        const r = self.navigator && self.navigator[p];
        if (r !== void 0) return typeof r === "function" ? r.bind(self.navigator) : r;
      } catch (e) {
      }
      return void 0;
    }
  });
  var realWorkerFetch = typeof self.fetch === "function" ? self.fetch.bind(self) : null;
  function guardedRealFetch(...args) {
    summary.workerRealFetchCalls++;
    return realWorkerFetch ? realWorkerFetch(...args) : Promise.reject(new Error("no real fetch in chamber"));
  }
  var pendingFetches = /* @__PURE__ */ new Map();
  var fetchSeq = 0;
  function normalizeHeaders(h) {
    if (!h) return {};
    if (typeof h.forEach === "function" && !(h instanceof Array)) {
      const o = {};
      h.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    }
    try {
      return { ...h };
    } catch (e) {
      return {};
    }
  }
  self.fetch = (url, opts = {}) => {
    const isReq = typeof url === "object" && url;
    const u = String(isReq ? url.url : url);
    const method = String(opts.method || isReq && url.method || "GET").toUpperCase();
    const headers = normalizeHeaders(opts.headers || isReq && url.headers);
    let body = opts.body != null ? opts.body : isReq ? url.body : void 0;
    if (body != null && typeof body !== "string") {
      try {
        body = String(body);
      } catch (e) {
        body = void 0;
      }
    }
    summary.fetchCalls.push({ via: "intercepted-to-main", url: u, method });
    const id = "af-" + ++fetchSeq;
    return new Promise((resolve, reject) => {
      pendingFetches.set(id, { resolve, reject });
      try {
        post("intercepted-fetch", { id, url: u, method, headers, body });
      } catch (err) {
        pendingFetches.delete(id);
        guardedRealFetch(url, opts).then(resolve, reject);
      }
    });
  };
  function resolveInterceptedFetch(m) {
    const pending = pendingFetches.get(m.id);
    if (!pending) return;
    pendingFetches.delete(m.id);
    try {
      if (m.status === 0) throw new Error(m.statusText || "main-thread dispatch failed");
      pending.resolve(new Response(m.body != null ? m.body : "", {
        status: m.status || 200,
        statusText: m.statusText || "",
        headers: m.headers || { "content-type": "application/json" }
      }));
    } catch (err) {
      pending.reject(err);
    }
  }
  var winBack = {
    __alloyNS: ["alloy"],
    document: documentShim,
    location: locationShim,
    navigator: navigatorShim,
    screen: { width: 1280, height: 800, availWidth: 1280, availHeight: 800, colorDepth: 24, pixelDepth: 24, orientation: { type: "landscape-primary", angle: 0 } },
    innerWidth: 1280,
    innerHeight: 800,
    outerWidth: 1280,
    outerHeight: 800,
    devicePixelRatio: 1,
    screenX: 0,
    screenY: 0,
    Intl: self.Intl,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    Date,
    Error,
    RegExp,
    Map,
    Set,
    WeakMap,
    Symbol,
    setTimeout: (...a) => self.setTimeout(...a),
    clearTimeout: (...a) => self.clearTimeout(...a),
    setInterval: (...a) => self.setInterval(...a),
    clearInterval: (...a) => self.clearInterval(...a),
    queueMicrotask: (...a) => self.queueMicrotask(...a),
    requestAnimationFrame: (cb) => self.setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: (id) => self.clearTimeout(id),
    addEventListener: () => {
    },
    removeEventListener: () => {
    },
    dispatchEvent: () => true,
    fetch: self.fetch,
    performance: self.performance,
    crypto: self.crypto,
    atob: self.atob ? self.atob.bind(self) : void 0,
    btoa: self.btoa ? self.btoa.bind(self) : void 0,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {
    }, removeEventListener() {
    }, addListener() {
    }, removeListener() {
    } }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    MutationObserver: class {
      observe() {
      }
      disconnect() {
      }
      takeRecords() {
        return [];
      }
    },
    IntersectionObserver: class {
      observe() {
      }
      disconnect() {
      }
      unobserve() {
      }
    },
    CustomEvent: class {
      constructor(t, o) {
        this.type = t;
        Object.assign(this, o);
      }
    },
    Event: class {
      constructor(t) {
        this.type = t;
      }
    }
  };
  var windowShim = new Proxy(winBack, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof self[p] !== "undefined") return typeof self[p] === "function" ? self[p].bind(self) : self[p];
      return void 0;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    }
  });
  winBack.window = windowShim;
  winBack.self = windowShim;
  winBack.top = windowShim;
  winBack.parent = windowShim;
  winBack.globalThis = windowShim;
  function install(seedCookie) {
    buildCaps(seedCookie);
    self.window = windowShim;
    self.document = documentShim;
    try {
      self.screen = winBack.screen;
    } catch (e) {
    }
    try {
      self.sessionStorage = winBack.sessionStorage;
    } catch (e) {
    }
    try {
      self.localStorage = winBack.localStorage;
    } catch (e) {
    }
    try {
      self.MutationObserver = winBack.MutationObserver;
    } catch (e) {
    }
    try {
      self.getComputedStyle = winBack.getComputedStyle;
    } catch (e) {
    }
    try {
      self.matchMedia = winBack.matchMedia;
    } catch (e) {
    }
    self.alloy = function() {
      const args = arguments;
      return new Promise((resolve, reject) => {
        (self.alloy.q = self.alloy.q || []).push([resolve, reject, args]);
      });
    };
    self.alloy.q = self.alloy.q || [];
    winBack.alloy = self.alloy;
    winBack.__alloyNS = self.__alloyNS = ["alloy"];
  }
  var host = null;
  var consentVector = null;
  async function boot({ cookie, config, bundleUrl, consent }) {
    try {
      install(cookie);
      post("phase", { name: "install" });
      consentVector = consent == null ? null : { ...consent };
      loadStockBundle(bundleUrl);
      summary.booted = true;
      try {
        self.importScripts = void 0;
        summary.importScriptsRevoked = true;
      } catch (e) {
      }
      const confinement = applyEgressConfinement(self);
      confinement.shimSendBeacon = denySendBeacon(navigatorShim);
      summary.egressConfinement = confinement;
      summary.egressConfined = confinement.fetchPreserved === true;
      post("phase", { name: "loaded" });
      const bootConsent = shapeAlloyBoot(consent);
      host = createConnectorHost(createAlloyConnector, {
        ...config || {},
        ...bootConsent.defaultConsent !== void 0 ? { defaultConsent: bootConsent.defaultConsent } : {},
        alloy: self.alloy
      });
      summary.syncSurfacePresent = summary.syncSurfacePresent && typeof host.manifest === "object" && Array.isArray(host.manifest.capabilities.cookies);
      try {
        await host.init(caps);
        summary.configureSettled = "fulfilled";
        const consentOptions = bootConsent.setConsentOptions;
        if (consentOptions) {
          try {
            await self.alloy("setConsent", consentOptions);
            summary.consentDriven = "fulfilled";
          } catch (e) {
            summary.consentDriven = "rejected: " + (e && e.message);
          }
        }
      } catch (e) {
        summary.configureSettled = "rejected: " + (e && e.message);
      }
      post("phase", { name: "configured", configureSettled: summary.configureSettled });
    } catch (err) {
      post("fatal", { phase: summary.booted ? "post-load" : "load", message: err && err.message, stack: err && err.stack || "", summary });
    }
  }
  async function drive(event) {
    try {
      const { ready, dropped } = await host.routeBatch([event]);
      summary.dropped = dropped;
      summary.sendEventSettled = dropped.length === 0 ? "fulfilled" : "rejected: " + (dropped[0] && dropped[0].reason);
      post("result", { summary, ready });
    } catch (err) {
      post("fatal", { phase: "sendEvent", message: err && err.message, stack: err && err.stack || "", summary });
    }
  }
  function applyConsent(vector) {
    if (vector) consentVector = { ...consentVector || {}, ...vector };
    post("phase", { name: "consent-updated" });
    const options = shapeAlloyBoot(consentVector).setConsentOptions;
    if (!options || typeof self.alloy !== "function") return;
    Promise.resolve().then(() => self.alloy("setConsent", options)).then(
      () => {
        summary.consentDriven = "fulfilled";
      },
      (e) => {
        summary.consentDriven = "rejected: " + (e && e.message);
      }
    );
  }
  var REMOTE_LOADER_KW = ["i", "m", "p", "o", "r", "t"].join("");
  var DATA_URI = ["d", "a", "t", "a"].join("") + ":";
  var remoteLoaderThunk = null;
  try {
    remoteLoaderThunk = new Function("u", "return " + REMOTE_LOADER_KW + "(u)");
  } catch (e) {
    remoteLoaderThunk = null;
  }
  async function probeRemoteLoader(url) {
    if (typeof remoteLoaderThunk !== "function") {
      return { attempted: true, reachable: false, outcome: "blocked", detail: "no runtime loader thunk (Function ctor unavailable)" };
    }
    let p;
    try {
      p = remoteLoaderThunk(url);
    } catch (e) {
      return { attempted: true, reachable: false, outcome: "blocked", detail: "loader threw synchronously: " + String(e && e.message || e) };
    }
    if (!p || typeof p.then !== "function") {
      return { attempted: true, reachable: false, outcome: "blocked", detail: "loader did not return a thenable" };
    }
    try {
      const mod = await p;
      return { attempted: true, reachable: true, outcome: "disclosed-residual", detail: "remote module loaded over the network", marker: mod && mod.MARKER || null };
    } catch (e) {
      return { attempted: true, reachable: true, outcome: "disclosed-residual", detail: "loader engaged; remote module load failed: " + String(e && e.message || e) };
    }
  }
  async function probeEgress(remoteLoaderUrl) {
    const probes = {};
    function attempt(key, fn) {
      try {
        const r = fn();
        probes[key] = { reachable: true, note: "usable \u2014 " + String(r) };
      } catch (e) {
        probes[key] = { reachable: false, error: String(e && e.message || e) };
      }
    }
    attempt("XMLHttpRequest", () => {
      const x = new self.XMLHttpRequest();
      x.open("GET", "https://egress.invalid/");
      return "constructed + open()";
    });
    attempt("WebSocket", () => {
      new self.WebSocket("wss://egress.invalid/");
      return "opened socket";
    });
    attempt("EventSource", () => {
      new self.EventSource("https://egress.invalid/");
      return "opened stream";
    });
    attempt("WebTransport", () => {
      new self.WebTransport("https://egress.invalid/");
      return "opened transport";
    });
    attempt("nested_Worker", () => {
      new self.Worker(DATA_URI + "application/javascript,0");
      return "spawned nested worker";
    });
    attempt("CacheStorage", () => {
      const p = self.caches.open("airlock-egress-probe");
      return p && typeof p.then === "function" ? "caches.open() returned a promise" : "caches.open() returned";
    });
    attempt("navigator_sendBeacon", () => {
      const nav = self.window && self.window.navigator || self.navigator;
      const ok = nav.sendBeacon("https://egress.invalid/", "x");
      return "sendBeacon returned " + String(ok);
    });
    attempt("importScripts", () => {
      self.__egressImportScriptsExecuted = false;
      self.importScripts(DATA_URI + "application/javascript,self.__egressImportScriptsExecuted=true");
      if (self.__egressImportScriptsExecuted !== true) throw new Error("importScripts present but injected code did not run");
      return "loaded + executed injected remote-style code";
    });
    const remoteLoader = await probeRemoteLoader(remoteLoaderUrl);
    return { probes, remoteLoader };
  }
  async function runEgressProbe(remoteLoaderUrl) {
    try {
      const { probes, remoteLoader } = await probeEgress(remoteLoaderUrl);
      post("egress-probe-result", { probes, remoteLoader, confinement: summary.egressConfinement || null });
    } catch (err) {
      post("egress-probe-result", {
        probes: { probeError: { reachable: false, error: String(err && err.message || err) } },
        remoteLoader: { attempted: false, reachable: false, outcome: "blocked", detail: "probe crashed: " + String(err && err.message || err) },
        confinement: summary.egressConfinement || null
      });
    }
  }
  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "init") return void boot(m);
    if (m.type === "event") return void drive(m.event);
    if (m.type === "setConsent") return void applyConsent(m.consent);
    if (m.type === "intercepted-fetch-response") return void resolveInterceptedFetch(m);
    if (m.type === "probe-egress") return void runEgressProbe(m.remoteLoaderUrl);
  };
})();
