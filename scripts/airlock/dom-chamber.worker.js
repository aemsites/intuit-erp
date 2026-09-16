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

// core/confine-dom-chamber.js
if (typeof self !== "undefined") {
  applyEgressConfinement(self, { withholdFetch: true });
}

// core/worker-dom/protocol.js
var DOCUMENT_ID = "document";
var BODY_ID = "body";
var OP = Object.freeze({
  CREATE_ELEMENT: "createElement",
  CREATE_TEXT: "createText",
  APPEND_CHILD: "appendChild",
  SET_ATTRIBUTE: "setAttribute",
  SET_STYLE: "setStyle",
  SET_TEXT: "setText",
  // Text.textContent= AND Element.textContent= both emit this (apply-side handling is identical)
  CLASS_ADD: "classAdd",
  CLASS_REMOVE: "classRemove",
  CLASS_TOGGLE: "classToggle",
  // spec 025-03 AC1 — the raw-HTML write surface a REAL tag (Prism) needs
  // beyond 025-02's structured subset. `html` is a plain string (never
  // parsed/walked by the mirror or this contract); it is gated by
  // `core/sanitize-html.js`'s sanitizer on apply (adapters/eds/dom-apply.js),
  // NOT by core/worker-dom/apply-policy.js's structured-op allowlist (AC3 —
  // "structured ops -> the allowlist; raw HTML -> the sanitizer").
  SET_INNER_HTML: "setInnerHTML"
});
function createMutationsMessage(ops) {
  return { type: "mutations", ops: Array.isArray(ops) ? ops : [] };
}

