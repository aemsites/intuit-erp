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

// Calls /api/<source>; returns parsed JSON, or null on any non-ok/timeout/parse
// failure (fail-open — caller shows the baseline). Forwards a page ?ivid= for QA.
// When `signal` is given the caller owns the deadline; otherwise a `timeoutMs`
// (default 1000) internal AbortController is used.
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
    let requestUrl = `${apiBase()}/${source}`;
    const pageIvid = new URLSearchParams(window.location.search).get('ivid');
    if (pageIvid) {
      requestUrl += `${requestUrl.includes('?') ? '&' : '?'}ivid=${encodeURIComponent(pageIvid)}`;
    }
    const res = await fetch(requestUrl, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
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
