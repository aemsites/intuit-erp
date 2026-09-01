// The experience layer: ONE consolidated /api/intuit-orchestrator call per page for both
// experimentation (IXP) and personalization (PZN) — collect ids/names, fetch, cache, swap
// (whole-page + first section pre-LCP, rest after). A whole-page swap may trigger one more
// call for the swapped-in content's own section/block slots (recursion-safe).

import { getMetadata } from './aem.js';
import { buildIntentContext, getIntentProfile } from './of1-intent.js';

// Perf telemetry is sampled before any observers/marks/measures are installed, keeping
// unsampled views off the LCP path. `?perf=on` forces instrumentation and console output.
const PERF_ON = (() => {
  try {
    return new URLSearchParams(window.location.search).get('perf') === 'on';
  } catch {
    return false;
  }
})();

// Fraction of page views that send the experience-perf log to Splunk (1 = every view).
const PERF_SAMPLE_RATE = 0.1;
// How long after load to let LCP/lazy layers settle before reporting.
const PERF_REPORT_DELAY_MS = 6000;
const PERF_ENABLED = PERF_ON || Math.random() < PERF_SAMPLE_RATE;

const round1 = (n) => Math.round(n * 10) / 10;

// Mark/measure that can never throw (measure raises if its start mark is missing —
// possible when phases run standalone, e.g. in tests or partial page flows).
function perfMark(name) {
  if (!PERF_ENABLED) return;
  try { performance.mark(name); } catch { /* ignore */ }
}
function perfMeasure(name, start, end) {
  if (!PERF_ENABLED) return;
  try { performance.measure(name, start, end); } catch { /* ignore */ }
}

// exp:* measure name → flat Splunk field.
const PERF_MEASURE_FIELDS = {
  'exp:eager-decision': 'eagerDecisionMs',
  'exp:page-swap': 'pageSwapMs',
  'exp:first-section-swap': 'firstSectionSwapMs',
  'exp:eager-total': 'eagerTotalMs',
  'exp:lazy-layers': 'lazyLayersMs',
};

// Flattens the captured entries + page details into ONE flat object (stable `event` key,
// numeric *Ms fields, absent metrics omitted — never null/0 placeholders) so Splunk
// spath/stats queries stay trivial. Pure: everything visible from the args + DOM reads.
export function buildPerfPayload({
  measures = [], orchestrator = [], lcp, fcp, nav,
} = {}) {
  const payload = {
    event: 'experience-perf',
    pageUrl: window.location.href,
    pagePath: window.location.pathname,
    viewportWidth: window.innerWidth,
  };
  // Page details (omitted when absent).
  if (document.referrer) payload.pageReferrer = document.referrer;
  if (document.documentElement.lang) payload.pageLocale = document.documentElement.lang;
  const template = getMetadata('template');
  if (template) payload.pageTemplate = template;
  const pageExp = getMetadata('experiment-id');
  if (pageExp) payload.pageExperimentId = pageExp;
  const pagePzn = getMetadata('personalization-id');
  if (pagePzn) payload.pagePersonalizationId = pagePzn;
  const connection = navigator.connection?.effectiveType;
  if (connection) payload.connectionType = connection;
  // Stitching phases.
  measures.forEach((e) => {
    const field = PERF_MEASURE_FIELDS[e.name];
    if (field) payload[field] = round1(e.duration);
  });
  // Orchestrator calls: 1st = decision call, 2nd = resolveSwappedSlots follow-up.
  payload.orchestratorCalls = orchestrator.length;
  orchestrator.slice(0, 2).forEach((e, i) => {
    const prefix = i === 0 ? 'orchestrator' : `orchestrator${i + 1}`;
    payload[`${prefix}Ms`] = round1(e.responseEnd - e.startTime);
    payload[`${prefix}TtfbMs`] = round1(e.responseStart - e.requestStart);
  });
  // Overall page performance.
  if (lcp) payload.lcpMs = round1(lcp.startTime);
  if (fcp) payload.fcpMs = round1(fcp.startTime);
  if (nav) {
    payload.ttfbMs = round1(nav.responseStart);
    payload.domContentLoadedMs = round1(nav.domContentLoadedEventEnd);
    if (nav.loadEventEnd > 0) payload.loadMs = round1(nav.loadEventEnd);
  }
  return payload;
}

