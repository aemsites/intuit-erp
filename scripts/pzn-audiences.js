/**
 * Intuit "remote" audiences for the aem-experimentation plugin.
 *
 * Personalization/experimentation decisions are Intuit's, resolved server-side by
 * the edge worker (which hides the API key and reads the visitor `ivid` cookie).
 * The plugin applies them client-side by resolving these audiences:
 *
 * - `remote` — the gate for Decision Engine slot personalization. The per-visitor
 *   offer is carried by the worker-served Audience Manifest (`/api/pzn-manifest.json`,
 *   referenced from the page's `Audience Manifest` metadata), so membership is
 *   unconditional: if a manifest row exists for a slot, its offer applies.
 * - `ixptreatment` (and friends) — reflect a sticky IXP assignment. `/api/audiences`
 *   returns the visitor's resolved audience tokens for the page's experiment; the
 *   plugin renders the matching variant (e.g. a page-level redirect A/B).
 *
 * One memoized round trip to `/api/audiences` backs every IXP-token audience, so a
 * page with several remote audiences still calls the worker once. The DE `remote`
 * gate makes no call. Same-origin fetch carries the `ivid` cookie and the Referer,
 * which the worker needs; a tight timeout falls back to "no decision" (control).
 */

const AUDIENCES_ENDPOINT = '/api/audiences';
const TIMEOUT_MS = 2000;
const FALLBACK = { assignments: {}, audiences: [] };

/** In-flight/settled decision for this page load (memoized). */
let decisionPromise;

/**
 * Fetches the visitor's remote decision from the edge worker once per page load.
 * Never rejects — any failure/timeout resolves to `FALLBACK` (no personalization),
 * so a slow or unreachable worker degrades to the control experience.
 * @returns {Promise<{ assignments: Record<string, string>, audiences: string[] }>}
 */
export function getRemoteDecision() {
  if (decisionPromise) {
    return decisionPromise;
  }
  decisionPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(AUDIENCES_ENDPOINT, {
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) {
        return FALLBACK;
      }
      const data = await resp.json();
      return {
        assignments: data.assignments && typeof data.assignments === 'object' ? data.assignments : {},
        audiences: Array.isArray(data.audiences) ? data.audiences : [],
      };
    } catch {
      return FALLBACK;
    } finally {
      clearTimeout(timer);
    }
  })();
  return decisionPromise;
}

/**
 * Builds a remote audience that resolves true iff the worker's decision for this
 * visitor includes `token`. Backed by the single memoized `/api/audiences` call.
 * @param {string} token The audience token the worker emits (e.g. `ixptreatment`).
 * @returns {() => Promise<boolean>}
 */
export function remoteAudience(token) {
  return async () => (await getRemoteDecision()).audiences.includes(token);
}

/**
 * The Decision Engine manifest gate audience: always on. The per-visitor decision
 * (which offer, or none) is carried by the worker-served Audience Manifest, so the
 * gate itself is unconditional and makes no extra network call.
 * @returns {boolean}
 */
export const remote = () => true;
