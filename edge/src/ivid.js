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
