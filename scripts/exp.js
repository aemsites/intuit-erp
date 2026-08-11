/**
 * Client-side whole-page experimentation (Intuit IXP).
 *
 * Triggered by page metadata (`experiment` / `experiment-id` / `experiment-label`).
 * Runs first in the eager phase — before decorateMain — so that on a page-level
 * (REDIRECT) decision it can swap <main>'s raw content for the variation page, and
 * the normal decoration pipeline then decorates the variation. The variation may
 * itself contain `pzn-` blocks, which pzn.js personalizes afterward.
 *
 * Distinct from scripts/experiment-loader.js (the Adobe AEM experimentation plugin
 * — audiences/campaigns); they coexist and do not interact.
 */

import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision } from './personalization/decision.js';

/** True when the page opts into an IXP experiment. */
export function isExperimentEnabled() {
  return !!(getMetadata('experiment') || getMetadata('experiment-id') || getMetadata('experiment-label'));
}

/**
 * Replaces <main>'s content with the variation page's plain.html (raw, so the
 * caller's decorateMain decorates it). Returns true when swapped.
 *
 * Bounded by its own ~1s AbortController timeout (mirrors fetchDecision) —
 * fail-open: on abort/non-ok/throw the baseline <main> is left intact. This
 * matters because a swap that completes LATE (after decoration has already
 * run) would clobber decorated content with raw HTML, so a hung connection
 * must be abandoned rather than allowed to resolve whenever it likes.
 * @param {Document} doc
 * @param {string} variationPath
 * @returns {Promise<boolean>}
 */
async function swapMain(doc, variationPath) {
  const main = doc.querySelector('main');
  if (!main) return false;
  const path = variationPath.startsWith('/') ? variationPath : `/${variationPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const resp = await fetch(`${path}.plain.html`, { signal: controller.signal });
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves and applies a whole-page experiment, if the page opts in.
 * @param {Document} [doc=document]
 * @returns {Promise<void>}
 */
export async function runExperiment(doc = document) {
  if (!isExperimentEnabled()) return;
  const experimentId = getMetadata('experiment-id');
  const label = getMetadata('experiment-label');
  // Bare `experiment` metadata (with no id/label) belongs to the separate Adobe
  // experimentation plugin — there is nothing for IXP to resolve, so skip the
  // /api/ixp round-trip entirely rather than firing it with no id/label.
  if (!experimentId && !label) return;
  const params = new URLSearchParams();
  if (experimentId) params.set('experimentId', experimentId);
  if (label) params.set('label', label);
  params.set('fidelity', 'page');

  const decision = await fetchDecision(`ixp?${params.toString()}`);
  if (!decision || decision.control || !decision.fragment) return;
  // 'page' fidelity is used for whole-page REDIRECT experiments only — the IXP
  // handler stamps this fidelity when the decision is a full-page swap (as
  // opposed to a block/section-level personalization decision).
  if (decision.fidelity === 'page') await swapMain(doc, decision.fragment);
}
