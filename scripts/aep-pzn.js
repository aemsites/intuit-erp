/* eslint-disable no-console */
// Client-side personalization from the AEP Edge segment, with no intuit-orchestrator call.
//
// Segment ids come from the AEP Edge Network Fetch API (POST /ee/or2/v2alpha1/fetch): a stateless,
// identity-only lookup that returns segment membership (handle `activation:pull` -> payload
// `profileLookup` -> `segments[]`). We send the visitor's `ivid` as the IVID identity directly, so
// there is no Web SDK, no ECID/cluster cookie handling and no page-view event involved.
// Not GA yet - see "Experience Edge - Fetch API Draft v1.0".
//
// Tealium's page-view interact call (lazy phase) is only observed, never awaited: scripts.js holds
// tealium.lazy() until personalization settles, so waiting on it here would deadlock until the
// decision deadline. Its segments (and the Fetch result) are written to a localStorage cache.
//
// Then, for each pzn placement (section metadata `pzn`), fetch the AEM rules json
// `<RULES_BASE>/<pzn>.json` (rows of SegmentId -> ContentId, an AEM fragment path, with a
// SegmentPriority that decides between several matching segments) and return an
// orchestrator-shaped response ({ personalisation: { [placement]: ... } }) so the existing
// pznDecision/applyFragment/analytics pipeline in experience.js is unchanged.

const LOG = '[aep-pzn]';
// Same-origin on purpose: the AEM site is access-protected, so a cross-origin call to
// main--erp--intuit.aem.page from the page gets a 401 (and needs CORS). Through the local dev proxy
// (or the real host) a relative path carries the auth and needs neither.
const RULES_BASE = '/drafts/megha';
const INTERACT_RE = /\/ee\/(?:[^/?]+\/)*v\d+\/interact/;

// Same datastream and first-party edge domain as the Tealium-driven page-view call.
const DATASTREAM_ID = 'bee9bcff-84ab-42ab-9a3c-700f5f84d7ad';
// `or2` pins the Edge region in the path (the Fetch API doc: /ee/{region}/v2alpha1/fetch).
const FETCH_URL = 'https://aec.intuit.com/ee/or2/v2alpha1/fetch';

// TESTING: while false, the cached / previously seen segment is NOT used to short-circuit - the
// Fetch call fires on every page load. Set to true to serve returning visitors from the cache
// (cached ids are read synchronously, so the above-the-fold swap never waits on the network).
const USE_SEGMENT_CACHE = false;

const CACHE_KEY = 'aep-pzn-segments';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// "No segment" is retried sooner: an empty result is often just a visitor the edge can't identify
// yet, and caching it for a day would block every later lookup.
const EMPTY_CACHE_TTL_MS = 5 * 60 * 1000;

// --- Segment cache ----------------------------------------------------------

export function readCachedSegments(now = Date.now()) {
  try {
    const entry = JSON.parse(window.localStorage.getItem(CACHE_KEY));
    const ttl = entry?.ids?.length ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
    if (entry && Array.isArray(entry.ids) && now - entry.ts < ttl) return entry.ids;
  } catch { /* storage blocked or corrupt - treat as a miss */ }
  return null;
}

function writeCachedSegments(ids) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ids, ts: Date.now() }));
  } catch { /* storage blocked - the cache is an optimization only */ }
}

// --- Reading segments from an Edge response ---------------------------------

// Every `segments` array anywhere in the response (handle[].payload[] nesting varies), so it works
// on both the Fetch response and the raw interact body.
export function extractSegmentIds(node, found = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractSegmentIds(n, found));
  } else if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'segments' && Array.isArray(value)) {
        value.forEach((s) => { if (s?.id) found.add(String(s.id)); });
      } else {
        extractSegmentIds(value, found);
      }
    });
  }
  return [...found];
}

function onSegments(source, ids) {
  console.log(`${LOG} segments from ${source}:`, ids.length ? ids : 'none');
  window.hlx = window.hlx || {};
  window.hlx.aepSegmentIds = ids;
  writeCachedSegments(ids);
}