// core/worker-dom/mirror.js
function makeIdGenerator() {
  let n = 0;
  return () => `n${n++}`;
}
function createEventTargetMixin() {
  const listeners = /* @__PURE__ */ new Map();
  return {
    addEventListener(type, fn) {
      if (typeof fn !== "function") return;
      if (!listeners.has(type)) listeners.set(type, /* @__PURE__ */ new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatchEvent(evt) {
      const type = evt && evt.type;
      const set = listeners.get(type);
      if (!set) return true;
      for (const fn of Array.from(set)) fn.call(evt.currentTarget, evt);
      return true;
    }
  };
}
var MirrorStyle = class {
  /** @param {{__record:(op:object)=>void, __id:string}} node */
  constructor(node) {
    const store = {};
    return new Proxy(store, {
      get(target, prop) {
        if (typeof prop !== "string") return target[prop];
        return Object.prototype.hasOwnProperty.call(target, prop) ? target[prop] : "";
      },
      set(target, prop, value) {
        if (typeof prop !== "string") return true;
        const v = value == null ? "" : String(value);
        target[prop] = v;
        node.__record({ op: OP.SET_STYLE, id: node.__id, prop, value: v });
        return true;
      }
    });
  }
};
var MirrorClassList = class {
  /** @param {{__record:(op:object)=>void, __id:string}} node */
  constructor(node) {
    this.__node = node;
    this.__set = /* @__PURE__ */ new Set();
  }
  add(name) {
    if (!name || this.__set.has(name)) return;
    this.__set.add(name);
    this.__node.__record({ op: OP.CLASS_ADD, id: this.__node.__id, name });
  }
  remove(name) {
    if (!this.__set.has(name)) return;
    this.__set.delete(name);
    this.__node.__record({ op: OP.CLASS_REMOVE, id: this.__node.__id, name });
  }
  toggle(name, force) {
    const has = this.__set.has(name);
    const shouldHave = typeof force === "boolean" ? force : !has;
    if (shouldHave === has) return shouldHave;
    if (shouldHave) this.add(name);
    else this.remove(name);
    return shouldHave;
  }
  contains(name) {
    return this.__set.has(name);
  }
};
var MirrorNode = class {
  constructor(id, ctx) {
    this.__id = id;
    this.__ctx = ctx;
    this.__parentElement = null;
    Object.assign(this, createEventTargetMixin());
  }
  __record(op) {
    this.__ctx.record(op);
  }
  get parentElement() {
    return this.__parentElement;
  }
};
var MirrorText = class extends MirrorNode {
  constructor(id, text, ctx) {
    super(id, ctx);
    this.__text = text == null ? "" : String(text);
  }
  get textContent() {
    return this.__text;
  }
  set textContent(v) {
    this.__text = v == null ? "" : String(v);
    this.__record({ op: OP.SET_TEXT, id: this.__id, text: this.__text });
  }
};
var MirrorElement = class extends MirrorNode {
  constructor(id, tagName, ctx) {
    super(id, ctx);
    this.tagName = String(tagName || "").toUpperCase();
    this.__attrs = /* @__PURE__ */ new Map();
    this.children = [];
    this.style = new MirrorStyle(this);
    this.classList = new MirrorClassList(this);
    this.__text = "";
    this.__html = "";
  }
  get id() {
    return this.__attrs.get("id") || "";
  }
  set id(value) {
    this.setAttribute("id", value);
  }
  // spec 025-03 AC1 — Prism's file-highlight plugin hook reads
  // `parent.nodeName.toLowerCase()`; a plain alias of tagName (real
  // Element.nodeName === Element.tagName for element nodes).
  get nodeName() {
    return this.tagName;
  }
  get textContent() {
    return this.__text;
  }
  set textContent(v) {
    this.__text = v == null ? "" : String(v);
    this.children = [];
    this.__record({ op: OP.SET_TEXT, id: this.__id, text: this.__text });
  }
  // spec 025-03 AC1 — the raw-HTML write surface a REAL tag (Prism) needs:
  // `Prism.highlightElement` finishes every pass with `element.innerHTML =
  // highlightedMarkup`. Records { op: setInnerHTML, id, html } — a plain
  // string, NEVER parsed/walked here (this mirror does not build a structured
  // subtree for it; the main-thread apply coordinator does the real DOM
  // write, sanitizer-gated — adapters/eds/dom-apply.js, spec 025-03 AC3).
  // Clears `children` (real innerHTML replaces the whole subtree) — mirrors
  // the SAME discipline `textContent`'s setter already applies above.
  get innerHTML() {
    return this.__html;
  }
  set innerHTML(html) {
    this.__html = html == null ? "" : String(html);
    this.children = [];
    this.__record({ op: OP.SET_INNER_HTML, id: this.__id, html: this.__html });
  }
  // spec 025-03 AC1 — className: a serviceable sync READ/WRITE
  // `Prism.util.getLanguage`/`setLanguage` exercise unconditionally on every
  // `Prism.highlightElement()` call. Backed by the SAME store as
  // `classList` (a Set, not the `class` ATTRIBUTE `setAttribute`/
  // `getAttribute` read/write) — real DOM's `className`/`classList` are two
  // views over ONE backing store, and Prism's own `setLanguage()` reads
  // className, strips a token via a regex REPLACE, writes className back,
  // THEN calls `classList.add()` in the SAME call; an attribute-backed (i.e.
  // classList-INDEPENDENT) className would silently LOSE the language class
  // after the first highlight pass (grounded by running Prism twice — see
  // test/worker-dom-mirror.test.js's "SURVIVES the exact Prism setLanguage()
  // sequence TWICE" + test/dom-chamber-host.test.js's two-click proof).
  // `setAttribute("class", …)`/`getAttribute("class")` stay a SEPARATE,
  // unrelated attribute store (unchanged 025-02 behavior) — Prism never
  // calls that path, so unifying it too is out of this slice's grounded need.
  get className() {
    return Array.from(this.classList.__set).join(" ");
  }
  set className(value) {
    const next = new Set(String(value == null ? "" : value).split(/\s+/).filter(Boolean));
    for (const name of Array.from(this.classList.__set)) {
      if (!next.has(name)) this.classList.remove(name);
    }
    for (const name of next) {
      if (!this.classList.__set.has(name)) this.classList.add(name);
    }
  }
  setAttribute(name, value) {
    const v = value == null ? "" : String(value);
    this.__attrs.set(String(name), v);
    this.__record({ op: OP.SET_ATTRIBUTE, id: this.__id, name: String(name), value: v });
  }
  getAttribute(name) {
    const key = String(name);
    return this.__attrs.has(key) ? this.__attrs.get(key) : null;
  }
  // spec 025-03 AC1 — Prism's file-highlight plugin hook reads
  // `parent.hasAttribute('tabindex')` before conditionally setting it.
  hasAttribute(name) {
    return this.__attrs.has(String(name));
  }
  // spec 025-03 AC1 — a minimal INERT stub (always false), grounded by
  // running Prism: its bundled file-highlight plugin hook
  // (`Prism.hooks.add('before-sanity-check', …)`) calls `element.matches()`
  // UNCONDITIONALLY on every `highlightElement()` call, not a path this
  // fixture chose (prism.js:1847). `false` is the semantically CORRECT
  // answer for every element this mirror ever hosts (none carry the plugin's
  // `data-src` attribute) — a LIB-COMPLETENESS gap (needs zero live-layout
  // info), NOT a model-inherent one (unlike offsetHeight/
  // getBoundingClientRect above); implementing a real CSS selector engine is
  // out of this mirror's minimal-subset scope (no `querySelector*`, per this
  // module's own header).
  matches() {
    return false;
  }
  appendChild(child) {
    this.children.push(child);
    if (child && typeof child === "object") child.__parentElement = this;
    this.__record({ op: OP.APPEND_CHILD, parentId: this.__id, childId: child.__id });
    return child;
  }
  append(...items) {
    for (const item of items) {
      if (item != null && typeof item === "object" && typeof item.__id === "string") {
        this.appendChild(item);
      } else {
        const t = this.__ctx.createText(item);
        this.appendChild(t);
      }
    }
  }
  // Inert sync-layout-read defaults (the Tier-0 boundary) — never throw.
  get offsetHeight() {
    return 0;
  }
  get offsetWidth() {
    return 0;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
};
var MirrorDocument = class {
  constructor() {
    const queue = [];
    const nextId = makeIdGenerator();
    const ctx = {
      record: (op) => queue.push(op),
      nextId,
      // shared so MirrorElement.append() can synthesize a text node for a
      // raw string arg without a circular import back to `document`.
      createText: (text) => {
        const id = nextId();
        const t = new MirrorText(id, text, ctx);
        ctx.record({ op: OP.CREATE_TEXT, id, text: t.textContent });
        return t;
      }
    };
    this.__ctx = ctx;
    this.__queue = queue;
    Object.assign(this, createEventTargetMixin());
    this.body = new MirrorElement(BODY_ID, "body", ctx);
  }
  createElement(tagName) {
    const id = this.__ctx.nextId();
    const el = new MirrorElement(id, tagName, this.__ctx);
    this.__ctx.record({ op: OP.CREATE_ELEMENT, id, tag: el.tagName.toLowerCase() });
    return el;
  }
  createTextNode(text) {
    return this.__ctx.createText(text);
  }
  // spec 025-03 AC1 — grounded by running Prism inside a REAL Worker (NOT
  // reachable from a Node/vitest unit test — see
  // test/worker-dom-mirror.test.js's own comment on why): once
  // `globalThis.document` is assigned, Prism's own environment-detection
  // (`_self`, prism.js:9-13) resolves to the REAL worker global object
  // (`typeof WorkerGlobalScope !== 'undefined' && self instanceof
  // WorkerGlobalScope` — true in an actual Worker, unlike Node), making
  // `_self.document` truthy — which UNCONDITIONALLY runs Prism's IE11
  // `currentScript()` fallback (prism.js:226-259) on every boot, regardless
  // of `Prism.manual`. That fallback calls `document.getElementsByTagName
  // ('script')`. An INERT, always-EMPTY result is the honest answer — this
  // mirror is a write-record, not a re-queryable tree (this module's own
  // header), so it cannot serve a genuine query read at all; an empty
  // result makes the fallback's `for` loop simply not iterate, falling
  // through to its own `return null` (there genuinely is no real `<script>`
  // tag for a `new Function()`-evaluated author source).
  getElementsByTagName() {
    return [];
  }
  drainMutations() {
    return this.__queue.splice(0, this.__queue.length);
  }
};
function createMirrorDocument() {
  const document = new MirrorDocument();
  return { document, drainMutations: () => document.drainMutations() };
}

// core/dom-chamber-host.js
function withGlobalDocument(doc, fn) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const prev = globalThis.document;
  globalThis.document = doc;
  try {
    return fn();
  } finally {
    if (hadOwn) globalThis.document = prev;
    else delete globalThis.document;
  }
}
function createDomChamberHost() {
  const { document: doc, drainMutations } = createMirrorDocument();
  function boot({ authorSource, elements, workUs }) {
    const src = String(authorSource).replaceAll("__ELEMENTS__", String(elements)).replaceAll("__WORK_US__", String(workUs));
    withGlobalDocument(doc, () => {
      new Function(src)();
    });
    return drainMutations();
  }
  function dispatchEvent({ targetId, eventType }) {
    withGlobalDocument(doc, () => {
      if (targetId === DOCUMENT_ID) {
        doc.dispatchEvent({ type: eventType, target: doc, currentTarget: doc });
      }
    });
    return drainMutations();
  }
  return { boot, dispatchEvent };
}

// core/dom-chamber.worker.js
if (typeof self !== "undefined") {
  const host = createDomChamberHost();
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === "init") {
      const ops = host.boot({ authorSource: m.authorSource, elements: m.elements, workUs: m.workUs });
      self.postMessage(createMutationsMessage(ops));
      return;
    }
    if (m.type === "event") {
      const ops = host.dispatchEvent({ targetId: m.targetId, eventType: m.eventType });
      self.postMessage(createMutationsMessage(ops));
    }
  };
}
