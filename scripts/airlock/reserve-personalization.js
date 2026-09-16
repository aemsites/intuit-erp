// core/sanitize-html.js
var ACTIVE_URL_ATTRS = ["href", "src", "xlink:href", "formaction", "action", "background", "poster"];
var STRIPPED_TAGS = ["script", "iframe", "object", "embed", "base", "meta", "link"];
var DANGEROUS_URL_SCHEMES = ["javascript:", "vbscript:", "data:text/html"];
var CONTROL_OR_WHITESPACE_RE = /[\u0000-\u001F\u007F\s]+/g;
function isEventHandlerAttr(name) {
  return typeof name === "string" && /^on/i.test(name);
}
function isDangerousUrl(value) {
  if (typeof value !== "string") return false;
  const cleaned = value.replace(CONTROL_OR_WHITESPACE_RE, "").toLowerCase();
  return DANGEROUS_URL_SCHEMES.some((scheme) => cleaned.startsWith(scheme));
}
function isStrippedTag(tagName) {
  return typeof tagName === "string" && STRIPPED_TAGS.includes(tagName.trim().toLowerCase());
}
function defaultParse(html) {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html");
}
function collectElements(root) {
  const found = Array.from(root.querySelectorAll("*"));
  const all = [];
  for (const el of found) {
    all.push(el);
    if (el.content && typeof el.content.querySelectorAll === "function") {
      all.push(...collectElements(el.content));
    }
  }
  return all;
}
function stripActiveMarkup(doc) {
  const all = collectElements(doc);
  for (const el of all) {
    const names = Array.from(el.attributes || []).map((a) => a.name);
    for (const name of names) {
      if (isEventHandlerAttr(name)) {
        el.removeAttribute(name);
      } else if (ACTIVE_URL_ATTRS.includes(String(name).toLowerCase()) && isDangerousUrl(el.getAttribute(name))) {
        el.removeAttribute(name);
      }
    }
  }
  for (const el of all) {
    if (isStrippedTag(el.tagName) && el.parentNode && typeof el.parentNode.removeChild === "function") {
      el.parentNode.removeChild(el);
    }
  }
}
function sanitizeHtml(html, opts = {}) {
  if (typeof html !== "string" || html.length === 0) return "";
  const parse = typeof opts.parse === "function" ? opts.parse : defaultParse;
  let doc;
  try {
    doc = parse(html);
  } catch {
    return "";
  }
  if (!doc || !doc.body || typeof doc.querySelectorAll !== "function") return "";
  try {
    stripActiveMarkup(doc);
    return typeof doc.body.innerHTML === "string" ? doc.body.innerHTML : "";
  } catch {
    return "";
  }
}

