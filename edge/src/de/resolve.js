/**
 * Decision Engine batch-response mapping helpers.
 *
 * The `/api/de` handler supplies the page's slots and visitor context; these
 * pure helpers build the batch request's shared `attributes` object and map each
 * batch response entry onto a normalized decision. The worker does NO decisioning
 * — the Decision Engine decides, this only shapes the request and reads the reply.
 */

import { deriveVisitorTokens } from '../visitor.js';

/**
 * A normalized personalization decision for one slot.
 * @typedef {Object} PznEntry
 * @property {string} path Page path the offer applies to.
 * @property {string} fragment Offer fragment reference (e.g. `fragments/pzn/slot1`).
 * @property {string} location Slot id to target in the page.
 * @property {'replace'} action Operation at the slot.
 * @property {'block'} fidelity Granularity of the target element.
 */

/**
 * A personalizable slot on the page.
 * @typedef {Object} DeSlot
 * @property {string} location Slot id to target in the page (e.g. `slot-1`).
 * @property {string} placement Decision Engine placement/accessPoint for the slot.
 * @property {string} experience Decision Engine experience (e.g. `marketing`).
 */

/**
 * Builds the shared `attributes` object the batch request carries: the ivid, the
 * page permalink, and the per-visitor signals the edge can derive (locale,
 * device type, geo, client IP). Mirrors the pzn service's `attributes` contract;
 * client-only fields (screen resolution) and marketing ids (casId, priorityCode)
 * are not derivable at the edge and are omitted.
 *
 * The locale normally comes from the visitor's `Accept-Language`; a `?locale=`
 * query param overrides it (demo / QA — the batch response is keyed by locale, so
 * this forces a specific offer variant regardless of the browser's language).
 * @param {Request} request
 * @param {string} ivid
 * @param {string} permalink The page path being personalized.
 * @returns {Record<string, unknown>}
 */
export function buildAttributes(request, ivid, permalink) {
  const v = deriveVisitorTokens(request);
  const ua = request.headers.get('user-agent') || '';
  const deviceType = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
  const localeOverride = new URL(request.url).searchParams.get('locale');

  const attributes = {
    ivid,
    permalink,
    locale: localeOverride || v.lang || 'en-US',
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
export function entryForSlot(response, slot) {
  const want = String(slot.placement).toLowerCase();
  for (const value of Object.values(response)) {
    if (value && typeof value.placement === 'string' && value.placement.toLowerCase() === want) {
      return value;
    }
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
export function slotEntryToPznEntry(responseEntry, slot, path) {
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
