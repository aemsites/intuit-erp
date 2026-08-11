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

const EXP_CLASS_RE = /^exp-(.+)$/;

// Every element under `root` carrying an `exp-<experiment>` class — a block/
// section experiment, distinct from the page-level, metadata-driven one above.
export function collectExperiments(root) {
  const experiments = [];
  root.querySelectorAll('[class]').forEach((el) => {
    const matched = Array.from(el.classList).find((cls) => EXP_CLASS_RE.test(cls));
    if (matched) experiments.push({ el, id: EXP_CLASS_RE.exec(matched)[1] });
  });
  return experiments;
}

// Resolves each block/section experiment and replaces its marked element with the
// assigned variation. A numeric token is an experimentId, otherwise a label; the
// element being a section (vs a block) sets the fidelity. Control/empty decisions
// leave the baseline; a page-fidelity decision belongs to runExperiment, not here.
export async function runBlockExperiments(root = document.querySelector('main')) {
  if (!root) return;
  const experiments = collectExperiments(root);
  if (experiments.length === 0) return;
  await Promise.all(experiments.map(async ({ el, id }) => {
    const key = /^\d+$/.test(id) ? `experimentId=${encodeURIComponent(id)}` : `label=${encodeURIComponent(id)}`;
    const fidelity = el.classList.contains('section') ? 'section' : 'block';
    const decision = await fetchDecision(`ixp?${key}&fidelity=${fidelity}`);
    if (!decision || decision.control || !decision.fragment || decision.fidelity === 'page') return;
    await applyFragment(el, decision.fragment);
  }));
}