(() => {
  if (!PERF_ENABLED) return;
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  // Capture entries with a PerformanceObserver into private arrays as they fire: observer delivery
  // is independent of the shared timeline, so another script's performance.clear*() (martech/RUM
  // buffer cleanup) can't evict our data before we report.
  let lcpEntry;
  let fcpEntry;
  const measures = [];
  const orchestrator = [];
  const observe = (type, onEntry) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry))
        .observe({ type, buffered: true });
    } catch { /* entry type unsupported — ignore */ }
  };
  observe('largest-contentful-paint', (e) => { lcpEntry = e; });
  observe('paint', (e) => { if (e.name === 'first-contentful-paint') fcpEntry = e; });
  observe('measure', (e) => { if (e.name.startsWith('exp:')) measures.push(e); });
  // The 1st decision call and any 2nd resolveSwappedSlots call each get their own entry.
  observe('resource', (e) => { if (e.name.includes('intuit-orchestrator')) orchestrator.push(e); });

  const collect = () => buildPerfPayload({
    measures,
    orchestrator,
    lcp: lcpEntry,
    fcp: fcpEntry,
    nav: performance.getEntriesByType?.('navigation')?.[0],
  });

  // Console report (opt-in) — same numbers, table form.
  const report = () => {
    const rows = {};
    measures.forEach((e) => { rows[e.name] = { ms: round1(e.duration) }; });
    orchestrator.forEach((e, i) => {
      rows[`orchestrator-call[${i}]`] = {
        ms: round1(e.responseEnd - e.startTime),
        ttfb: round1(e.responseStart - e.requestStart),
      };
    });
    if (lcpEntry) rows['LCP (browser)'] = { ms: round1(lcpEntry.startTime) };
    // eslint-disable-next-line no-console
    console.table(rows);
    return rows;
  };

  // One Splunk-bound log per sampled view, via the erp-logging bridge (head.html). Logger
  // absent (script blocked/failed) ⇒ silent no-op. Fires once.
  let sent = false;
  const sendPerfLog = () => {
    if (sent) return;
    const logger = window.coreServiceAdapter?.logger;
    if (!logger?.info) return;
    sent = true;
    const payload = collect();
    payload.sampleRate = PERF_ON ? 1 : PERF_SAMPLE_RATE;
    try {
      logger.info('experience-perf', payload);
    } catch { /* logging must never break the page */ }
  };

  window.hlx = window.hlx || {};
  window.hlx.experiencePerf = { report, collect };
  setTimeout(() => {
    if (PERF_ON) report();
    sendPerfLog();
  }, PERF_REPORT_DELAY_MS);
})();

// --- Endpoint + fetch primitives -------------------------------------------

// API base: `experience-api-base` metadata override, else same-origin /api (Akamai-fronted).
export function apiBase() {
  return (getMetadata('experience-api-base') || '/api').replace(/\/+$/, '');
}

// Normalizes an UNTRUSTED response ref to a SAFE same-origin root-absolute path (or null).
// Keeps ONLY the URL pathname so a cross-origin/protocol-relative ref can't redirect the
// fetch off-origin; rejects non-http(s) schemes and bare `/`.
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

// A casId is a content path today, so reuse the same safe normalization (single seam).
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

// Resolves to the promise's value, or undefined after ms (fail-open phase bound).
export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(resolve, () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
}

// Replaces <main>'s content with a variation's plain.html for the caller to decorate.
// Signal-bound + fail-open; returns true when the swap lands.
export async function swapMain(doc, path, signal) {
  const main = doc.querySelector('main');
  const p = fragmentPath(path);
  if (!main || !p) return false;
  try {
    // Folder-index pages serve content only at /foo/index.plain.html, not /foo/.plain.html
    const plainPath = p.endsWith('/') ? `${p}index` : p;
    const resp = await fetch(`${plainPath}.plain.html`, { signal });
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
  }
}

