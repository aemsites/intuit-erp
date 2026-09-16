// adapters/eds/tag-suppressor.js
function compileMatcher(matcher) {
  if (!matcher || typeof matcher !== "object") return null;
  const host = typeof matcher.host === "string" ? matcher.host.trim().toLowerCase() : "";
  if (!host) return null;
  const pathname = typeof matcher.pathname === "string" && matcher.pathname.trim() ? matcher.pathname.trim() : null;
  let query = null;
  if (matcher.query && typeof matcher.query === "object") {
    const pairs = Object.entries(matcher.query).filter(([key]) => typeof key === "string" && key.length > 0).map(([key, value]) => (
      /** @type {[string, string]} */
      [key, String(value)]
    ));
    if (pairs.length) query = pairs;
  }
  return { host, pathname, query, source: matcher };
}
function compileMatchers(matchers) {
  return (Array.isArray(matchers) ? matchers : []).map(compileMatcher).filter(Boolean);
}
function matchesCompiled(url, compiled) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase() !== compiled.host) return false;
  if (compiled.pathname !== null && parsed.pathname !== compiled.pathname) return false;
  if (compiled.query) {
    for (const [key, value] of compiled.query) {
      if (parsed.searchParams.get(key) !== value) return false;
    }
  }
  return true;
}
function firstMatch(url, compiledMatchers) {
  for (const compiled of compiledMatchers) {
    if (matchesCompiled(url, compiled)) return compiled;
  }
  return null;
}
function shouldSuppressCompiled(url, { suppress = [], allow = [] } = {}) {
  const allowHit = firstMatch(url, allow);
  if (allowHit) return { suppressed: false, allowed: true, matcher: allowHit.source };
  const suppressHit = firstMatch(url, suppress);
  if (suppressHit) return { suppressed: true, allowed: false, matcher: suppressHit.source };
  return { suppressed: false, allowed: false, matcher: null };
}
function shouldSuppress(url, { suppress = [], allow = [] } = {}) {
  return shouldSuppressCompiled(url, {
    suppress: compileMatchers(suppress),
    allow: compileMatchers(allow)
  });
}
function shouldSuppressBeaconCompiled(url, { suppress = [], allow = [], transport, keepalive = false } = {}) {
  if (transport === "fetch" && keepalive === true) {
    return { suppressed: false, allowed: false, matcher: null, exempt: true };
  }
  const verdict = shouldSuppressCompiled(url, { suppress, allow });
  return { ...verdict, exempt: false };
}
function shouldSuppressBeacon(url, { suppress = [], allow = [], transport, keepalive = false } = {}) {
  return shouldSuppressBeaconCompiled(url, {
    suppress: compileMatchers(suppress),
    allow: compileMatchers(allow),
    transport,
    keepalive
  });
}
function suppressionDiagnostic(url, matcher, transport) {
  const m = matcher && typeof matcher === "object" ? matcher : {};
  const matcherHost = typeof m.host === "string" ? m.host : "";
  const matcherPathname = typeof m.pathname === "string" ? m.pathname : "";
  const matcherQuery = m.query && typeof m.query === "object" ? Object.entries(m.query).map(([key, value]) => `${key}=${value}`).join("&") : "";
  return {
    level: "warn",
    kind: "tag-suppressor",
    disposition: "suppressed",
    url,
    matcherHost,
    matcherPathname,
    matcherQuery,
    transport: typeof transport === "string" && transport ? transport : "script"
  };
}
var state = { compiledSuppress: [], compiledAllow: [], onDiagnostic: null, installed: false };
var xhrUrls = /* @__PURE__ */ new WeakMap();
function evaluateCandidate(node) {
  if (!node || node.nodeType !== 1) return null;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (tag !== "script") return null;
  const src = typeof node.src === "string" ? node.src : "";
  if (!src) return null;
  const verdict = shouldSuppressCompiled(src, { suppress: state.compiledSuppress, allow: state.compiledAllow });
  return verdict.suppressed ? { url: src, matcher: verdict.matcher, transport: "script" } : null;
}
function evaluateBeaconCandidate(url, transport, { keepalive = false } = {}) {
  if (!url) return null;
  const verdict = shouldSuppressBeaconCompiled(url, {
    suppress: state.compiledSuppress,
    allow: state.compiledAllow,
    transport,
    keepalive
  });
  return verdict.suppressed ? { url, matcher: verdict.matcher, transport } : null;
}
function diagnose(hit) {
  if (typeof state.onDiagnostic !== "function") return;
  try {
    state.onDiagnostic(suppressionDiagnostic(hit.url, hit.matcher, hit.transport));
  } catch {
  }
}
function resolveUrl(value) {
  try {
    return new URL(String(value), document.baseURI).href;
  } catch {
    return null;
  }
}
function extractSrcsetUrls(value) {
  return String(value).split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}
