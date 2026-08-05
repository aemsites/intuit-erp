/**
 * Visitor signals available to the worker at the edge.
 *
 * Cloudflare attaches request-scoped context in two places:
 *
 *   - `request.cf` — IP-derived geo + network enrichment that Cloudflare adds
 *     before the worker runs: `country`, `city`, `region`/`regionCode`,
 *     `continent`, `postalCode`, `latitude`/`longitude`, `timezone`, plus
 *     network fields (`colo`, `asn`, `asOrganization`, `httpProtocol`,
 *     `tlsVersion`) and, if Bot Management is on, `botManagement`. Present on
 *     real edge requests; absent in some local/test contexts, so every read is
 *     treated as optional.
 *   - request headers — `Accept-Language` (UI language), `User-Agent` (device),
 *     `CF-Connecting-IP` (client IP), `CF-IPCountry`, `Referer`, and any
 *     first-party `Cookie` (this worker already reads `ivid` from it — logged-in
 *     segments, prior-visit flags, etc. live here too).
 *
 * We distill these into plain string tokens that merge into the template fill
 * map, so an authored placeholder (GREETING, CITY, COUNTRY, ...) renders a word
 * derived from the visitor. Geo is IP-based — approximate and VPN-affected — so
 * it is right for a friendly greeting, not for anything security-sensitive.
 */

/**
 * Just the request surface we read, so this stays trivially testable.
 * @typedef {Object} VisitorRequest
 * @property {IncomingRequestCfProperties} [cf]
 * @property {Headers} headers
 */

/**
 * Time-of-day greeting for an IANA timezone (neutral fallback if unknown).
 * @param {string} [timezone]
 * @returns {string}
 */
function greetingFor(timezone) {
  try {
    if (!timezone) return 'Welcome';
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      }).format(new Date()),
    );
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  } catch {
    return 'Welcome';
  }
}

/**
 * Builds per-visitor fill tokens from the request's edge context. Keys are
 * lower-case (upper-cased to placeholders downstream). Unknown signals are
 * simply omitted, so the corresponding placeholder falls back to its default.
 * @param {VisitorRequest} request
 * @returns {Record<string, string>}
 */
export function deriveVisitorTokens(request) {
  const { cf } = request;
  const tokens = {};
  const set = (key, value) => {
    if (typeof value === 'string' && value.trim()) tokens[key] = value.trim();
  };

  set('city', cf?.city);
  set('region', cf?.region);
  set('country', cf?.country ?? request.headers.get('cf-ipcountry') ?? undefined);
  set('continent', cf?.continent);
  set('timezone', cf?.timezone);
  set('postalcode', cf?.postalCode);

  // Preferred UI language: the first Accept-Language tag (e.g. "en-US").
  const lang = request.headers.get('accept-language');
  if (lang) set('lang', lang.split(',')[0]?.split(';')[0]);

  // A friendly, always-present greeting derived from the visitor's local time.
  tokens.greeting = greetingFor(cf?.timezone);

  return tokens;
}
