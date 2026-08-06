/**
 * Decision Engine "Batch" endpoint client (use case 2, step 2).
 *
 * The real Batch endpoint takes one POST covering every personalizable slot on
 * the page — `batchItems: [{ placement, experience, numberOfRecommendations,
 * recommendationMetadata }]` plus a shared `attributes` object (ivid, locale,
 * geo, device, industry, …) — and returns a per-placement recommendation whose
 * `copyData.contentId` references the content to render.
 *
 * Here the endpoint is a **mock**: a static JSON file on the EDS origin. We still
 * build the faithful request body (so it is ready to POST at the real service
 * and is visible in logs), then fetch the mock **response** as static JSON,
 * selecting the variant by the visitor's industry so the demo shows
 * industry-driven personalization. `DECISION_ENGINE_BATCH_URL` is the base dir;
 * the client appends `/batch-<industry-slug>.json`, falling back to
 * `/batch-default.json`. Any failure returns null (→ passthrough).
 */

/**
 * @typedef {import('./routes.js').DeSlot} DeSlot
 */

/** Lowercase, hyphenated slug for an industry name (`Hospitality` → `hospitality`). */
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Builds the faithful Batch request body for the page's slots + visitor context.
 * Kept pure and exported so it can be logged and unit-tested, and POSTed as-is
 * to the real endpoint later.
 * @param {DeSlot[]} slots
 * @param {Record<string, unknown>} attributes
 * @returns {{ batchItems: object[], attributes: Record<string, unknown> }}
 */
export function buildBatchRequest(slots, attributes) {
  return {
    batchItems: slots.map((slot) => ({
      placement: slot.placement,
      experience: slot.experience,
      numberOfRecommendations: 1,
      recommendationMetadata: true,
    })),
    attributes,
  };
}

/**
 * Fetches and parses one batch-response variant, or null if it is missing /
 * not JSON / errors. The `requestHeader` carries the intended batch request so a
 * body-aware mock or proxy can branch on it (harmless for a plain static file).
 * @param {string} variantUrl
 * @param {string} requestHeader
 * @returns {Promise<Record<string, any> | null>}
 */
async function fetchVariant(variantUrl, requestHeader) {
  try {
    const res = await fetch(variantUrl, {
      method: 'GET',
      // Personalization decisions are per-visitor; do not share at the edge.
      cf: { cacheTtl: 0 },
      headers: { 'content-type': 'application/json', 'x-de-batch-request': requestHeader },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetches the batch decision for the page's slots. Builds the request body
 * (for the real POST / logging), then reads the mock static response for the
 * visitor's industry variant, falling back to the default variant.
 * @param {{ DECISION_ENGINE_BATCH_URL?: string }} env
 * @param {{ slots: DeSlot[], attributes: Record<string, unknown>, industry?: string }} opts
 * @returns {Promise<Record<string, any> | null>}
 */
export async function fetchBatch(env, { slots, attributes, industry }) {
  if (!env.DECISION_ENGINE_BATCH_URL) return null;

  // The faithful request the real service would receive (logged for the demo;
  // the static mock ignores the body and is keyed by industry in the URL).
  const requestHeader = JSON.stringify(buildBatchRequest(slots, attributes));
  const base = env.DECISION_ENGINE_BATCH_URL.replace(/\/+$/, '');

  // Prefer the industry-specific variant; fall back to the default.
  const industryResult = industry
    ? await fetchVariant(`${base}/batch-${slugify(industry)}.json`, requestHeader)
    : null;
  if (industryResult) return industryResult;
  return fetchVariant(`${base}/batch-default.json`, requestHeader);
}
