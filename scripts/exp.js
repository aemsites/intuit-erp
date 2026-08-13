import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, fragmentPath, applyFragment } from './personalization/decision.js';

export function isExperimentEnabled() {
  return !!(getMetadata('experiment') || getMetadata('experiment-id') || getMetadata('experiment-label'));
}

// Replaces <main>'s raw content with the variation page's plain.html so the
// caller's decorateMain decorates it. Bound by the caller's shared signal:
// fail-open, so a late/aborted swap can't clobber already-decorated content.
async function swapMain(doc, variationPath, signal) {
  const main = doc.querySelector('main');
  if (!main) return false;
  const path = fragmentPath(variationPath);
  if (!path) return false;
  try {
    const resp = await fetch(`${path}.plain.html`, { signal });
    if (!resp.ok) return false;
    main.innerHTML = await resp.text();
    return true;
  } catch {
    return false;
  }
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
  params.set('fidelity', 'page');

  // One shared deadline across fetchDecision + swapMain, so a slow decision
  // can't hand the swap a fresh budget and let it land after decoration.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const decision = await fetchDecision(`ixp?${params.toString()}`, { signal: controller.signal });
    if (!decision || decision.control || !decision.fragment) return;
    if (decision.fidelity === 'page') await swapMain(doc, decision.fragment, controller.signal);
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
  await Promise.all(experiments.map(async ({ el, id, fidelity }) => {
    const key = /^\d+$/.test(id) ? `experimentId=${encodeURIComponent(id)}` : `label=${encodeURIComponent(id)}`;
    const decision = await fetchDecision(`ixp?${key}&fidelity=${fidelity}`);
    if (!decision || decision.control || !decision.fragment || decision.fidelity === 'page') return;
    await applyFragment(el, decision.fragment);
  }));
}
