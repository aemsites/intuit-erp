/* eslint-disable no-use-before-define */
/*
 * Experience Preview engine — PREVIEW-ONLY.
 *
 * Drives the live aem.page preview so the "Experience Preview" sidekick palette can show
 * authors how each personalization/experimentation variant (or a simulated visitor
 * context) renders — using the exact production swap code in experience.js, so a preview
 * is byte-for-byte what a visitor would get.
 *
 * Loaded only on aem.page / hlx.page / localhost (gated in scripts.js) and self-asserts
 * the host below, so it never runs on live/prod. The palette talks to it over postMessage
 * (works even when the sidekick loads the palette in an opaque 'null' origin), and the same
 * API is exposed on window.hlx.experiencePreview for driving it straight from devtools.
 */
// eslint-disable-next-line import/no-cycle
import {
  buildContext,
  collectRequest,
  fetchExperience,
  applyPage,
  applyLayer,
  swapMain,
  applyFragment,
  fragmentPath,
  sameTargetAsExp,
  experimentDecision,
  pznDecision,
} from './experience.js';
import { loadSections, getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { decorateMain } from './scripts.js';

const NS = 'intuit-exp-preview';
const MAX_VARIANTS = 5;
const SIMULATE_TIMEOUT_MS = 8000;

let initialized = false;
let currentTargets = [];
const baseline = new Map(); // target.key -> authored innerHTML snapshot (section/block scope)
let applyController = null;

// Only true on preview/dev hosts — the single gate that keeps this inert on live/prod.
export function isPreviewHost() {
  const h = window.location.hostname;
  return /\.(aem|hlx)\.page$/.test(h) || h === 'localhost' || h === '127.0.0.1';
}

// --- Variant + target discovery --------------------------------------------

// Normalize an authored variant ref to a same-origin pathname (mirrors the tools/plugins
// personalization toPath semantics; kept local so the page runtime never imports the DA tool).
function toPath(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    return new URL(v, window.location.origin).pathname;
  } catch {
    return v;
  }
}

function splitVariants(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(toPath)
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
}

function sectionEls() {
  const main = document.querySelector('main');
  return main ? [...main.querySelectorAll(':scope > .section')] : [];
}

// The row title carries location only; the kind (exp/pzn) is shown by the colored chip.
function labelFor(sectionIndex, blockName) {
  const scope = blockName ? `block “${blockName}”` : 'whole section';
  return `Section ${sectionIndex + 1} · ${scope}`;
}

// Enumerate every pzn/exp target on the page (page + section + block), each with its
// candidate variant fragment paths. Read once from the server-rendered DOM (where the
// pipeline has already emitted data-exp/data-pzn/*-variants); elements are re-resolved
// positionally at apply time, so this list stays valid across swaps.
function enumerateTargets() {
  const targets = [];

  const pageExp = (getMetadata('experiment-id') || '').trim();
  if (/^\d+$/.test(pageExp)) {
    targets.push({
      key: `page:exp:${pageExp}`,
      kind: 'exp',
      scope: 'page',
      id: pageExp,
      sectionIndex: -1,
      blockName: null,
      mode: 'swap',
      label: 'Whole page',
      variants: splitVariants(getMetadata('experiment-variants')),
    });
  }
  const pagePzn = (getMetadata('personalization-id') || '').trim();
  if (pagePzn) {
    targets.push({
      key: `page:pzn:${pagePzn}`,
      kind: 'pzn',
      scope: 'page',
      id: pagePzn,
      sectionIndex: -1,
      blockName: null,
      mode: 'swap',
      label: 'Whole page',
      variants: splitVariants(getMetadata('personalization-variants')),
    });
  }

  sectionEls().forEach((section, sectionIndex) => {
    const d = section.dataset;
    const exp = (d.exp || '').trim();
    if (/^\d+$/.test(exp)) {
      targets.push({
        key: `s${sectionIndex}:exp:${exp}`,
        kind: 'exp',
        scope: d.expBlock ? 'block' : 'section',
        id: exp,
        sectionIndex,
        blockName: d.expBlock || null,
        mode: d.expMode === 'append' ? 'append' : 'swap',
        label: labelFor(sectionIndex, d.expBlock),
        variants: splitVariants(d.expVariants),
      });
    }
    const pzn = (d.pzn || '').trim();
    if (pzn) {
      targets.push({
        key: `s${sectionIndex}:pzn:${pzn}`,
        kind: 'pzn',
        scope: d.pznBlock ? 'block' : 'section',
        id: pzn,
        sectionIndex,
        blockName: d.pznBlock || null,
        mode: d.pznMode === 'append' ? 'append' : 'swap',
        label: labelFor(sectionIndex, d.pznBlock),
        variants: splitVariants(d.pznVariants),
        // IXP wins when the same target also carries an experiment: the runtime drops
        // this pzn slot, so flag it (still previewable in isolation).
        droppedByIxp: !!d.exp && sameTargetAsExp(section),
      });
    }
  });

  return targets;
}

