// Front-end request-building for the pzn/ixp endpoints. Akamai fronts `/api/pzn`
// and `/api/ixp` as a thin passthrough — it injects the Intuit API key and, when
// it can, supplements IP-derived geo — so every OTHER attribute is built here and
// sent verbatim to the upstream contract.

import { getMetadata } from '../aem.js';

// The visitor id the decision turns on: a page `?ivid=` override (demo / QA) wins,
// else the first-party `ivid` cookie. `undefined` when neither is present — the
// request then goes out without one. NOTE: if the `ivid` cookie is HttpOnly the
// browser can't read it here; Akamai must then inject ivid on the forwarded request.
export function resolveIvid() {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('ivid');
    if (fromQuery) return fromQuery;
    const m = document.cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

// Device bucket from the UA (mirrors the old edge derivation).
function deviceType() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
}

// The shared `attributes` object the batch request carries. Every field the browser
// can produce is sent (including ones the old edge couldn't: casId, screenResolution);
// IP-derived geo (country_code, region_code, latitude, longitude, ipAddress) is left
// for Akamai to inject. A `?locale=` override forces a specific offer variant for QA.
export function buildPznAttributes(permalink = window.location.pathname) {
  const attributes = {
    permalink,
    locale: new URLSearchParams(window.location.search).get('locale') || navigator.language || 'en-US',
    deviceType: deviceType(),
    newVisitor: true,
  };
  const ivid = resolveIvid();
  if (ivid) attributes.ivid = ivid;
  const casId = getMetadata('cas-id') || getMetadata('page-cas-id');
  if (casId) attributes.casId = casId;
  const { width, height } = (typeof window !== 'undefined' && window.screen) || {};
  if (width && height) attributes.screenResolution = `${width}x${height}`;
  return attributes;
}

// The faithful Batch request body for the page's placements + visitor context.
// `extraAttributes` (e.g. the marketing-profile firmographics) are merged onto the
// client attributes so the decision can target on them.
export function buildBatchBody(placements, permalink, extraAttributes = {}) {
  return {
    batchItems: placements.map((placement) => ({
      placement,
      experience: 'marketing',
      numberOfRecommendations: 1,
      recommendationMetadata: true,
    })),
    attributes: { ...buildPznAttributes(permalink), ...extraAttributes },
  };
}

// IXP query for an experiment id: numeric → experimentId, else label; plus ivid when
// resolvable. e.g. `experimentId=385944&ivid=abc`.
export function ixpParams(id) {
  const params = new URLSearchParams();
  if (/^\d+$/.test(id)) params.set('experimentId', id);
  else params.set('label', id);
  const ivid = resolveIvid();
  if (ivid) params.set('ivid', ivid);
  return params.toString();
}