function isImgSrcAttr(el, name) {
  if (!el || typeof el.tagName !== "string" || el.tagName.toUpperCase() !== "IMG") return false;
  const n = typeof name === "string" ? name.toLowerCase() : "";
  return n === "src" || n === "srcset";
}
function evaluateImgWrite(name, value) {
  const candidates = String(name).toLowerCase() === "srcset" ? extractSrcsetUrls(value) : [String(value)];
  for (const raw of candidates) {
    const resolved = resolveUrl(raw);
    if (!resolved) continue;
    const hit = evaluateBeaconCandidate(resolved, "img");
    if (hit) return hit;
  }
  return null;
}
function resolveFetchInputUrl(input) {
  if (typeof input === "string") return resolveUrl(input);
  if (typeof URL !== "undefined" && input instanceof URL) return resolveUrl(input.href);
  if (input && typeof input.url === "string") return resolveUrl(input.url);
  return null;
}
function patchMethod(proto, name, makeWrapped) {
  if (!proto) return;
  const existing = proto[name];
  if (typeof existing !== "function" || existing.__airlockTagSuppressorPatched) return;
  const wrapped = makeWrapped(existing);
  wrapped.__airlockTagSuppressorPatched = true;
  wrapped.__airlockTagSuppressorNative = existing;
  proto[name] = wrapped;
}
function unpatchMethod(proto, name) {
  if (!proto) return;
  const current = proto[name];
  if (current && current.__airlockTagSuppressorPatched && typeof current.__airlockTagSuppressorNative === "function") {
    proto[name] = current.__airlockTagSuppressorNative;
  }
}
function patchAccessorSetter(proto, name, makeWrappedSetter) {
  if (!proto) return;
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  if (!descriptor || typeof descriptor.set !== "function" || descriptor.set.__airlockTagSuppressorPatched) return;
  const wrappedSet = makeWrappedSetter(descriptor.set);
  wrappedSet.__airlockTagSuppressorPatched = true;
  wrappedSet.__airlockTagSuppressorNative = descriptor.set;
  Object.defineProperty(proto, name, { ...descriptor, set: wrappedSet });
}
function unpatchAccessorSetter(proto, name) {
  if (!proto) return;
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  if (descriptor && descriptor.set && descriptor.set.__airlockTagSuppressorPatched) {
    Object.defineProperty(proto, name, { ...descriptor, set: descriptor.set.__airlockTagSuppressorNative });
  }
}
function patchAll() {
  patchMethod(
    Node.prototype,
    "appendChild",
    (native) => function appendChild(child) {
      const hit = evaluateCandidate(child);
      if (hit) {
        diagnose(hit);
        return child;
      }
      return native.call(this, child);
    }
  );
  patchMethod(
    Node.prototype,
    "insertBefore",
    (native) => function insertBefore(newNode, referenceNode) {
      const hit = evaluateCandidate(newNode);
      if (hit) {
        diagnose(hit);
        return newNode;
      }
      return native.call(this, newNode, referenceNode);
    }
  );
  patchMethod(
    Node.prototype,
    "replaceChild",
    (native) => function replaceChild(newChild, oldChild) {
      const hit = evaluateCandidate(newChild);
      if (hit) {
        diagnose(hit);
        return oldChild;
      }
      return native.call(this, newChild, oldChild);
    }
  );
  patchMethod(
    Element.prototype,
    "append",
    (native) => function append(...nodes) {
      const kept = [];
      for (const n of nodes) {
        const hit = evaluateCandidate(n);
        if (hit) diagnose(hit);
        else kept.push(n);
      }
      return native.apply(this, kept);
    }
  );
  patchMethod(
    Element.prototype,
    "prepend",
    (native) => function prepend(...nodes) {
      const kept = [];
      for (const n of nodes) {
        const hit = evaluateCandidate(n);
        if (hit) diagnose(hit);
        else kept.push(n);
      }
      return native.apply(this, kept);
    }
  );
  patchMethod(
    Element.prototype,
    "insertAdjacentElement",
    (native) => function insertAdjacentElement(position, element) {
      const hit = evaluateCandidate(element);
      if (hit) {
        diagnose(hit);
        return null;
      }
      return native.call(this, position, element);
    }
  );
  patchMethod(
    Element.prototype,
    "setAttribute",
    (native) => function setAttribute(name, value) {
      if (isImgSrcAttr(this, name)) {
        const hit = evaluateImgWrite(name, value);
        if (hit) {
          diagnose(hit);
          return;
        }
      }
      return native.call(this, name, value);
    }
  );
  if (typeof HTMLImageElement !== "undefined") {
    patchAccessorSetter(
      HTMLImageElement.prototype,
      "src",
      (nativeSet) => function(value) {
        const hit = evaluateImgWrite("src", value);
        if (hit) {
          diagnose(hit);
          return;
        }
        return nativeSet.call(this, value);
      }
    );
    patchAccessorSetter(
      HTMLImageElement.prototype,
      "srcset",
      (nativeSet) => function(value) {
        const hit = evaluateImgWrite("srcset", value);
        if (hit) {
          diagnose(hit);
          return;
        }
        return nativeSet.call(this, value);
      }
    );
  }
  if (typeof Navigator !== "undefined") {
    patchMethod(
      Navigator.prototype,
      "sendBeacon",
      (native) => function sendBeacon(url, data) {
        const hit = evaluateBeaconCandidate(resolveUrl(url), "sendBeacon");
        if (hit) {
          diagnose(hit);
          return true;
        }
        return native.call(this, url, data);
      }
    );
  }
  if (typeof XMLHttpRequest !== "undefined") {
    patchMethod(
      XMLHttpRequest.prototype,
      "open",
      (native) => function open(method, url, ...rest) {
        xhrUrls.set(this, resolveUrl(url));
        return native.call(this, method, url, ...rest);
      }
    );
    patchMethod(
      XMLHttpRequest.prototype,
      "send",
      (native) => function send(body) {
        const hit = evaluateBeaconCandidate(xhrUrls.get(this), "xhr");
        if (hit) {
          diagnose(hit);
          return;
        }
        return native.call(this, body);
      }
    );
  }
  patchMethod(
    globalThis,
    "fetch",
    (native) => function fetch(input, init) {
      const keepalive = !!(init && init.keepalive === true);
      const resolved = resolveFetchInputUrl(input);
      if (!resolved) return native.call(globalThis, input, init);
      const hit = evaluateBeaconCandidate(resolved, "fetch", { keepalive });
      if (hit) {
        diagnose(hit);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return native.call(globalThis, input, init);
    }
  );
}
function unpatchAll() {
  if (typeof Node !== "undefined") {
    unpatchMethod(Node.prototype, "appendChild");
    unpatchMethod(Node.prototype, "insertBefore");
    unpatchMethod(Node.prototype, "replaceChild");
  }
  if (typeof Element !== "undefined") {
    unpatchMethod(Element.prototype, "append");
    unpatchMethod(Element.prototype, "prepend");
    unpatchMethod(Element.prototype, "insertAdjacentElement");
    unpatchMethod(Element.prototype, "setAttribute");
  }
  if (typeof HTMLImageElement !== "undefined") {
    unpatchAccessorSetter(HTMLImageElement.prototype, "src");
    unpatchAccessorSetter(HTMLImageElement.prototype, "srcset");
  }
  if (typeof Navigator !== "undefined") {
    unpatchMethod(Navigator.prototype, "sendBeacon");
  }
  if (typeof XMLHttpRequest !== "undefined") {
    unpatchMethod(XMLHttpRequest.prototype, "open");
    unpatchMethod(XMLHttpRequest.prototype, "send");
  }
  unpatchMethod(globalThis, "fetch");
}
function uninstall() {
  if (!state.installed) return;
  unpatchAll();
  state.installed = false;
  state.compiledSuppress = [];
  state.compiledAllow = [];
  state.onDiagnostic = null;
}
function installTagSuppressor({ suppress, allow, onDiagnostic } = {}) {
  state.compiledSuppress = compileMatchers(suppress);
  state.compiledAllow = compileMatchers(allow);
  state.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null;
  if (!state.installed) {
    if (typeof Node === "undefined" || typeof Element === "undefined") {
      return { uninstall() {
      } };
    }
    patchAll();
    state.installed = true;
  }
  return { uninstall };
}
export {
  compileMatcher,
  installTagSuppressor,
  shouldSuppress,
  shouldSuppressBeacon,
  shouldSuppressBeaconCompiled,
  shouldSuppressCompiled,
  suppressionDiagnostic
};