// Loads a fragment into `targetEl` — replacing children, or appending with opts.append.
// Returns true when applied.
export async function applyFragment(targetEl, path, opts = {}) {
  const p = fragmentPath(path);
  if (!targetEl || !p) return false;
  try {
    const load = opts.loadFragment
      // eslint-disable-next-line import/no-cycle
      || (await import('../blocks/fragment/fragment.js')).loadFragment;
    const frag = await load(p);
    if (!frag) return false;
    if (opts.append) targetEl.append(...frag.childNodes);
    else targetEl.replaceChildren(...frag.childNodes);
    return true;
  } catch {
    return false;
  }
}

// --- Request context (front-end signals) -----------------------------------

// Visitor id from the first-party `ivid` cookie (Akamai injects it server-side if HttpOnly).
export function resolveIvid() {
  try {
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

// Orchestrator wants underscore locale (en_US), not BCP 47 hyphen (en-US).
function underscoreLocale(value) {
  return String(value || '').replace(/-/g, '_') || 'en_US';
}

// The sibling `context`: front-end signals + AOF1 intent. NOT ZoomInfo (orchestrator
// enriches server-side) and NOT geo (Akamai injects it).
function defaultPermalink() {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.delete('preview');
  url.searchParams.delete('previewContext');
  return url.toString();
}

export function buildContext(permalink = defaultPermalink()) {
  const context = {
    permalink,
    locale: underscoreLocale(
      new URLSearchParams(window.location.search).get('locale') || navigator.language || 'en_US',
    ),
    deviceType: deviceType(),
    newVisitor: true,
  };
  const ivid = resolveIvid();
  if (ivid) context.ivid = ivid;
  context.casId = new URL(permalink, window.location.origin).pathname;
  const { width, height } = (typeof window !== 'undefined' && window.screen) || {};
  if (width && height) context.screenResolution = `${width}x${height}`;
  const of1Intent = buildIntentContext(getIntentProfile());
  if (of1Intent) context.of1Intent = of1Intent;
  return context;
}

// --- Target collection ------------------------------------------------------

// True when data-pzn and data-exp aim at the SAME target (whole-section or same block) —
// the case where IXP wins; different blocks run independently.
export function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Finds a named block by data-block-name (post-decorate) OR class (pipeline-emitted), so
// block scope resolves in any decoration phase.
export function resolveBlock(section, block) {
  return section.querySelector(`[data-block-name="${block}"], [class~="${block}"]`);
}

// Numeric data-exp sections under `root` (minus `skip`); a data-exp-block scopes to that
// block, else the whole section. Non-numeric ids dropped.
export function collectExperiments(root, skip) {
  const sections = [];
  if (root.matches?.('[data-exp]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-exp]').forEach((s) => { if (s !== skip) sections.push(s); });

  const experiments = [];
  sections.forEach((section) => {
    const id = section.dataset.exp;
    if (!id || !/^\d+$/.test(id)) return;
    const block = section.dataset.expBlock;
    const el = block ? resolveBlock(section, block) : section;
    const append = section.dataset.expMode === 'append';
    if (el) {
      experiments.push({
        el, id, fidelity: block ? 'block' : 'section', append,
      });
    }
  });
  return experiments;
}

// data-pzn sections under `root` (minus `skip`); data-pzn-block scopes to that block.
// Dropped when the same target also carries an experiment (IXP wins).
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
    const el = block ? resolveBlock(section, block) : section;
    const append = section.dataset.pznMode === 'append';
    if (el) slots.push({ el, placement, append });
  });
  return slots;
}

// The single call's lists: page metadata + all section/block ids/names, de-duped,
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

