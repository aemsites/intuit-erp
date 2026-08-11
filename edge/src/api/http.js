/** JSON response helper. */
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

/** Pathname of the request's Referer header, or null. */
export function refererPath(request) {
  const ref = request.headers.get('referer');
  if (!ref) return null;
  try {
    return new URL(ref).pathname;
  } catch {
    return null;
  }
}
