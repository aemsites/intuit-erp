import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, swapMain } from './personalization/decision.js';
import {
  entryForSlot, recommendationOf, pznRecord, pznFragment,
} from './personalization/pzn-response.js';
import { recordPznPage } from './personalization/analytics.js';
import { stampPzn } from './personalization/stamp.js';
import { buildBatchBody } from './personalization/attributes.js';
import { getIntentProfile, buildIntentContext } from './of1-intent.js';
// Section/block-level personalization is now owned by the vendored aem-experimentation
// plugin's decisions-manifest lane (see scripts/personalization/byo.js resolveDecisions);
// this file only keeps the whole-page path, which reuses the same enrichment.
import { getMarketingProfile } from './personalization/marketing-profile.js';

// The client attributes merged onto the pzn request: the ZoomInfo firmographics
// (already cached in localStorage per ivid) plus, namespaced under `of1Intent`, the
// visitor's stored behavior profile (interests/intent/entrySource) when one exists.
function decisionAttributes(zoominfo) {
  const attributes = { ...(zoominfo || {}) };
  const of1Intent = buildIntentContext(getIntentProfile());
  if (of1Intent) attributes.of1Intent = of1Intent;
  return attributes;
}

// Whole-page personalization: swaps <main> before decoration for a page tagged with
// `personalization-id` metadata (the page-level placement). Mirrors exp.js
// `runExperiment` — a single placement resolved to a whole-page variant fragment,
// bounded by one shared deadline so a slow decision can't land after decoration.
// eslint-disable-next-line import/prefer-default-export
export async function runPersonalizationPage(doc = document) {
  const placement = getMetadata('personalization-id');
  if (!placement) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const zoominfo = await getMarketingProfile();
    const response = await fetchDecision('pzn', {
      method: 'POST',
      body: buildBatchBody([placement], undefined, decisionAttributes(zoominfo)),
      signal: controller.signal,
    });
    if (!response || typeof response !== 'object') return;
    const rec = recommendationOf(entryForSlot(response, placement));
    if (!rec) return;
    const record = pznRecord(rec);
    const fragment = pznFragment(rec);
    // Primary work (LCP path): swap the whole page first, then stamp <main> for the
    // click channel (parity with runExperiment's stampExperiment).
    if (fragment && await swapMain(doc, fragment, controller.signal) && record) {
      stampPzn(doc.querySelector('main'), record);
    }
    // Analytics trails the swap — idle-deferred inside recordPznPage.
    if (record) recordPznPage([record]);
  } finally {
    clearTimeout(timer);
  }
}