// Query string for /intuit-orchestrator when preview mode is active. opts.preview (the
// Experience Preview tool) wins so an edited context is never shadowed by a stale page URL;
// else a page loaded with ?preview=true forwards ONLY preview + previewContext (never the
// rest of the page query — utm_*/gclid etc. stay off the orchestrator URL).
function previewOrchestratorQuery(opts, context) {
  if (opts.preview) {
    const params = new URLSearchParams({ preview: 'true' });
    if (context) params.set('previewContext', JSON.stringify(context));
    return params.toString();
  }
  if (typeof window !== 'undefined') {
    const page = new URLSearchParams(window.location.search);
    if (page.get('preview') === 'true') {
      const params = new URLSearchParams({ preview: 'true' });
      const previewContext = page.get('previewContext');
      if (previewContext) params.set('previewContext', previewContext);
      return params.toString();
    }
  }
  return '';
}

// POSTs the request; returns the parsed response or null (fail-open) on any failure.
// With `signal` the caller owns the deadline, else `timeoutMs` applies.
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
    // Preview seam: opts.preview or a page-level ?preview=true adds preview=true +
    // previewContext to the target URL so Akamai routes to the preview backend. baseUrl
    // overrides the host. No preview ⇒ identical prod URL.
    const apiRoot = (opts.baseUrl || apiBase()).replace(/\/+$/, '');
    const previewQs = previewOrchestratorQuery(opts, context);
    const target = `${apiRoot}/intuit-orchestrator${previewQs ? `?${previewQs}` : ''}`;
    const res = await fetch(target, {
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

// The experiment decision for an id (or null if absent). A missing/unchanged
// replacementCasId is a control arm — recorded but not swapped.
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

// The pzn decision for an access-point name (case-insensitive; map spelled `personalisation`
// or `personalization`), or null if absent. contentId holds the fragment path (a legacy
// raw-string payload is accepted as the path too).
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
  const { payload } = entry;
  const contentId = (payload && typeof payload === 'object')
    ? (payload.contentId || null)
    : (payload || null);
  return { contentId, offerId: entry.trackingAttributes?.offerId };
}

// --- Analytics records (ECS snake_case, published on window.appVars) ---------

// Normalized pzn record, or null when there's no offer/content.
export function pznRecord(placement, decision) {
  if (!decision || (!decision.offerId && !decision.contentId)) return null;
  const record = {
    personalization_placement: placement,
    personalization_id: decision.offerId,
    personalization_action: 'im',
    personalization_workflow: 'marketing',
  };
  if (decision.contentId) {
    record.content_id = decision.contentId;
    record.externalContentIdentifier = decision.contentId;
  }
  return record;
}

// Normalized ixp record, or null without experiment identity. Control arms still emit a
// record (exposure) — just without replacement_content_id.
export function ixpRecord(decision, path) {
  if (!decision || !decision.experimentId || !decision.treatmentId) return null;
  const record = {
    experiment_id: decision.experimentId,
    experiment_version: decision.experimentIdVersion,
    experiment_treatment: decision.treatmentId,
    original_content_id: decision.originalCasId || path,
  };
  // Treatment (real swap) carries a replacement; control/identical does not.
  if (decision.replacementCasId && decision.replacementCasId !== decision.originalCasId) {
    record.replacement_content_id = decision.replacementCasId;
  }
  return record;
}

// Deduped buffers (survive eager + lazy), flushed to window.appVars on idle so recording
// never delays the DOM swap or LCP.
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

const FS_READY_TIMEOUT_MS = 10000;
let fsReadyPromise;
let fsReadyTimer;

// Resolves the FS function once present, or null on timeout (dev/localhost never load FS).
// Memoized: at most ONE interval runs per page; every caller awaits the same promise.
export function whenFullStoryReady({ intervalMs = 200, timeoutMs = FS_READY_TIMEOUT_MS } = {}) {
  if (fsReadyPromise) return fsReadyPromise;
  const fsFn = () => {
    // eslint-disable-next-line no-underscore-dangle -- FullStory's fixed global name
    const ns = typeof window !== 'undefined' && window._fs_namespace;
    return ns && typeof window[ns] === 'function' ? window[ns] : null;
  };
  fsReadyPromise = new Promise((resolve) => {
    const ready = fsFn();
    if (ready) { resolve(ready); return; }
    const deadline = Date.now() + timeoutMs;
    fsReadyTimer = setInterval(() => {
      const fn = fsFn();
      if (fn || Date.now() >= deadline) {
        clearInterval(fsReadyTimer);
        fsReadyTimer = undefined;
        resolve(fn || null);
      }
    }, intervalMs);
  });
  return fsReadyPromise;
}

// Fires a FullStory custom event when swapped (treatment/offer) content is actually viewed.
export function notifyFullStory(event, id, name, opts) {
  if (typeof window === 'undefined' || !event || !id) return;
  whenFullStoryReady(opts).then((fs) => {
    if (fs) {
      try {
        fs.event(event, { id, name });
      } catch { /* fail-open */ }
    }
  });
}

export function resetAnalytics() {
  pznById.clear();
  pznPageById.clear();
  ixpById.clear();
  flushScheduled = false;
  if (fsReadyTimer) { clearInterval(fsReadyTimer); fsReadyTimer = undefined; }
  fsReadyPromise = undefined;
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

// The full data-pzn-* set the click tracker walks; setAttr skips blanks, so a record stamps
// only what it carries.
export function stampPzn(el, rec) {
  if (!el || !rec) return;
  setAttr(el, 'data-pzn-placement', rec.personalization_placement);
  setAttr(el, 'data-pzn-id', rec.personalization_id);
  setAttr(el, 'data-pzn-action', rec.personalization_action);
  setAttr(el, 'data-pzn-workflow', rec.personalization_workflow);
  setAttr(el, 'data-pzn-model-name', rec.model_name);
  setAttr(el, 'data-pzn-model-version', rec.model_version);
}

// --- Applying the response --------------------------------------------------

// Two helpers = the ONE place each apply-shape lives: decision → apply treatment content →
// record exposure, stamp + notify. Control experiments are exposed when their apply phase runs.
// applyPage feeds them swapMain (whole page); applyLayer feeds applyFragment (an element). `track`
// (default true at the public entry points) gates EVERY analytics side effect — appVars
// records, click-tracker stamps, and FullStory events — so a preview/simulation can swap
// content read-only, without biasing the very experiment data it's measuring.

async function applyExperiment(response, id, stampTarget, applyContent, record, track) {
  const d = experimentDecision(response, id);
  if (!d) return false;
  const rec = ixpRecord(d, window.location.pathname);
  if (!d.replacementCasId || d.replacementCasId === d.originalCasId) {
    if (rec && track) record([rec]);
    return false;
  }
  const path = casToPath(d.replacementCasId);
  if (!path || !(await applyContent(path))) return false;
  if (track) {
    if (rec) record([rec]);
    stampExperiment(stampTarget, rec);
    notifyFullStory('Experiment Viewed', rec?.experiment_treatment, rec?.experiment_id);
  }
  return true;
}

async function applyPznSlot(response, placement, stampTarget, applyContent, record, track) {
  const d = pznDecision(response, placement);
  if (!d) return false;
  const rec = pznRecord(placement, d);
  if (!d.contentId) {
    if (rec && track) record([rec]);
    return false;
  }
  const path = casToPath(d.contentId);
  if (!path || !(await applyContent(path))) return false;
  if (track) {
    if (rec) record([rec]);
    stampPzn(stampTarget, rec);
    notifyFullStory('Personalization Viewed', rec?.personalization_id, rec?.personalization_placement);
  }
  return true;
}

// Whole-page swap from the cached response, BEFORE decorateMain. IXP wins over PZN.
// Returns whether a swap landed. `track:false` swaps content without any analytics.
export async function applyPage(doc, response, signal, { track = true } = {}) {
  if (!doc || !response) return false;
  const target = doc.querySelector('main');
  const swap = (p) => swapMain(doc, p, signal);
  const pageExp = getMetadata('experiment-id');
  if (pageExp && /^\d+$/.test(pageExp)) {
    return applyExperiment(response, pageExp, target, swap, recordIxp, track);
  }
  const pagePzn = getMetadata('personalization-id');
  if (pagePzn) return applyPznSlot(response, pagePzn, target, swap, recordPznPage, track);
  return false;
}

// Section/block swaps for `root` from the cached response (no network call). Eager for the
// first/LCP section (awaited), lazy for the rest (skip = first). `track:false` = read-only.
export async function applyLayer(root, response, { skip, track = true } = {}) {
  if (!root || !response) return;
  const tasks = [];
  collectExperiments(root, skip).forEach(({ el, id, append }) => {
    const apply = (p) => applyFragment(el, p, { append });
    tasks.push(applyExperiment(response, id, el, apply, recordIxp, track));
  });
  collectSlots(root, skip).forEach(({ el, placement, append }) => {
    const apply = (p) => applyFragment(el, p, { append });
    tasks.push(applyPznSlot(response, placement, el, apply, recordPzn, track));
  });
  await Promise.all(tasks);
}

// --- Post-swap resolution (the at-most-one SECOND call) ---------------------

// Unions a follow-up response into the base (follow-up wins). Tolerates both
// `personalisation` / `personalization` spellings.
export function mergeExperience(base, extra) {
  if (!extra) return base || null;
  if (!base) return extra;
  return {
    ...base,
    experiments: { ...(base.experiments || {}), ...(extra.experiments || {}) },
    personalisation: {
      ...(base.personalisation || base.personalization || {}),
      ...(extra.personalisation || extra.personalization || {}),
    },
  };
}

// Section/block-ONLY request for `root` (no page-level metadata) — the omission keeps the
// post-swap call recursion-safe: a variation's page-level tags are never re-collected.
export function collectSwapRequest(root) {
  const experimentIds = new Set();
  const accessPointNames = new Set();
  if (root) {
    collectExperiments(root).forEach(({ id }) => experimentIds.add(id));
    collectSlots(root).forEach(({ placement }) => accessPointNames.add(placement));
  }
  return { experimentIds: [...experimentIds], accessPointNames: [...accessPointNames] };
}

// After a whole-page swap (post-decorateMain): collect the swapped-in content's OWN
// section/block slots and, if any, make ONE more call merged into experienceResponse.
// Returns { firstSectionAffected, done }; caller blocks paint only if the first is affected.
export function resolveSwappedSlots(doc, { timeoutMs = 1500 } = {}) {
  const main = doc?.querySelector('main');
  const noop = { firstSectionAffected: false, done: Promise.resolve() };
  if (!main) return noop;
  const req = collectSwapRequest(main);
  if (!req.experimentIds.length && !req.accessPointNames.length) return noop;
  const firstReq = collectSwapRequest(main.querySelector('.section'));
  const firstSectionAffected = !!(
    firstReq.experimentIds.length || firstReq.accessPointNames.length
  );
  const done = (async () => {
    try {
      const extra = await fetchExperience(req, buildContext(), { timeoutMs });
      if (extra && typeof window !== 'undefined') {
        window.hlx = window.hlx || {};
        window.hlx.experienceResponse = mergeExperience(window.hlx.experienceResponse, extra);
      }
    } catch { /* fail-open — baseline stays */ }
  })();
  return { firstSectionAffected, done };
}

// --- Phase entry points (the experience surface scripts.js drives) ----------

const EAGER_DEADLINE_MS = 1500; // visual decision budget before baseline reveal
const EAGER_APPLY_MS = 2000; // budget for swapping the first/LCP section before reveal
const DECISION_DEADLINE_MS = 5000; // lets late decisions reach lazy regions without delaying paint

// EAGER, before decorateMain: the one consolidated call + whole-page swap (runs once).
// Caches the decision; returns whether a page swap landed.
export async function applyPageExperience(doc) {
  window.hlx = window.hlx || {};
  if (window.hlx.pageExperienceApplied) return false;
  window.hlx.pageExperienceApplied = true;
  perfMark('exp:eager-start');
  const request = collectRequest(doc);
  if (!request.experimentIds.length && !request.accessPointNames.length) return false;
  const decisionController = new AbortController();
  const decisionTimer = setTimeout(() => decisionController.abort(), DECISION_DEADLINE_MS);
  const responsePromise = fetchExperience(request, buildContext(), {
    signal: decisionController.signal,
  }).then((response) => {
    window.hlx.experienceResponse = response;
    return response;
  }).finally(() => clearTimeout(decisionTimer));
  window.hlx.experienceResponsePromise = responsePromise;

  const eagerController = new AbortController();
  const eagerTimer = setTimeout(() => eagerController.abort(), EAGER_DEADLINE_MS);
  try {
    const response = await withTimeout(responsePromise, EAGER_DEADLINE_MS);
    perfMark('exp:decision-ready');
    perfMeasure('exp:eager-decision', 'exp:eager-start', 'exp:decision-ready');
    if (!response) return false;
    perfMark('exp:page-swap:start');
    const applied = await applyPage(doc, response, eagerController.signal);
    perfMark('exp:page-swap:end');
    perfMeasure('exp:page-swap', 'exp:page-swap:start', 'exp:page-swap:end');
    return applied;
  } finally {
    clearTimeout(eagerTimer);
  }
}

// EAGER, after decorateMain: on a page swap, resolve the swapped-in content's own slots
// (blocking paint only if the first section is affected), then swap the first/LCP section.
export async function applyEagerLayers(doc, pageSwapped) {
  const main = doc.querySelector('main');
  if (!main || !window.hlx?.experienceResponse) return;
  if (pageSwapped) {
    const swap = resolveSwappedSlots(doc, { timeoutMs: DECISION_DEADLINE_MS });
    window.hlx.experienceSwapResolved = swap.done;
    if (swap.firstSectionAffected) await withTimeout(swap.done, EAGER_DEADLINE_MS);
  }
  const firstSection = main.querySelector('.section');
  if (firstSection) {
    perfMark('exp:first-section-swap:start');
    await withTimeout(applyLayer(firstSection, window.hlx.experienceResponse), EAGER_APPLY_MS);
    perfMark('exp:first-section-swap:end');
    perfMeasure('exp:first-section-swap', 'exp:first-section-swap:start', 'exp:first-section-swap:end');
  }
  perfMark('exp:eager-layers-end');
  perfMeasure('exp:eager-total', 'exp:eager-start', 'exp:eager-layers-end');
}

async function latestExperienceResponse() {
  const initial = window.hlx?.experienceResponse
    || await window.hlx?.experienceResponsePromise;
  if (!initial) return null;
  if (window.hlx.experienceSwapResolved) await window.hlx.experienceSwapResolved;
  return window.hlx?.experienceResponse || initial;
}

// Gives successful lazy applications the bounded decision window to record exposure before the
// one-shot page view. A late assignment that never renders contributes no treatment context.
export async function prepareExperienceTracking(application) {
  if (application) await withTimeout(application, DECISION_DEADLINE_MS);
  flushAppVars();
}

// LAZY: swap every remaining (below-the-fold) section, after any 2nd-call merge has landed.
export async function applyLazyLayers(doc) {
  const main = doc.querySelector('main');
  if (!main) return;
  const response = await latestExperienceResponse();
  if (!response) return;
  perfMark('exp:lazy-layers:start');
  await applyLayer(main, response, { skip: main.querySelector('.section') });
  perfMark('exp:lazy-layers:end');
  perfMeasure('exp:lazy-layers', 'exp:lazy-layers:start', 'exp:lazy-layers:end');
}

// Starts lazy application immediately and gives its real exposures the bounded opportunity to
// reach the one-shot page view. Keeping this wiring here makes the ordering contract testable.
export async function applyLazyExperience(doc) {
  const application = applyLazyLayers(doc);
  await prepareExperienceTracking(application);
}
