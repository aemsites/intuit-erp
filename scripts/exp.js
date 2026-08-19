import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, applyFragment, swapMain } from './personalization/decision.js';
import {
  isRedirect, isReplace, ixpContentPath, ixpRecord,
} from './personalization/ixp-response.js';
import { recordIxp } from './personalization/analytics.js';
import { stampExperiment } from './personalization/stamp.js';
import { resolveIvid, ixpParams } from './personalization/attributes.js';

export function isExperimentEnabled() {
  return !!(getMetadata('experiment') || getMetadata('experiment-id') || getMetadata('experiment-label'));
}

export async function runExperiment(doc = document) {
  if (!isExperimentEnabled()) return;
  const experimentId = getMetadata('experiment-id');
  const label = getMetadata('experiment-label');
  // Bare `experiment` is the Adobe plugin's — nothing for IXP to resolve.
  if (!experimentId && !label) return;
  const params = new URLSearchParams();
  if (experimentId) params.set('experimentId', experimentId);
  if (label) params.set('label', label);
  const ivid = resolveIvid();
  if (ivid) params.set('ivid', ivid);

  // One shared deadline across fetchDecision + swapMain, so a slow decision
  // can't hand the swap a fresh budget and let it land after decoration.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    // The worker returns the raw assignment response verbatim; page fidelity is
    // ours (this is the page-level entry point), so we act only on redirect arms.
    const res = await fetchDecision(`ixp?${params.toString()}`, { signal: controller.signal });
    const assignment = res?.assignments?.[0];
    if (!assignment) return;
    const record = ixpRecord(assignment, window.location.pathname);
    // Primary work (LCP path): swap the page first for a redirect treatment.
    if (isRedirect(assignment)) {
      const path = ixpContentPath(assignment);
      // Stamp <main> once the variation lands (stamp.js) for click attribution.
      if (path && await swapMain(doc, path, controller.signal)) {
        stampExperiment(doc.querySelector('main'), record);
      }
    }
    // Analytics trails the swap (control arms count too) — idle-deferred.
    recordIxp([record]);
  } finally {
    clearTimeout(timer);
  }
}

// Sections tagged `data-exp` within `root` (root itself may match), minus `skip`.
// The experiment id is the verbatim `data-exp` value; a `data-exp-block` scopes
// the target to the block whose `data-block-name` matches (first) at block
// fidelity, otherwise the whole section at section fidelity.
export function collectExperiments(root, skip) {
  const sections = [];
  if (root.matches?.('[data-exp]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-exp]').forEach((s) => { if (s !== skip) sections.push(s); });

  const experiments = [];
  sections.forEach((section) => {
    const id = section.dataset.exp;
    if (!id) return;
    const block = section.dataset.expBlock;
    const el = block ? section.querySelector(`[data-block-name="${block}"]`) : section;
    if (el) experiments.push({ el, id, fidelity: block ? 'block' : 'section' });
  });
  return experiments;
}

// Resolves each block/section experiment and replaces its target with the
// assigned variation. A numeric id is an experimentId, otherwise a label.
// Control/empty decisions leave the baseline; a page-fidelity decision belongs to
// runExperiment, not here.
export async function runBlockExperiments(root = document.querySelector('main'), { skip } = {}) {
  if (!root) return;
  const experiments = collectExperiments(root, skip);
  if (experiments.length === 0) return;
  await Promise.all(experiments.map(async ({ el, id }) => {
    const res = await fetchDecision(`ixp?${ixpParams(id)}`);
    const assignment = res?.assignments?.[0];
    if (!assignment) return;
    const record = ixpRecord(assignment, window.location.pathname);
    // Primary work: inject the block/section content first for a replace treatment.
    if (isReplace(assignment)) {
      const path = ixpContentPath(assignment);
      // Stamp the target once the variation lands (stamp.js) for click attribution.
      if (path && await applyFragment(el, path)) {
        stampExperiment(el, record);
      }
    }
    // Analytics trails the swap (control arms count too) — idle-deferred.
    recordIxp([record]);
  }));
}
