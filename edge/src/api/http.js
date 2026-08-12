/** JSON response helper. */
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

/** The request's Referer as a URL, or null. */
export function refererUrl(request) {
  const ref = request.headers.get('referer');
  if (!ref) return null;
  try {
    return new URL(ref);
  } catch {
    return null;
  }
}

/** Pathname of the request's Referer header, or null. */
export function refererPath(request) {
  return refererUrl(request)?.pathname ?? null;
}
