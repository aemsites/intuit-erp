// The experience layer: ONE consolidated call per page to /api/intuit-orchestrator
// for both experimentation (IXP) and personalization (PZN). It collects every
// experiment id + access-point name on the page, sends one request (with a sibling
// `context` carrying the front-end signals incl. AOF1/of1Intent), caches the response,
// and swaps content from it — whole-page + first section before reveal (pre-LCP),
// the rest after LCP. ZoomInfo enrichment is done server-side by the orchestrator.
//
// Fidelity is DOM-driven: page-level (experiment-id / personalization-id metadata) ⇒
// whole-page swap; section (data-exp / data-pzn) ⇒ section swap; a -block scope ⇒
// block swap. The response only supplies the replacement casId per id/name.

import { getMetadata } from './aem.js';
import { buildIntentContext, getIntentProfile } from './of1-intent.js';

// --- Endpoint + fetch primitives -------------------------------------------

// Base for the API: `experience-api-base` metadata (local/QA override) or same-origin
// `/api`. Akamai fronts /api in prod/stage, injecting the API key + IP-derived geo.
export function apiBase() {
  return (getMetadata('experience-api-base') || '/api').replace(/\/+$/, '');
}

// Normalizes an UNTRUSTED content ref (it comes from the decision response) to a SAFE,
// same-origin, root-absolute path — or null when it isn't usable. Security: resolve the
// ref with the URL parser against our own origin and keep ONLY the pathname. This
// discards the ref's host/scheme (we always fetch same-origin, so a protocol-relative
// `//evil.com/x` or absolute `https://evil.com/x` can't redirect the fetch off-origin)
// and its query/hash, and returns the parser's percent-encoded/normalized path. Non-http(s)
// schemes (javascript:, data:, …) and a bare-root `/` are rejected.
export function fragmentPath(ref) {
  if (!ref || typeof ref !== 'string') return null;
  let url;
  try {
    url = new URL(ref, window.location.origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const { pathname } = url;
  return pathname && pathname !== '/' ? pathname : null;
}

// A returned casId points to a content path today, so it resolves through the same safe
// normalization. Single seam: swap this for an index/service lookup if raw casIds ever
// stop being paths.
export function casToPath(cas) {
  return fragmentPath(cas);
}

// A per-request transaction id the service correlates in its logs. Not a secret.
function intuitTid() {
  const rand = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `rp-${rand}`;
}

// Resolves to the promise's value, or undefined if it doesn't settle within ms
// (fail-open) — bounds a whole phase even when something inside can't be aborted.
export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(resolve, () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
}

// Replaces <main>'s raw content with a variation page's plain.html so the caller's
// decorateMain decorates it. Bound by the caller's signal (fail-open) so a late/aborted
// swap can't clobber already-decorated content. Returns true when the swap lands.
export async function swapMain(doc, path, signal) {
  const main = doc.querySelector('main');
  const p = fragmentPath(path);
  if (!main || !p) return false;
  try {
    const resp = await fetch(`${p}.plain.html`, { signal });
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
  }
}

// Loads a fragment and replaces `targetEl`'s children with it. Returns true when applied.
export async function applyFragment(targetEl, path, opts = {}) {
  const p = fragmentPath(path);
  if (!targetEl || !p) return false;
  try {
    const load = opts.loadFragment
      // eslint-disable-next-line import/no-cycle
      || (await import('../blocks/fragment/fragment.js')).loadFragment;
    const frag = await load(p);
    if (!frag) return false;
    targetEl.replaceChildren(...frag.childNodes);
    return true;
  } catch {
    return false;
  }
}

// --- Request context (front-end signals) -----------------------------------

// The visitor id: a `?ivid=` override (demo/QA) wins, else the first-party `ivid`
// cookie. undefined when neither — Akamai injects it server-side when it's HttpOnly.
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

function deviceType() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
}

// The sibling `context` object: every front-end-derived signal plus the AOF1 intent
// profile (of1Intent). NOT ZoomInfo firmographics — the orchestrator enriches those
// server-side. IP-derived geo is left for Akamai to inject.
export function buildContext(permalink = window.location.pathname) {
  const context = {
    permalink,
    locale: new URLSearchParams(window.location.search).get('locale') || navigator.language || 'en-US',
    deviceType: deviceType(),
    newVisitor: true,
  };
  const ivid = resolveIvid();
  if (ivid) context.ivid = ivid;
  const casId = getMetadata('cas-id') || getMetadata('page-cas-id');
  if (casId) context.casId = casId;
  const { width, height } = (typeof window !== 'undefined' && window.screen) || {};
  if (width && height) context.screenResolution = `${width}x${height}`;
  const of1Intent = buildIntentContext(getIntentProfile());
  if (of1Intent) context.of1Intent = of1Intent;
  return context;
}

// --- Target collection ------------------------------------------------------

// True when a section's data-pzn and data-exp aim at the SAME target (both whole-
// section, or both the same named block). That's the case where IXP takes precedence;
// pzn and exp scoped to different blocks are independent and both run.
export function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Sections tagged `data-exp` within `root` (root itself may match), minus `skip`.
// The experiment id is the verbatim numeric `data-exp` value; a `data-exp-block`
// scopes to the block whose data-block-name matches (block fidelity), else the whole
// section. Non-numeric ids are dropped (labels are no longer supported).
export function collectExperiments(root, skip) {
  const sections = [];
  if (root.matches?.('[data-exp]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-exp]').forEach((s) => { if (s !== skip) sections.push(s); });

  const experiments = [];
  sections.forEach((section) => {
    const id = section.dataset.exp;
    if (!id || !/^\d+$/.test(id)) return;
    const block = section.dataset.expBlock;
    const el = block ? section.querySelector(`[data-block-name="${block}"]`) : section;
    if (el) experiments.push({ el, id, fidelity: block ? 'block' : 'section' });
  });
  return experiments;
}

// Sections tagged `data-pzn` within `root` (root itself may match), minus `skip`. The
// access-point name is the verbatim `data-pzn` value; a `data-pzn-block` scopes to the
// named block, else the whole section. When the same target also carries an experiment,
// IXP wins and the pzn slot is dropped.
export function collectSlots(root, skip) {
  const sections = [];
  if (root.matches?.('[data-pzn]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-pzn]').forEach((s) => { if (s !== skip) sections.push(s); });

  const slots = [];
  sections.forEach((section) => {
    const placement = section.dataset.pzn;
    if (!placement) return;
    if (section.dataset.exp && sameTargetAsExp(section)) return;
    const block = section.dataset.pznBlock;
    const el = block ? section.querySelector(`[data-block-name="${block}"]`) : section;
    if (el) slots.push({ el, placement });
  });
  return slots;
}

// The full request lists for the single call: every numeric experiment id and every
// access-point name on the page (page-level metadata + all sections), de-duped, with
// IXP-over-PZN precedence applied.
export function collectRequest(doc = document) {
  const experimentIds = new Set();
  const accessPointNames = new Set();

  const pageExp = getMetadata('experiment-id');
  if (pageExp && /^\d+$/.test(pageExp)) experimentIds.add(pageExp);
  const pagePzn = getMetadata('personalization-id');
  if (pagePzn) accessPointNames.add(pagePzn);

  const main = doc.querySelector('main');
  if (main) {
    collectExperiments(main).forEach(({ id }) => experimentIds.add(id));
    collectSlots(main).forEach(({ placement }) => accessPointNames.add(placement));
  }
  return { experimentIds: [...experimentIds], accessPointNames: [...accessPointNames] };
}

// --- The single call --------------------------------------------------------

// POSTs the consolidated request and returns the parsed response, or null on any
// non-ok/timeout/parse failure (fail-open — the caller shows the baseline). When
// `signal` is given the caller owns the deadline; else a `timeoutMs` controller is used.
export async function fetchExperience({ experimentIds, accessPointNames }, context, opts = {}) {
  const { signal: externalSignal, timeoutMs = 1500 } = opts;
  let signal = externalSignal;
  let timer;
  if (!signal) {
    const controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const body = {
      experimentIds,
      accessPointName: accessPointNames,
      context,
    };
    const res = await fetch(`${apiBase()}/intuit-orchestrator`, {
      method: 'POST',
      credentials: 'include',
      headers: { intuit_tid: intuitTid(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- Response parsing -------------------------------------------------------

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// The experiment decision for an id: the parsed payload (originalCasId/replacementCasId)
// plus the tracking attributes, or null when the id isn't in the response. A missing or
// unchanged replacementCasId is a control arm (no swap) — the caller still records it.
export function experimentDecision(response, id) {
  const entry = response?.experiments?.[id];
  if (!entry) return null;
  const payload = parseJson(entry.payload) || {};
  const ta = entry.trackingAttributes || {};
  return {
    originalCasId: payload.originalCasId || null,
    replacementCasId: payload.replacementCasId || null,
    treatmentId: ta.treatmentId,
    experimentId: ta.experimentId || id,
    experimentIdVersion: ta.experimentIdVersion,
  };
}

// The personalization decision for an access-point name (case-insensitive match; the
// contract spells the map `personalisation`, tolerate `personalization` too): the
// replacement casId + offerId, or null when the name isn't in the response.
export function pznDecision(response, name) {
  const map = response?.personalisation || response?.personalization;
  if (!map || typeof map !== 'object') return null;
  let entry = map[name];
  if (!entry) {
    const want = String(name).toLowerCase();
    const key = Object.keys(map).find((k) => k.toLowerCase() === want);
    entry = key ? map[key] : null;
  }
  if (!entry) return null;
  return { casId: entry.payload || null, offerId: entry.trackingAttributes?.offerId };
}

// --- Analytics records (ECS snake_case, published on window.appVars) ---------

// Normalized pzn record, or null when there's no offer. `content_id` /
// externalContentIdentifier carry the replacement casId.
export function pznRecord(placement, decision) {
  if (!decision || (!decision.offerId && !decision.casId)) return null;
  return {
    personalization_placement: placement,
    personalization_id: decision.offerId,
    personalization_action: 'im',
    personalization_workflow: 'marketing',
    content_id: decision.casId,
    externalContentIdentifier: decision.casId,
  };
}

// Normalized ixp record, or null when the decision lacks experiment identity. Control
// arms still emit a record (exposure) — they just have no replacement_content_id.
export function ixpRecord(decision, path) {
  if (!decision || !decision.experimentId || !decision.treatmentId) return null;
  const record = {
    experiment_id: decision.experimentId,
    experiment_version: decision.experimentIdVersion,
    experiment_treatment: decision.treatmentId,
    original_content_id: decision.originalCasId || path,
  };
  // A replacement that differs from the original is a treatment (a real swap); an
  // absent/identical one is a control arm — recorded for exposure, no replacement.
  if (decision.replacementCasId && decision.replacementCasId !== decision.originalCasId) {
    record.replacement_content_id = decision.replacementCasId;
  }
  return record;
}

// Deduped buffers (survive across the eager + lazy phases), flushed to window.appVars
// on idle so recording never delays the DOM swap or LCP.
const pznById = new Map(); // key: personalization_id (block/section pzn)
const pznPageById = new Map(); // key: personalization_id (whole-page pzn)
const ixpById = new Map(); // key: experiment_id
let flushScheduled = false;

export function ensureAppVars() {
  if (typeof window === 'undefined') return null;
  if (!window.appVars) window.appVars = {};
  return window.appVars;
}

export function flushAppVars() {
  flushScheduled = false;
  const appVars = ensureAppVars();
  if (!appVars) return;
  appVars.pznRecDetailsArr = [...pznById.values()];
  appVars.ixpDetailsArr = [...ixpById.values()];
  appVars.pznPageRecDetailsArr = [...pznPageById.values()];
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(flushAppVars);
  } else {
    setTimeout(flushAppVars, 0);
  }
}

function bufferRecords(map, records, keyField) {
  if (!Array.isArray(records)) return;
  let added = false;
  records.forEach((r) => {
    if (!r) return;
    const key = r[keyField] ?? Symbol('anon');
    if (!map.has(key)) {
      map.set(key, r);
      added = true;
    }
  });
  if (added) scheduleFlush();
}

export function recordPzn(records) { bufferRecords(pznById, records, 'personalization_id'); }
export function recordPznPage(records) { bufferRecords(pznPageById, records, 'personalization_id'); }
export function recordIxp(records) { bufferRecords(ixpById, records, 'experiment_id'); }

export function resetAnalytics() {
  pznById.clear();
  pznPageById.clear();
  ixpById.clear();
  flushScheduled = false;
}

// --- DOM stamping (block-level click channel) -------------------------------

function setAttr(el, name, value) {
  if (value !== undefined && value !== null && value !== '') {
    el.setAttribute(name, String(value));
  }
}

export function stampExperiment(el, rec) {
  if (!el || !rec) return;
  setAttr(el, 'data-experiment-id', rec.experiment_id);
  setAttr(el, 'data-experiment-version', rec.experiment_version);
  setAttr(el, 'data-treatment-id', rec.experiment_treatment);
}

export function stampPzn(el, rec) {
  if (!el || !rec) return;
  setAttr(el, 'data-pzn-placement', rec.personalization_placement);
  setAttr(el, 'data-pzn-id', rec.personalization_id);
}

// --- Applying the response --------------------------------------------------

// Whole-page swap from the cached response, run BEFORE decorateMain. IXP wins when a
// page carries both experiment-id and personalization-id. Caller owns the one-shot
// guard (window.hlx.pageExperienceApplied) and the shared deadline (signal).
export async function applyPage(doc, response, signal) {
  if (!doc || !response) return;
  const pageExp = getMetadata('experiment-id');
  if (pageExp && /^\d+$/.test(pageExp)) {
    const d = experimentDecision(response, pageExp);
    if (!d) return;
    const rec = ixpRecord(d, window.location.pathname);
    if (d.replacementCasId && d.replacementCasId !== d.originalCasId) {
      const path = casToPath(d.replacementCasId);
      if (path && await swapMain(doc, path, signal)) stampExperiment(doc.querySelector('main'), rec);
    }
    if (rec) recordIxp([rec]);
    return;
  }
  const pagePzn = getMetadata('personalization-id');
  if (pagePzn) {
    const d = pznDecision(response, pagePzn);
    if (!d) return;
    const rec = pznRecord(pagePzn, d);
    if (d.casId) {
      const path = casToPath(d.casId);
      if (path && await swapMain(doc, path, signal)) stampPzn(doc.querySelector('main'), rec);
    }
    if (rec) recordPznPage([rec]);
  }
}

// Section/block swaps for `root` from the cached response (no network call). Used
// eagerly for the first/LCP section (awaited) and lazily for the rest (skip = first).
export async function applyLayer(root, response, { skip } = {}) {
  if (!root || !response) return;
  const tasks = [];

  collectExperiments(root, skip).forEach(({ el, id }) => {
    const d = experimentDecision(response, id);
    if (!d) return;
    const rec = ixpRecord(d, window.location.pathname);
    if (d.replacementCasId && d.replacementCasId !== d.originalCasId) {
      const path = casToPath(d.replacementCasId);
      if (path) {
        tasks.push(applyFragment(el, path).then((ok) => { if (ok) stampExperiment(el, rec); }));
      }
    }
    if (rec) recordIxp([rec]);
  });

  collectSlots(root, skip).forEach(({ el, placement }) => {
    const d = pznDecision(response, placement);
    if (!d) return;
    const rec = pznRecord(placement, d);
    if (d.casId) {
      const path = casToPath(d.casId);
      if (path) {
        tasks.push(applyFragment(el, path).then((ok) => { if (ok) stampPzn(el, rec); }));
      }
    }
    if (rec) recordPzn([rec]);
  });

  await Promise.all(tasks);
}