// Wraps window.fetch once (must run before Tealium/the Web SDK loads) to read interact
// responses from a clone, leaving the SDK's response untouched.
export function observeInteract() {
  if (typeof window === 'undefined' || window.hlx?.aepObserver) return;
  window.hlx = window.hlx || {};
  window.hlx.aepObserver = true;
  const nativeFetch = window.fetch;
  window.fetch = function aepFetch(input, init) {
    const result = nativeFetch.call(this, input, init);
    try {
      const url = typeof input === 'string' ? input : (input?.url || String(input));
      if (INTERACT_RE.test(url)) {
        result.then((res) => {
          // A failed call (e.g. 404 with no body) says nothing about the user's segments.
          if (!res.ok) {
            console.log(`${LOG} interact call failed: HTTP ${res.status} ${url}`);
            return null;
          }
          return res.clone().json();
        })
          .then((data) => { if (data) onSegments('interact response', extractSegmentIds(data)); })
          .catch((err) => console.log(`${LOG} could not read interact response`, err));
      }
    } catch { /* observing must never break the SDK call */ }
    return result;
  };
  console.log(`${LOG} watching fetch for ${INTERACT_RE}`);
}

// --- Eager Fetch API lookup -------------------------------------------------

function eagerLookupAllowed() {
  try {
    if (new URLSearchParams(window.location.search).get('aep-eager') === 'off') {
      console.log(`${LOG} eager lookup disabled by ?aep-eager=off`);
      return false;
    }
  } catch { /* ignore */ }
  // Intuit's US opt-out posture (consent_req=false, see plugins/tealium-martech) allows the call by
  // default; honour Global Privacy Control. Confirm with privacy before widening use.
  if (navigator.globalPrivacyControl) {
    console.log(`${LOG} eager lookup skipped: Global Privacy Control is on`);
    return false;
  }
  return true;
}

function readIvid() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)ivid=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

