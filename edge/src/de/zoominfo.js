/**
 * ZoomInfo / 3P visitor-context lookup (use case 2, step 1).
 *
 * Before personalizing, the real flow calls Intuit's ZoomInfo/3P service with
 * the visitor id to enrich the user context — most importantly the company
 * `industry`, which drives which content each slot shows. Here it is a **mock**:
 * a static JSON file on the EDS origin (`ZOOMINFO_URL`) with the real payload
 * shape but synthetic values (no customer PII). Swap the URL for the real
 * service later; nothing else changes.
 *
 * The response mirrors the spec's `marketingProfile.zoominfo.attributes[]` shape
 * (a list of `{ attributeName, attributeValue }`); we pull the primary industry
 * out of it. Any failure returns null, so the caller personalizes with no
 * industry (the batch mock falls back to its default variant).
 */

/**
 * @typedef {Object} VisitorContext
 * @property {string} [industry] Primary company industry (e.g. `Hospitality`).
 * @property {string} [subIndustry] Sub-industry, when present.
 */

/**
 * Reads a named attribute from a `[{ attributeName, attributeValue }]` list.
 * @param {Array<{ attributeName?: string, attributeValue?: unknown }>} attrs
 * @param {string} name
 * @returns {string | undefined}
 */
function attr(attrs, name) {
  const found = attrs.find((a) => a?.attributeName === name);
  const value = found?.attributeValue;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== 'null' ? trimmed : undefined;
}

/**
 * Fetches the visitor's ZoomInfo/3P context, or null on any failure. The `ivid`
 * is accepted for parity with the real API (and future per-visitor mocks); the
 * static mock ignores it.
 * @param {{ ZOOMINFO_URL?: string }} env
 * @param {string} ivid
 * @returns {Promise<VisitorContext | null>}
 */
export async function fetchVisitorContext(env, ivid) {
  if (!env.ZOOMINFO_URL) return null;
  try {
    const url = new URL(env.ZOOMINFO_URL);
    // Sent for the real service; the static mock ignores it.
    if (ivid) url.searchParams.set('ivid', ivid);
    const res = await fetch(url.toString(), { cf: { cacheTtl: 0 } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const body = await res.json();
    const attrs = body?.marketingProfile?.zoominfo?.attributes;
    if (!Array.isArray(attrs)) return null;
    const industry = attr(attrs, 'zi_c_industry_primary');
    const subIndustry = attr(attrs, 'zi_c_sub_industry_primary');
    const context = {};
    if (industry) context.industry = industry;
    if (subIndustry) context.subIndustry = subIndustry;
    return context;
  } catch {
    return null;
  }
}
