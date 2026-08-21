// Authored-page discovery + dispatch for Intuit's REAL Section Metadata authoring —
// `data-pzn` (personalization) and `data-exp` (experimentation) attributes on a section
// (see experience-workspace/skills/add-personalization-experimentation.md). Those
// attributes are NOT emitted by the aem.live pipeline (it serves a raw `.section-metadata`
// block); scripts.js's decorateSectionMetadata converts the block to data-* client-side,
// before both this module's lanes run — so by the time we query, they exist. This is as
// opposed to the demo's `decisions-manifest` sheet, which the vendored plugin's own
// `serveDecisions` (plugins/experimentation/src/index.js) still serves unchanged; this
// module is a second, independent discovery source feeding the SAME byo.js hooks, not a
// replacement for that one (see drafts/pzn-cell-demo.html, still exercising it).
//
// This is a THIN layer: it only finds targets and feeds them to byo.js's existing
// resolveDecisions/getAssignment/renderDecision hooks (unchanged) — no fetch/apply/stamp
// logic of its own. Those hooks already register the served identity into the
// region-context registry (see tracking-context.js), so no DOM stamping or analytics
// call happens here either.
//
// Mirrors the discovery shape (collectSlots/collectExperiments) that scripts/pzn.js and
// scripts/exp.js carried before the decisions-manifest lane replaced it wholesale (see
// git history on 57841d886f5a13b31107e047f93c897707024c3f), rebuilt to feed byo.js's
// hooks instead of fetching/applying/stamping directly.
//
// PZN and IXP are exposed as two SEPARATE entry points rather than one combined pass,
// because they need OPPOSITE timing relative to scripts.js's decorateMain call:
// - dispatchAuthoredPersonalization (PZN) applies via renderDecision's `fragment` scope
//   — byo.js's applyFragment, which decorates the fetched replacement itself (via
//   loadFragment) before splicing it in. That's only safe to splice into a target AFTER
//   scripts.js's decorateMain has already run on it — otherwise the upcoming
//   decorateMain would decorate the fragment's own already-decorated `.section` a SECOND
//   time (see applyRawFragment's doc comment in byo.js for the exact failure mode this
//   avoids). So this lane keeps the phase split (an eager call for the first/LCP
//   section, a lazy call for the rest) the deleted runExperienceLayer used.
// - dispatchAuthoredExperiments (IXP) applies via renderDecision's `section`/`page` scope
//   — byo.js's applyRawFragment, a deliberately UNDECORATED swap. Its own doc comment is
//   explicit that this relies on the page's own decorateMain running AFTERWARDS to
//   decorate the swapped-in content exactly once — the same pre-decoration contract the
//   plugin's own native Experiment-block dispatch (runExperimentation) and the page-level
//   exp.js/pzn.js swaps (swapMain) already rely on. So this lane MUST run before
//   decorateMain — whole-page, one pass. decorateMain only ever runs once for the whole
//   page, so unlike PZN there is no later "pre-decoration" moment to defer a
//   below-the-fold swap into; see the call sites in scripts.js.

// byo.js itself imports decision.js, which dynamically imports blocks/fragment/
// fragment.js — and that imports scripts.js for decorateMain. Same unavoidable cycle
// byo.js/decision.js/fragment.js/scripts.js already carry this exact disable comment
// for; this module is just newly part of that cycle's graph too.
// eslint-disable-next-line import/no-cycle
import { resolveDecisions, getAssignment, renderDecision } from './byo.js';
import { withTimeout } from './decision.js';

// PZN's outer bound mirrors the page-level personalization swap's own budget (see
// scripts.js's runPersonalizationPage dispatch): the 1500ms decision budget plus the
// 500ms marketing-profile enrichment resolveDecisions may run on a first-visit cache
// miss (0 on a cache hit).
const PZN_TIMEOUT_MS = 2000;
// IXP's outer bound mirrors the page-level experiment swap's own budget (runExperiment)
// — no marketing-profile enrichment on this lane, so no extra 500ms.
const EXP_TIMEOUT_MS = 1500;

/**
 * The actual element a section-level tag targets: the descendant whose class list
 * contains `blockName` (a block's name is always its outer div's first CSS class, both
 * before and after client decoration — see aem.js's decorateBlock, which only ever ADDS
 * classes/attributes onto it), or the whole section when no block scope is authored.
 * Matching by class (never the client-decoration-only `data-block-name` attribute) keeps
 * this correct regardless of whether decoration has run yet on `section` — required for
 * the IXP lane below, which must run before it has.
 * @param {HTMLElement} section
 * @param {String|undefined} blockName
 * @returns {HTMLElement|null}
 */
function scopedTarget(section, blockName) {
  return blockName ? section.querySelector(`[class~="${blockName}"]`) : section;
}

/**
 * True when a section's `data-pzn` and `data-exp` target the SAME element — both
 * whole-section, or both the same named block — the case where IXP wins (see the
 * authored contract's "IXP wins" rule). Mirrors the deleted pzn.js `sameTargetAsExp`.
 * @param {HTMLElement} section
 * @returns {boolean}
 */
