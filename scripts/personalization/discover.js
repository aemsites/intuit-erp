// Discovery + dispatch for authored Section Metadata pzn/exp tags (data-pzn / data-exp;
// see experience-workspace/skills/add-personalization-experimentation.md). scripts.js's
// decorateSectionMetadata produces those attributes client-side before this runs. Thin
// layer: only finds targets and feeds byo.js's resolveDecisions/getAssignment/
// renderDecision hooks (which own fetch/apply and register the tracking-context registry).
//
// PZN and IXP are separate entry points with OPPOSITE timing vs scripts.js's decorateMain:
// - PZN uses renderDecision's `fragment` scope (applyFragment self-decorates), so it runs
//   AFTER decorateMain — else the swapped fragment's `.section` decorates twice. Phase
//   split: eager (LCP section) + lazy (rest).
// - IXP uses `section` scope (applyRawFragment, an undecorated swap relying on the page's
//   own decorateMain to decorate it once), so it runs BEFORE decorateMain, whole page.

// eslint-disable-next-line import/no-cycle -- byo.js -> decision.js -> fragment.js -> scripts.js
import { resolveDecisions, getAssignment, renderDecision } from './byo.js';
import { withTimeout } from './decision.js';

// Outer bounds mirror the page-level swap budgets; PZN adds 500ms for a first-visit
// marketing-profile enrichment cache miss, IXP has none.
const PZN_TIMEOUT_MS = 2000;
const EXP_TIMEOUT_MS = 1500;

/**
 * The element a tag targets: the descendant block whose class list contains `blockName`,
 * or the whole section when unscoped. Matches by class (not decoration-only
 * `data-block-name`) so it works pre-decoration too — required for the IXP lane.
 * @param {HTMLElement} section
 * @param {String|undefined} blockName
 * @returns {HTMLElement|null}
 */
function scopedTarget(section, blockName) {
  return blockName ? section.querySelector(`[class~="${blockName}"]`) : section;
}

/**
 * True when `data-pzn` and `data-exp` target the SAME element (both whole-section, or the
 * same named block) — the "IXP wins" case.
 * @param {HTMLElement} section
 * @returns {boolean}
 */
function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Opaque per-entry key for byo.js's resolveDecisions/renderDecision map (not a CSS
// selector). Module-level counter so eager + lazy passes never collide.
let pznSlotCounter = 0;

function nextPznSelector() {
  pznSlotCounter += 1;
  return `authored-pzn-${pznSlotCounter}`;
}

/**
 * `data-pzn` sections under `root` (root may match), minus `skip`. Each entry: target
 * element, verbatim placement id, synthetic selector key. Drops a target that also carries
 * `data-exp` on the same element (IXP wins).
 * @param {HTMLElement} root
 * @param {HTMLElement} [skip] a subtree an eager pass already handled
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
 * `data-exp` sections under `root` (root may match). Each target: element + verbatim
 * experiment id.
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
 * Dispatches `data-pzn` targets: one batched resolveDecisions, then a fragment-scope
 * renderDecision each. Fail-open, bounded by PZN_TIMEOUT_MS. Runs AFTER decorateMain.
 * @param {HTMLElement} root the LCP section (eager) or `<main>` (lazy)
 * @param {{skip?: HTMLElement}} [opts]
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
 * Dispatches `data-exp` targets: getAssignment (memoized per id) then a section-scope
 * renderDecision each. Fail-open, bounded by EXP_TIMEOUT_MS. Runs BEFORE decorateMain,
 * whole page in one pass.
 * @param {HTMLElement} root always `<main>` in practice
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
