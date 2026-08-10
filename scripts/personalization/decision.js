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
 * @param {{ method?: string, body?: unknown, timeoutMs?: number }} [opts]
 * @returns {Promise<any | null>}
 */
export async function fetchDecision(source, opts = {}) {
  const { method = 'GET', body, timeoutMs = 1000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}/${source}`, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