function findTarget(key) {
  return currentTargets.find((t) => t.key === key) || null;
}

// Re-resolve a target's live element by position (never cache DOM nodes — they don't
// survive re-decoration). Page scope = <main>.
function resolveEl(target) {
  const main = document.querySelector('main');
  if (!main) return null;
  if (target.scope === 'page') return main;
  const section = sectionEls()[target.sectionIndex];
  if (!section) return null;
  if (target.scope === 'block' && target.blockName) {
    return section.querySelector(`[data-block-name="${target.blockName}"]`);
  }
  return section;
}

// --- Applying variants -------------------------------------------------------

// One controller at a time: a new apply aborts any in-flight swap so overlapping clicks
// can't race a stale fetch onto the page.
function nextSignal() {
  if (applyController) applyController.abort();
  applyController = new AbortController();
  return applyController.signal;
}

// Whole-page swap + full re-decoration — exactly loadEager's post-swap sequence, since
// swapMain writes raw innerHTML.
async function swapAndDecorate(path, signal) {
  const ok = await swapMain(document, path, signal);
  if (!ok) return false;
  const main = document.querySelector('main');
  decorateMain(main);
  await loadSections(main);
  return true;
}

function snapshotBaselines(targets) {
  baseline.clear();
  targets.forEach((t) => {
    if (t.scope === 'page') return;
    const el = resolveEl(t);
    if (el) baseline.set(t.key, el.innerHTML);
  });
}

// Re-fetch the authored page and rebuild it (with live block JS) — the guaranteed-clean
// full reset. Also the pre-step for context simulation.
export async function resetToBaseline() {
  const signal = nextSignal();
  const ok = await swapAndDecorate(window.location.pathname, signal);
  if (ok) snapshotBaselines(currentTargets);
  return { applied: ok, reason: ok ? undefined : 'baseline-fetch-failed' };
}

// loadFragment/swapMain swallow the HTTP status, so on failure re-check the variant's
// .plain.html to give the author an actionable reason instead of a bare "apply-failed".
async function describeFragmentFailure(p) {
  try {
    const resp = await fetch(`${p}.plain.html`, { cache: 'no-store' });
    if (resp.status === 404) return `Fragment not found (404): ${p}`;
    if (resp.status === 401) return `Not signed in (401) — sign in to the preview site to view this fragment: ${p}`;
    if (resp.status === 403) return `No permission (403) — you don’t have access to view this fragment: ${p}`;
    if (!resp.ok) return `Fragment failed to load (${resp.status}): ${p}`;
    return `Fragment loaded but could not be applied: ${p}`;
  } catch {
    return `Could not fetch fragment: ${p}`;
  }
}

// Apply one variant fragment to one target (or restore its authored default).
export async function applyVariant(target, path) {
  if (!target) return { applied: false, reason: 'Unknown target.' };

  if (!path || path === '__default__') {
    if (target.scope === 'page') return resetToBaseline();
    const el = resolveEl(target);
    if (!el) return { applied: false, reason: 'Target not found on the page.' };
    if (baseline.has(target.key)) {
      el.innerHTML = baseline.get(target.key);
      return { applied: true };
    }
    return resetToBaseline();
  }

  const p = fragmentPath(path);
  if (!p) return { applied: false, reason: `Invalid variant path: ${path}` };

  if (target.scope === 'page') {
    const ok = await swapAndDecorate(p, nextSignal());
    return { applied: ok, reason: ok ? undefined : await describeFragmentFailure(p) };
  }

  const el = resolveEl(target);
  if (!el) return { applied: false, reason: 'Target not found on the page.' };
  // Start from the authored content each time so switching variants (and append mode)
  // never stacks fragments.
  if (baseline.has(target.key)) el.innerHTML = baseline.get(target.key);
  const ok = await applyFragment(el, p, { append: target.mode === 'append' });
  return { applied: ok, reason: ok ? undefined : await describeFragmentFailure(p) };
}

// --- Context simulation (Phase 2) -------------------------------------------

export function getContext() {
  return buildContext();
}

// True when applyPage would swap <main> for a real page-level treatment (so we know to
// re-decorate afterward, mirroring loadEager).
function pageWillSwap(response) {
  const pageExp = (getMetadata('experiment-id') || '').trim();
  if (/^\d+$/.test(pageExp)) {
    const d = experimentDecision(response, pageExp);
    return !!(d && d.replacementCasId && d.replacementCasId !== d.originalCasId);
  }
  const pagePzn = (getMetadata('personalization-id') || '').trim();
  if (pagePzn) {
    const d = pznDecision(response, pagePzn);
    return !!(d && d.contentId);
  }
  return false;
}

