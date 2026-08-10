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
import { fetchDecision } from './personalization/decision.js';

/** True when the page opts into an IXP experiment. */
export function isExperimentEnabled() {
  return !!(getMetadata('experiment') || getMetadata('experiment-id') || getMetadata('experiment-label'));
}

/**
 * Replaces <main>'s content with the variation page's plain.html (raw, so the
 * caller's decorateMain decorates it). Returns true when swapped.
 * @param {Document} doc
 * @param {string} variationPath
 * @returns {Promise<boolean>}
 */
async function swapMain(doc, variationPath) {
  const main = doc.querySelector('main');
  if (!main) return false;
  const path = variationPath.startsWith('/') ? variationPath : `/${variationPath}`;
  try {
    const resp = await fetch(`${path}.plain.html`);
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
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
  const params = new URLSearchParams();
  if (experimentId) params.set('experimentId', experimentId);
  if (label) params.set('label', label);
  params.set('fidelity', 'page');

  const decision = await fetchDecision(`ixp?${params.toString()}`);
  if (!decision || decision.control || !decision.fragment) return;
  if (decision.fidelity === 'page') await swapMain(doc, decision.fragment);
}
