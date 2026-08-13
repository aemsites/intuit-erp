/**
 * Decision Engine batch-request helpers.
 *
 * The `/api/pzn` handler supplies the page's slots and visitor context; this pure
 * helper builds the batch request's shared `attributes` object. The worker does NO
 * response decisioning — it enriches + forwards the request and passes the raw
 * batch response back to the front-end, which reads each slot's recommendation
 * (fragment + metadata) itself.
 */

import { deriveVisitorTokens } from '../visitor.js';

/**
 * A personalizable slot on the page.
 * @typedef {Object} PznSlot
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