function summarizeResponse(response) {
  const req = collectRequest(document);
  const out = [];
  req.experimentIds.forEach((id) => {
    const d = experimentDecision(response, id);
    if (d) {
      out.push({
        kind: 'exp', id, replacement: d.replacementCasId, treatment: d.treatmentId,
      });
    }
  });
  req.accessPointNames.forEach((name) => {
    const d = pznDecision(response, name);
    if (d) {
      out.push({
        kind: 'pzn', id: name, replacement: d.contentId, offer: d.offerId,
      });
    }
  });
  return out;
}

// Send a (possibly edited) context to the orchestrator and apply its real decision. Adds
// ?preview=true (Akamai routes to the preview backend) + edited attrs as query params.
export async function simulateContext(context, opts = {}) {
  const signal = nextSignal();
  await swapAndDecorate(window.location.pathname, signal); // clean slate

  const request = collectRequest(document);
  if (!request.experimentIds.length && !request.accessPointNames.length) {
    return { applied: false, reason: 'no-targets' };
  }

  const prev = window.hlx?.experienceResponse;
  const response = await fetchExperience(request, context || buildContext(), {
    signal,
    preview: true, // always on for the preview tool; change here if that ever flips
    previewParams: opts.previewParams,
    baseUrl: opts.baseUrl,
    timeoutMs: SIMULATE_TIMEOUT_MS,
  });
  if (!response) return { applied: false, reason: 'no-response' };

  try {
    // track:false — this is a read-only preview, so suppress ALL analytics (FullStory
    // events, appVars pzn/ixp records, click-tracker stamps).
    const willSwap = pageWillSwap(response);
    await applyPage(document, response, signal, { track: false });
    const main = document.querySelector('main');
    if (willSwap) {
      decorateMain(main);
      await loadSections(main);
    }
    await applyLayer(main, response, { track: false });
  } finally {
    if (window.hlx) window.hlx.experienceResponse = prev; // don't disturb the runtime cache
  }
  return { applied: true, decisions: summarizeResponse(response) };
}

// --- postMessage transport ---------------------------------------------------

function isTrustedOrigin(origin) {
  if (origin === 'null') return true; // opaque palette iframe (adobe/aem-boilerplate#453)
  try {
    const h = new URL(origin).hostname;
    return /\.(aem|hlx)\.page$/.test(h) || h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

async function handle(type, payload) {
  switch (type) {
    case 'hello':
      return {
        type: 'ready', ok: true, path: window.location.pathname, targetCount: currentTargets.length,
      };
    case 'getTargets':
      return { type: 'targets', ok: true, targets: currentTargets };
    case 'getContext':
      return { type: 'context', ok: true, context: getContext() };
    case 'applyVariant': {
      const r = await applyVariant(findTarget(payload.targetKey), payload.path);
      return { type: 'applied', ...r, ok: r.applied };
    }
    case 'resetToBaseline': {
      const r = await resetToBaseline();
      return { type: 'applied', ...r, ok: r.applied };
    }
    case 'simulateContext': {
      const r = await simulateContext(payload.context, {
        preview: payload.preview,
        previewParams: payload.previewParams,
        baseUrl: payload.baseUrl,
      });
      return { type: 'applied', ...r, ok: r.applied };
    }
    default:
      return { type: 'error', ok: false, error: `unknown request: ${type}` };
  }
}

function onMessage(event) {
  const { data } = event;
  if (!data || data.ns !== NS || data.dir !== 'req') return;
  if (!isTrustedOrigin(event.origin)) return;
  const reply = (res) => {
    const target = event.origin === 'null' ? '*' : event.origin;
    event.source?.postMessage({
      ns: NS, dir: 'res', id: data.id, ...res,
    }, target);
  };
  Promise.resolve()
    .then(() => handle(data.type, data.payload || {}))
    .then(reply)
    .catch((err) => reply({ type: 'error', ok: false, error: String((err && err.message) || err) }));
}

export function init() {
  if (initialized || !isPreviewHost()) return;
  initialized = true;
  currentTargets = enumerateTargets();
  snapshotBaselines(currentTargets);
  window.hlx = window.hlx || {};
  window.hlx.experiencePreview = {
    getTargets: () => currentTargets,
    applyVariant: (t, path) => applyVariant(typeof t === 'string' ? findTarget(t) : t, path),
    resetToBaseline,
    getContext,
    simulateContext,
  };
  window.addEventListener('message', onMessage);
}
