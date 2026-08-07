/**
 * Decision Engine entry resolution (use case 2: personalization).
 *
 * Produces the worker's existing `PznEntry[]` — one per personalized slot — from
 * a single Decision Engine batch decision, so the rest of the render path
 * (`resolveOfferMarkup` + `applyPersonalization`) is unchanged. The flow, per
 * the pzn service's Batch endpoint:
 *
 *   1. resolve the page's slots        (de/routes.js)
 *   2. read the ivid                   (cookie / ?ivid= fallback)
 *   3. build the shared attributes      (visitor.js + ivid/locale/device/geo)
 *   4. batch call → per-slot recommendation (de/batch-client.js)
 *   5. map each status:200 slot → a block-replace PznEntry (fragment = pznblock)
 *
 * A slot with a non-200 status (no personalized recommendation) is left as
 * authored. Every failure degrades to an empty array (passthrough) —
 * personalization never breaks the page. The worker does NO decisioning; the
 * Decision Engine decides, this only renders it.
 */

import { resolveDeRoute } from './routes.js';
import { fetchBatch } from './batch-client.js';
import { deriveVisitorTokens } from '../visitor.js';

/**
 * @typedef {import('../personalize.js').PznEntry} PznEntry
 * @typedef {import('./routes.js').DeSlot} DeSlot
 */

/**
 * The visitor id, which is the lever the whole flow turns on. In production it
 * comes from the `ivid` cookie the pzn service issues; a `?ivid=` query param
 * overrides that cookie for demo / QA. Null when absent ⇒ nothing to personalize
 * (passthrough).
 * @param {Request} request
 * @returns {string | null}
 */
function readIvid(request) {
  const fromQuery = new URL(request.url).searchParams.get('ivid');
  if (fromQuery) return fromQuery;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Builds the shared `attributes` object the batch request carries: the ivid, the
 * page permalink, and the per-visitor signals the edge can derive (locale,
 * device type, geo, client IP). Mirrors the pzn service's `attributes` contract;
 * client-only fields (screen resolution) and marketing ids (casId, priorityCode)
 * are not derivable at the edge and are omitted.
 * @param {Request} request
 * @param {string} ivid
 * @param {string} permalink The page path being personalized.
 * @returns {Record<string, unknown>}
 */
function buildAttributes(request, ivid, permalink) {
  const v = deriveVisitorTokens(request);
  const ua = request.headers.get('user-agent') || '';
  const deviceType = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';

  const attributes = {
    ivid,
    permalink,
    locale: v.lang || 'en-US',
    deviceType,
    newVisitor: true,
  };
  if (v.country) attributes.country_code = v.country;
  if (v.region) attributes.region_code = v.region;
  const { latitude, longitude } = request.cf || {};
  if (latitude != null && latitude !== '') attributes.latitude = String(latitude);
  if (longitude != null && longitude !== '') attributes.longitude = String(longitude);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) attributes.ipAddress = ip;
  return attributes;
}

/**
 * Finds the batch response entry for a slot's placement, or null. The response
 * is keyed by `<experience>_<placement>_<locale>`; we match on the entry's own
 * `placement` field rather than reconstructing the key.
 * @param {Record<string, any>} response
 * @param {DeSlot} slot
 * @returns {any | null}
 */
function entryForSlot(response, slot) {
  for (const value of Object.values(response)) {
    if (value && value.placement === slot.placement) return value;
  }
  return null;
}

/**
 * Maps one batch response entry onto a `PznEntry` for a slot, or null when the
 * slot should stay as authored (no personalized recommendation / non-200 status
 * / missing fragment).
 * @param {any} responseEntry
 * @param {DeSlot} slot
 * @param {string} path
 * @returns {PznEntry | null}
 */
function slotEntryToPznEntry(responseEntry, slot, path) {
  if (!responseEntry || responseEntry.status !== 200) return null;
  // The pzn service nests recommendations under `data.recommendations.
  // recommendation[]`, and the fragment to inject is `copyData.pznblock`
  // (a fragment path, e.g. `fragments/pzn/slot1-hospitality`).
  const rec = responseEntry.data?.recommendations?.recommendation?.[0];
  const fragment = rec?.copyData?.pznblock;
  if (typeof fragment !== 'string' || !fragment) return null;
  return {
    path,
    fragment,
    location: slot.location,
    action: 'replace',
    fidelity: 'block',
  };
}

/**
 * Resolves the personalized slot entries for a request via the Decision Engine
 * batch flow, or an empty array (passthrough) when the path is not enrolled,
 * there is no ivid, or nothing personalizes. Every failure → `[]`.
 * @param {import('./batch-client.js').DeClientEnv} env
 * @param {Request} request
 * @returns {Promise<PznEntry[]>}
 */
export async function resolveDeEntries(env, request) {
  const path = new URL(request.url).pathname;
  const route = resolveDeRoute(path);
  if (!route) return [];

  const ivid = readIvid(request);
  if (!ivid) return [];

  const attributes = buildAttributes(request, ivid, path);

  const response = await fetchBatch(env, { slots: route.slots, attributes });
  if (!response) return [];

  const entries = [];
  for (const slot of route.slots) {
    const entry = slotEntryToPznEntry(entryForSlot(response, slot), slot, path);
    if (entry) entries.push(entry);
  }
  return entries;
}
