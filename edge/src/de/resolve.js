/**
 * Decision Engine entry resolution (use case 2: personalization).
 *
 * Produces the worker's existing `PznEntry[]` — one per personalized slot — from
 * a ZoomInfo context lookup + a Decision Engine batch decision, so the rest of
 * the render path (`resolveOfferMarkup` + `applyPersonalization`) is unchanged.
 * The flow, per the spec's Batch endpoint:
 *
 *   1. resolve the page's slots      (de/routes.js)
 *   2. read the ivid                 (cookie / ?ivid=)
 *   3. ZoomInfo → industry           (de/zoominfo.js)
 *   4. build the shared attributes    (visitor.js + ivid/locale/device/industry)
 *   5. batch call → per-slot contentId (de/batch-client.js)
 *   6. map each status:200 slot → a block-replace PznEntry (fragment = contentId)
 *
 * A slot with status 204 (no personalized recommendation) is left as authored.
 * Every failure degrades to an empty array (passthrough) — personalization never
 * breaks the page. The worker still does NO decisioning; the Decision Engine
 * decides, this only renders it.
 */

import { resolveDeRoute } from './routes.js';
import { fetchVisitorContext } from './zoominfo.js';
import { fetchBatch } from './batch-client.js';
import { deriveVisitorTokens } from '../visitor.js';

/**
 * @typedef {import('../personalize.js').PznEntry} PznEntry
 * @typedef {import('./routes.js').DeSlot} DeSlot
 */

/**
 * The visitor id. Read from the `ivid` cookie; a `?ivid=` query param overrides
 * it for demo / QA. Null when absent ⇒ nothing to personalize (passthrough).
 * @param {Request} request
 * @returns {string | null}
 */
function readIvid(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('ivid');
  if (fromQuery) return fromQuery;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Builds the shared `attributes` object the batch request carries: per-visitor
 * geo/language signals (from the edge context), the ivid, a derived locale +
 * device type, and the ZoomInfo industry. Mirrors the spec's `attributes` shape.
 * @param {Request} request
 * @param {string} ivid
 * @param {import('./zoominfo.js').VisitorContext | null} context
 * @returns {Record<string, unknown>}
 */
function buildAttributes(request, ivid, context) {
  const v = deriveVisitorTokens(request);
  const ua = request.headers.get('user-agent') || '';
  const deviceType = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
  const locale = (v.lang || 'en-US').toLowerCase();

  const attributes = {
    ivid,
    locale,
    deviceType,
    newVisitor: true,
  };
  if (v.city) attributes.city = v.city;
  if (v.country) attributes.country_code = v.country;
  if (v.region) attributes.region_code = v.region;
  if (context?.industry) attributes.industry = context.industry;
  if (context?.subIndustry) attributes.subIndustry = context.subIndustry;
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
 * slot should stay as authored (no personalized recommendation / status 204 /
 * missing contentId).
 * @param {any} responseEntry
 * @param {DeSlot} slot
 * @param {string} path
 * @returns {PznEntry | null}
 */
function slotEntryToPznEntry(responseEntry, slot, path) {
  if (!responseEntry || responseEntry.status !== 200) return null;
  const recs = responseEntry.data?.recommendations;
  const rec = Array.isArray(recs) ? recs[0] : null;
  const contentId = rec?.copyData?.contentId;
  if (typeof contentId !== 'string' || !contentId) return null;
  // `contentId` is the content reference; in this mock it is an EDS fragment
  // path, so the existing offer-fetch path renders it end-to-end.
  return {
    path,
    fragment: contentId,
    location: slot.location,
    action: 'replace',
    fidelity: 'block',
  };
}

/**
 * Resolves the personalized slot entries for a request via the Decision Engine
 * batch flow, or an empty array (passthrough) when the path is not enrolled,
 * there is no ivid, or nothing personalizes. Every failure → `[]`.
 * @param {{ ZOOMINFO_URL?: string, DECISION_ENGINE_BATCH_URL?: string }} env
 * @param {Request} request
 * @returns {Promise<PznEntry[]>}
 */
export async function resolveDeEntries(env, request) {
  const path = new URL(request.url).pathname;
  const route = resolveDeRoute(path);
  if (!route) return [];

  const ivid = readIvid(request);
  if (!ivid) return [];

  const context = await fetchVisitorContext(env, ivid);
  const attributes = buildAttributes(request, ivid, context);

  const response = await fetchBatch(env, {
    slots: route.slots,
    attributes,
    industry: context?.industry,
  });
  if (!response) return [];

  const entries = [];
  for (const slot of route.slots) {
    const entry = slotEntryToPznEntry(entryForSlot(response, slot), slot, path);
    if (entry) entries.push(entry);
  }
  return entries;
}
