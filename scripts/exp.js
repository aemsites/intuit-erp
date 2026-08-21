import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, swapMain } from './personalization/decision.js';
import {
  isRedirect, ixpContentPath, ixpRecord,
} from './personalization/ixp-response.js';
import { recordIxp } from './personalization/analytics.js';
import { stampExperiment } from './personalization/stamp.js';
import { resolveIvid } from './personalization/attributes.js';

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
