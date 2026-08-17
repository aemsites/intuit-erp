import { getMetadata } from '../aem.js';

// Base for the /api/* endpoints: `pzn-api-base` metadata or same-origin `/api`.
export function apiBase() {
  return (getMetadata('pzn-api-base') || '/api').replace(/\/+$/, '');
}

// Normalizes a fragment ref to a root-absolute, same-origin path (null if empty).
// An absolute URL is reduced to its pathname to avoid a cross-origin .plain.html
// fetch (aem.live sends no CORS for it) and the "/https://…" double-URL bug.
export function fragmentPath(ref) {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) {
    try {
      return new URL(ref).pathname;
    } catch {
      return null;
    }
  }
  return ref.startsWith('/') ? ref : `/${ref}`;
}

// A per-request transaction id the pzn/ixp service correlates in its logs. Not a
// secret — the front-end supplies it now that no worker sits in front.
function intuitTid() {
  const rand = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `rp-${rand}`;
}

// Calls /api/<source>; returns parsed JSON, or null on any non-ok/timeout/parse
// failure (fail-open — caller shows the baseline). The visitor id + attributes are
// built by the caller (see attributes.js) — ivid lives in the IXP query / PZN body,
// not here. When `signal` is given the caller owns the deadline; otherwise a
// `timeoutMs` (default 1000) internal AbortController is used.
export async function fetchDecision(source, opts = {}) {
  const {
    method = 'GET', body, timeoutMs = 1000, signal: externalSignal,
  } = opts;
  let signal = externalSignal;
  let timer;
  if (!signal) {
    const controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const headers = { intuit_tid: intuitTid() };
    if (body) headers['content-type'] = 'application/json';
    // An absolute URL (e.g. a direct-endpoint override) is used verbatim; a bare
    // source is resolved under the same-origin /api base.
    const url = /^https?:\/\//i.test(source) ? source : `${apiBase()}/${source}`;
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Replaces <main>'s raw content with a variation page's plain.html so the caller's
// decorateMain decorates it. Bound by the caller's shared signal: fail-open, so a
// late/aborted swap can't clobber already-decorated content. Returns true when the
// swap lands. Shared by page-level IXP (exp.js) and page-level PZN (pzn.js).
export async function swapMain(doc, variationPath, signal) {
  const main = doc.querySelector('main');
  if (!main) return false;
  const path = fragmentPath(variationPath);
  if (!path) return false;
  try {
    const resp = await fetch(`${path}.plain.html`, { signal });
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
  }
}

// Resolves to the promise's value, or undefined if it doesn't settle within ms
// (fail-open) — bounds a whole phase even when something inside can't be aborted.
export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(resolve, () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
}

// Loads a fragment and replaces `targetEl`'s children with it. Returns true when applied.
export async function applyFragment(targetEl, ref, opts = {}) {
  const path = fragmentPath(ref);
  if (!targetEl || !path) return false;
  try {
    const load = opts.loadFragment
      // eslint-disable-next-line import/no-cycle
      || (await import('../../blocks/fragment/fragment.js')).loadFragment;
    const frag = await load(path);
    if (!frag) return false;
    targetEl.replaceChildren(...frag.childNodes);
    return true;
  } catch {
    return false;
  }
}
