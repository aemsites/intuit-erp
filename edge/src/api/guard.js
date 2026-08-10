/**
 * Request guard for the /api/* endpoints. Two layers:
 *   1. Origin allowlist — constrains *browsers* (cross-site fetch). Same-origin,
 *      *.intuit.com, *.aem.live, *.aem.page pass; a missing Origin (same-origin
 *      GET / non-browser) passes. NOTE: an Origin/Referer check is spoofable by a
 *      non-browser caller; the real boundary is the Akamai shared-secret header.
 *   2. Akamai shared-secret — if EDGE_AUTH_SECRET is set, require a matching
 *      `x-edge-auth` header (injected by Akamai on the /api/* route). Skipped
 *      entirely when the secret is unset, so it activates with no code change.
 */

const ALLOWED_SUFFIXES = ['.intuit.com', '.aem.live', '.aem.page'];

function originHost(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Host of the worker request itself. */
function requestHost(request) {
  return new URL(request.url).host;
}

/** True if the request's Origin is same-origin, allowlisted, or absent. */
export function isAllowedOrigin(request) {
  const host = originHost(request);
  if (!host) return true; // same-origin GET / non-CORS
  if (host === requestHost(request)) return true;
  return ALLOWED_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
}

/** Credentialed CORS headers for an allowed cross-origin request; {} otherwise. */
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  const host = originHost(request);
  if (!origin || host === requestHost(request)) return {};
  if (!isAllowedOrigin(request)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function edgeAuthOk(request, env) {
  if (!env.EDGE_AUTH_SECRET) return true; // gate off until the secret is set
  return request.headers.get('x-edge-auth') === env.EDGE_AUTH_SECRET;
}

/**
 * @returns {{ ok: true, cors: Record<string,string> } | { ok: false, response: Response }}
 */
export function guard(request, env) {
  if (!isAllowedOrigin(request)) {
    return { ok: false, response: new Response('Forbidden origin', { status: 403 }) };
  }
  if (!edgeAuthOk(request, env)) {
    return { ok: false, response: new Response('Forbidden', { status: 403 }) };
  }
  return { ok: true, cors: corsHeaders(request) };
}
