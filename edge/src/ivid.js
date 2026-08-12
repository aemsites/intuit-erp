/**
 * The visitor id the personalization/experiment decision turns on. In production
 * it comes from the `ivid` cookie the IXP/pzn service issues; a `?ivid=` query
 * param overrides that cookie for demo / QA. Null when absent ⇒ nothing to
 * personalize (passthrough). The worker never mints or sets an ivid.
 * @param {Request} request
 * @returns {string | null}
 */
export function readIvid(request) {
  const fromQuery = new URL(request.url).searchParams.get('ivid');
  if (fromQuery) return fromQuery;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Resolves the visitor `ivid` for an HTML page response and whether to (re)issue
 * the cookie. Honors a `?ivid=` override (demo/QA — pins the arm and persists it),
 * reuses an existing `ivid` cookie, or mints a new one. In production the Intuit
 * edge issues this cookie; the POC worker mints it so the client personalization
 * endpoints have a stable visitor id with no external dependency. `setCookie` is
 * null when a cookie is already present and no override was given (nothing to do).
 * @param {Request} request
 * @returns {{ ivid: string, setCookie: string | null }}
 */
export function resolveVisitorIvid(request) {
  const fromQuery = new URL(request.url).searchParams.get('ivid');
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  const fromCookie = m ? decodeURIComponent(m[1]) : null;
  const ivid = fromQuery || fromCookie || crypto.randomUUID();
  const setCookie = (fromQuery || !fromCookie)
    ? `ivid=${encodeURIComponent(ivid)}; Path=/; Max-Age=31536000; SameSite=Lax`
    : null;
  return { ivid, setCookie };
}
