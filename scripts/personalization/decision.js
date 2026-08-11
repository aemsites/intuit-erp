import { getMetadata } from '../aem.js';

/** Base for the /api/* endpoints: `pzn-api-base` metadata or same-origin `/api`. */
export function apiBase() {
  return (getMetadata('pzn-api-base') || '/api').replace(/\/+$/, '');
}

/** Normalizes a fragment ref to a root-absolute path; null for empty. */
export function fragmentPath(ref) {
  if (!ref) return null;
  return ref.startsWith('/') ? ref : `/${ref}`;
}

/**
 * Calls a /api/<source> endpoint. Returns the parsed JSON, or null on any
 * non-ok / timeout / parse failure (fail-open — the caller shows the baseline).
 * @param {string} source e.g. 'de' or 'ixp?experimentId=1'
 * @param {{ method?: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal }} [opts]
 *   When `signal` is provided it is used directly for the fetch and no internal
 *   AbortController/timeout is created — the caller owns the deadline (e.g.
 *   runExperiment shares one controller across fetchDecision + swapMain so a
 *   slow decision can't leave a follow-on fetch its own fresh timeout budget).
 *   When omitted, behavior is unchanged: an internal AbortController aborts
 *   after `timeoutMs` (default 1000).
 * @returns {Promise<any | null>}
 */
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
    const res = await fetch(`${apiBase()}/${source}`, {
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

/**
 * Resolves to the promise's value, or undefined if it doesn't settle within ms
 * (fail-open). Used to bound an entire phase (e.g. runExperiment/
 * runPersonalization) even when something inside it — such as loadFragment,
 * which cannot be given an abort signal — might hang indefinitely.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any | undefined>}
 */
export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(resolve, () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
}

/**
 * Loads a fragment and injects it into a target element (replacing its children).
 * @param {Element} targetEl
 * @param {string} ref fragment reference (bare or root-absolute)
 * @param {{ loadFragment?: (path: string) => Promise<Element | null> }} [opts]
 * @returns {Promise<boolean>} true when applied
 */
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
