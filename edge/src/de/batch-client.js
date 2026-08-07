/**
 * Decision Engine "Batch" endpoint client (use case 2, step 2).
 *
 * The real Batch endpoint takes one POST covering every personalizable slot on
 * the page — `batchItems: [{ placement, experience, numberOfRecommendations,
 * recommendationMetadata }]` plus a shared `attributes` object (ivid, locale,
 * permalink, geo, device, …) — and returns a per-placement recommendation whose
 * `copyData.pznblock` references the fragment to render.
 *
 * This POSTs to the real service (`DECISION_ENGINE_BATCH_URL`,
 * `https://personalization.api.intuit.com/public/v1/batch`) with Intuit's API-key
 * auth. Decisions are per-visitor, so the response is never edge-cached
 * (`cf.cacheTtl: 0`) — changes made on Intuit's side show up at the next page
 * view. Any failure (transport, non-2xx, non-JSON) returns null → passthrough.
 */

/**
 * @typedef {import('./routes.js').DeSlot} DeSlot
 */

/**
 * Env bindings the client needs (see `wrangler.jsonc`).
 * @typedef {Object} DeClientEnv
 * @property {string} DECISION_ENGINE_BATCH_URL Full URL of the Batch endpoint.
 * @property {string} PZN_API_KEY Personalization API key (a Wrangler secret).
 */

/**
 * Builds the faithful Batch request body for the page's slots + visitor context.
 * Kept pure and exported so it can be logged and unit-tested.
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
 * Builds the required `Authorization` header value for Intuit's APIs.
 * @param {string} apiKey
 * @returns {string}
 */
function authHeader(apiKey) {
  return `Intuit_APIKey intuit_apikey=${apiKey}, intuit_apikey_version=1.0`;
}

/**
 * POSTs the batch decision for the page's slots to the real Decision Engine and
 * returns the parsed response, or null on any transport / non-2xx / non-JSON
 * failure (the caller then passes the page through untouched).
 * @param {DeClientEnv} env
 * @param {{ slots: DeSlot[], attributes: Record<string, unknown> }} opts
 * @returns {Promise<Record<string, any> | null>}
 */
export async function fetchBatch(env, { slots, attributes }) {
  if (!env.DECISION_ENGINE_BATCH_URL || !env.PZN_API_KEY) return null;

  const body = JSON.stringify(buildBatchRequest(slots, attributes));

  try {
    const res = await fetch(env.DECISION_ENGINE_BATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader(env.PZN_API_KEY),
        'content-type': 'application/json',
        // Per-request transaction id the pzn service correlates in its logs.
        intuit_tid: `rp-${crypto.randomUUID()}`,
      },
      body,
      // Personalization decisions are per-visitor; never share at the edge.
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}