// adapters/eds/dom.js
var RESERVED_ATTR = "data-airlock-reserved";
var FILLED_ATTR = "data-airlock-filled";
var DEFAULT_PREHIDE_TIMEOUT_MS = 3e3;
function normalizeReserveSpec(spec) {
  if (!spec || typeof spec !== "object") return null;
  const selector = typeof spec.selector === "string" ? spec.selector.trim() : "";
  const minHeight = Number(spec.minHeight);
  if (!selector) return null;
  if (!Number.isFinite(minHeight) || minHeight < 0) return null;
  return { selector, minHeight };
}
var ttPolicyCache;
function sanitizingTrustedTypesPolicy(sanitize) {
  if (ttPolicyCache !== void 0) return ttPolicyCache;
  ttPolicyCache = null;
  try {
    const tt = typeof trustedTypes !== "undefined" ? trustedTypes : typeof window !== "undefined" ? window.trustedTypes : void 0;
    if (tt && typeof tt.createPolicy === "function") {
      ttPolicyCache = tt.createPolicy("airlock-sanitize", { createHTML: (input) => sanitize(input) });
    }
  } catch {
    ttPolicyCache = null;
  }
  return ttPolicyCache;
}
function createDomCapability(doc = typeof document !== "undefined" ? document : void 0, opts = {}) {
  const now = opts.now || (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  const schedule = opts.schedule || ((fn, ms) => typeof setTimeout !== "undefined" ? setTimeout(fn, ms) : void 0);
  const sanitize = typeof opts.sanitize === "function" ? opts.sanitize : sanitizeHtml;
  const setContent = typeof opts.setContent === "function" ? opts.setContent : (el, content) => {
    try {
      const policy = sanitizingTrustedTypesPolicy(sanitize);
      el.innerHTML = policy ? policy.createHTML(content) : sanitize(content);
    } catch {
    }
  };
  let seq = 0;
  function reserveSpace(spec) {
    const n = normalizeReserveSpec(spec);
    if (!n) return Promise.reject(new Error("reserveSpace: invalid spec \u2014 { selector, minHeight>=0 } required"));
    if (!doc || typeof doc.querySelector !== "function") return Promise.reject(new Error("reserveSpace: no document"));
    let target;
    try {
      target = doc.querySelector(n.selector);
    } catch {
      return Promise.reject(new Error("reserveSpace: invalid selector: " + n.selector));
    }
    if (!target) return Promise.reject(new Error("reserveSpace: selector matched nothing: " + n.selector));
    const style = target.style || (target.style = {});
    style.minHeight = n.minHeight + "px";
    if (spec.grow !== true) {
      style.maxHeight = n.minHeight + "px";
      style.overflow = "clip";
    }
    const id = "reserve-" + ++seq + "-" + Math.random().toString(36).slice(2, 8);
    target.setAttribute(RESERVED_ATTR, id);
    const reservedAt = now();
    const prehide = spec.prehide !== false;
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      if (target.style) target.style.visibility = "visible";
    };
    if (prehide) {
      style.visibility = "hidden";
      const timeoutMs = typeof spec.timeout === "number" ? spec.timeout : DEFAULT_PREHIDE_TIMEOUT_MS;
      schedule(reveal, timeoutMs);
    }
    return Promise.resolve({
      id,
      reservedAt,
      /** Fill the PRE-RESERVED box with the decision content — the only mediated
       *  write path, and the box is already sized, so nothing around it moves. */
      fill(content) {
        if (typeof content === "string") setContent(target, content);
        target.setAttribute(FILLED_ATTR, "1");
        reveal();
      },
      /** Undo the reservation (release the min-height + the clip cap + markers,
       *  reveal). Symmetric with reserve: clears EVERY style reserve set —
       *  `minHeight` AND the `maxHeight`/`overflow:clip` the clip default adds
       *  (018-02 review) — so an un-reserved box is not left permanently
       *  height-capped + clipping later natural content. Blanking a property
       *  reserve never set (grow mode) is a harmless no-op. */
      release() {
        target.removeAttribute(RESERVED_ATTR);
        if (target.style) {
          target.style.minHeight = "";
          target.style.maxHeight = "";
          target.style.overflow = "";
        }
        reveal();
      }
    });
  }
  function insertAfterInteraction() {
    return Promise.reject(new Error("insertAfterInteraction: declared-not-built (no consumer in slice 012-03)"));
  }
  return { reserveSpace, insertAfterInteraction };
}

// adapters/eds/placements.js
function parsePlacements(config) {
  const connectors = config && Array.isArray(config.connectors) ? config.connectors : [];
  for (const entry of connectors) {
    if (!entry || entry.type !== "alloy" || !Array.isArray(entry.placements)) continue;
    const specs = [];
    for (const p of entry.placements) {
      if (!p || typeof p !== "object") continue;
      if (typeof p.scope !== "string" || !p.scope.trim()) continue;
      if (typeof p.selector !== "string" || !p.selector.trim()) continue;
      const spec = { scope: p.scope.trim(), selector: p.selector.trim(), minHeight: Number(p.minHeight) };
      if (p.prehide !== void 0) spec.prehide = p.prehide;
      if (p.timeout !== void 0) spec.timeout = p.timeout;
      specs.push(spec);
    }
    return specs;
  }
  return [];
}
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

// adapters/eds/reserve-personalization.js
function reservePersonalization(config, opts = {}) {
  const doc = opts.document || (typeof document !== "undefined" ? document : void 0);
  const specs = parsePlacements(config);
  if (!specs.length || !doc) return { reservedPlacements: {} };
  if (firstDuplicateScope(specs)) return { reservedPlacements: {} };
  const dom = createDomCapability(doc);
  const reservedPlacements = {};
  for (const spec of specs) {
    const handlePromise = dom.reserveSpace(spec);
    handlePromise.catch(() => {
    });
    reservedPlacements[spec.scope] = handlePromise;
  }
  return { reservedPlacements };
}
export {
  reservePersonalization
};