// POST /ee/or2/v2alpha1/fetch with the visitor's IVID identity. Stateless: no cookies are sent or
// stored and no `meta.state`; the Edge region is fixed to `or2` in the path instead of being read
// from the `kndctr_*_cluster` cookie. The body shape is Intuit's agreed Fetch request (identityMap
// plus the `_turbotax.identifiers` and a per-request `_id`). The JSON is sent as text/plain (a CORS
// "simple" content type, like the Web SDK does): application/json forced an OPTIONS preflight that
// cost ~780ms on top of the ~280ms call. The Edge parses the body as JSON either way.
export async function eagerLookup(timeoutMs = 1500) {
  if (!eagerLookupAllowed()) return [];
  const ivid = readIvid();
  if (!ivid) {
    console.log(`${LOG} no ivid cookie -> nothing to look up`);
    return [];
  }
  const url = `${FETCH_URL}?dataStreamId=${DATASTREAM_ID}`;
  const eventId = window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now());
  const body = {
    xdm: {
      _id: `event-${eventId}`,
      identityMap: { IVID: [{ authenticatedState: 'ambiguous', id: ivid, primary: true }] },
      _turbotax: { identifiers: { ivid, pseudonym_id: 'null' } },
    },
  };
  console.log(`${LOG} eager Fetch API lookup: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(`${LOG} Fetch API call failed: HTTP ${res.status}`);
      writeCachedSegments([]); // back off for the empty TTL instead of retrying on every load
      return [];
    }
    const ids = extractSegmentIds(await res.json());
    console.log(`${LOG} Fetch API answered in ${Math.round(performance.now() - started)}ms`);
    onSegments('Fetch API', ids);
    return ids;
  } catch (err) {
    console.log(`${LOG} Fetch API lookup failed`, err);
    writeCachedSegments([]);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Resolves to the user's segment ids. While USE_SEGMENT_CACHE is off (testing) this is always a
// fresh Fetch API call, but at most ONE per page load: the in-flight/settled promise is shared by
// every caller (the eager call and any post-swap call), whatever the number of pzn-rules targets.
// It never waits for Tealium's own interact call (see the header).
let segmentLookup = null;
const rulesCache = new Map(); // placement -> Promise<rules[]>: one fetch per rules file per page

export function whenSegmentIds(timeoutMs) {
  if (USE_SEGMENT_CACHE) {
    const known = window.hlx?.aepSegmentIds || readCachedSegments();
    if (known) {
      console.log(`${LOG} using known segments:`, known.length ? known : 'none');
      return Promise.resolve(known);
    }
  }
  if (!segmentLookup) segmentLookup = eagerLookup(timeoutMs);
  return segmentLookup;
}

// Test hook: forget the per-page lookup and rules memo.
export function resetAepLookup() {
  segmentLookup = null;
  rulesCache.clear();
}

// --- Rules ------------------------------------------------------------------

// Accepts an AEM sheet ({ data: [{ SegmentId, ContentId, SegmentPriority }] }) or a plain
// { segmentId: contentId }. `priority` is only set when SegmentPriority is a number.
export function parseRules(json) {
  if (Array.isArray(json?.data)) {
    return json.data.map((row) => {
      const get = (name) => {
        const key = Object.keys(row).find((k) => k.toLowerCase() === name);
        return key ? String(row[key] ?? '').trim() : '';
      };
      const raw = get('segmentpriority');
      const priority = raw === '' ? NaN : Number(raw);
      return {
        segmentId: get('segmentid'),
        contentId: get('contentid'),
        ...(Number.isFinite(priority) && { priority }),
      };
    }).filter((r) => r.segmentId && r.contentId);
  }
  if (json && typeof json === 'object') {
    return Object.entries(json)
      .filter(([, v]) => typeof v === 'string')
      .map(([segmentId, contentId]) => ({ segmentId, contentId: contentId.trim() }));
  }
  return [];
}

// A visitor can be in several segments. Of the rows whose segment they are in, the one with the
// HIGHEST SegmentPriority wins (larger number = higher priority). A row without a numeric
// priority ranks lowest; ties, and sheets with no priorities at all, keep the first row in sheet
// order.
export function matchRule(rules, segmentIds) {
  const candidates = rules.filter((r) => segmentIds.includes(r.segmentId));
  if (!candidates.length) return null;
  return candidates.reduce((best, rule) => {
    const rank = (r) => (Number.isFinite(r.priority) ? r.priority : -Infinity);
    return rank(rule) > rank(best) ? rule : best;
  });
}

async function fetchRules(placement, signal) {
  const url = `${RULES_BASE}/${encodeURIComponent(placement)}.json`;
  console.log(`${LOG} fetching rules for "${placement}": ${url}`);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    console.log(`${LOG} rules fetch failed for "${placement}": HTTP ${res.status}`);
    return [];
  }
  const rules = parseRules(await res.json());
  console.log(`${LOG} rules for "${placement}":`, rules);
  return rules;
}

function loadRules(placement, signal) {
  if (!rulesCache.has(placement)) rulesCache.set(placement, fetchRules(placement, signal));
  return rulesCache.get(placement);
}

// Orchestrator-shaped response for the placements that matched a segment rule, else null.
// timeoutMs stays short: scripts.js holds tealium.lazy() (the page view) until this settles.
export async function resolveAepPersonalization(placements, { signal, timeoutMs = 1500 } = {}) {
  if (!placements?.length) return null;
  console.log(`${LOG} resolving placements:`, placements);
  const started = performance.now();
  const segmentIds = await whenSegmentIds(timeoutMs);
  if (!segmentIds.length) {
    console.log(`${LOG} no AEP segment for this user -> baseline content`);
    return null;
  }
  const personalisation = {};
  await Promise.all(placements.map(async (placement) => {
    try {
      const rules = await loadRules(placement, signal);
      const matches = rules.filter((r) => segmentIds.includes(r.segmentId));
      const rule = matchRule(rules, segmentIds);
      if (matches.length > 1) {
        console.log(`${LOG} "${placement}": ${matches.length} rules match, using the highest priority:`, matches);
      }
      if (!rule) {
        console.log(`${LOG} "${placement}": no rule matches segments`, segmentIds);
        return;
      }
      console.log(`${LOG} "${placement}": segment ${rule.segmentId} -> content ${rule.contentId}`);
      personalisation[placement] = {
        payload: { contentId: rule.contentId },
        trackingAttributes: { offerId: rule.segmentId },
      };
    } catch (err) {
      console.log(`${LOG} "${placement}": rules lookup failed`, err);
    }
  }));
  console.log(`${LOG} decision ready after ${Math.round(performance.now() - started)}ms (eager budget is 1500ms)`);
  return Object.keys(personalisation).length ? { personalisation } : null;
}