function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Every discovered `data-pzn` entry gets its own globally-unique opaque cache key — NOT
// a real CSS selector, just what byo.js's resolveDecisions/renderDecision pair use as a
// map key (its pznContextCache, and the `decisions` object resolveDecisions returns, are
// both keyed by this string; see byo.js). A module-level counter (rather than restarting
// at 0 on every call) keeps the eager and lazy calls from ever minting the same key.
let pznSlotCounter = 0;

function nextPznSelector() {
  pznSlotCounter += 1;
  return `authored-pzn-${pznSlotCounter}`;
}

/**
 * Sections tagged `data-pzn` within `root` (root itself may match), minus `skip`. Each
 * entry names the actual target element (the whole section, or its scoped block — see
 * scopedTarget) plus the verbatim placement id, keyed by a synthetic per-entry selector
 * (see nextPznSelector). Drops a target that also carries `data-exp` on the SAME element
 * — IXP wins (see the authored contract).
 * @param {HTMLElement} root
 * @param {HTMLElement} [skip] an element (and its subtree) to exclude, so a lazy pass
 *   over `main` doesn't re-collect a section an earlier eager pass already handled
 * @returns {{el: HTMLElement, placement: String, selector: String}[]}
 */
export function collectPznEntries(root, skip) {
  const sections = [];
  if (root.matches?.('[data-pzn]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-pzn]').forEach((s) => { if (s !== skip) sections.push(s); });

  const entries = [];
  sections.forEach((section) => {
    const placement = section.dataset.pzn;
    if (!placement) return;
    if (section.dataset.exp && sameTargetAsExp(section)) return; // IXP wins
    const el = scopedTarget(section, section.dataset.pznBlock);
    if (el) entries.push({ el, placement, selector: nextPznSelector() });
  });
  return entries;
}

/**
 * Sections tagged `data-exp` within `root` (root itself may match). Each target names
 * the actual target element (the whole section, or its scoped block — see scopedTarget)
 * plus the verbatim experiment id.
 * @param {HTMLElement} root
 * @returns {{el: HTMLElement, id: String}[]}
 */
export function collectExpTargets(root) {
  const sections = [];
  if (root.matches?.('[data-exp]')) sections.push(root);
  root.querySelectorAll('[data-exp]').forEach((s) => sections.push(s));

  return sections.reduce((targets, section) => {
    const id = section.dataset.exp;
    const el = scopedTarget(section, section.dataset.expBlock);
    if (id && el) targets.push({ el, id });
    return targets;
  }, []);
}

/**
 * Discovers + dispatches authored `data-pzn` targets under `root` into byo.js's
 * resolveDecisions/renderDecision hooks (unchanged) — one batched call for every
 * distinct placement found, then a fragment-scope renderDecision per entry. Fail-open
 * and bounded — never throws, never blocks past PZN_TIMEOUT_MS. No-op when nothing is
 * tagged. See the header comment for why this must run AFTER scripts.js's decorateMain.
 * @param {HTMLElement} root the section (LCP-eager call) or `<main>` (lazy call)
 * @param {{skip?: HTMLElement}} [opts] a section already handled eagerly, excluded from
 *   a subsequent lazy pass over the same root
 * @returns {Promise<void>}
 */
export async function dispatchAuthoredPersonalization(root, { skip } = {}) {
  if (!root) return;
  try {
    const entries = collectPznEntries(root, skip);
    if (!entries.length) return;
    await withTimeout((async () => {
      const decisions = await resolveDecisions(entries);
      await Promise.all(entries.map(({ el, selector }) => renderDecision(el, {
        ...decisions[selector], selector, scope: 'fragment',
      })));
    })(), PZN_TIMEOUT_MS);
  } catch {
    // fail-open — leave default/control content in place
  }
}

/**
 * Discovers + dispatches authored `data-exp` targets under `root` into byo.js's
 * getAssignment/renderDecision hooks (unchanged) — one (internally memoized) call per
 * distinct experiment id, then a section-scope renderDecision per target. Fail-open and
 * bounded — never throws, never blocks past EXP_TIMEOUT_MS. No-op when nothing is
 * tagged. See the header comment for why this must run BEFORE scripts.js's decorateMain,
 * and why (unlike PZN) it always covers the whole `root` in one pass.
 * @param {HTMLElement} root always `<main>` in practice — see the header comment
 * @returns {Promise<void>}
 */
export async function dispatchAuthoredExperiments(root) {
  if (!root) return;
  try {
    const targets = collectExpTargets(root);
    if (!targets.length) return;
    await withTimeout(Promise.all(targets.map(({ el, id }) => getAssignment(id).then(
      () => renderDecision(el, { scope: 'section', config: { id } }),
    ))), EXP_TIMEOUT_MS);
  } catch {
    // fail-open — leave default/control content in place
  }
}
