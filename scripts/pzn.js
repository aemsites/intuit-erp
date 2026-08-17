import { getMetadata } from './aem.js';
// eslint-disable-next-line import/no-cycle
import { fetchDecision, applyFragment, swapMain } from './personalization/decision.js';
import {
  entryForSlot, recommendationOf, pznRecord, pznFragment,
} from './personalization/pzn-response.js';
import { recordPzn, recordPznPage } from './personalization/analytics.js';
import { stampPzn } from './personalization/stamp.js';
import { buildBatchBody } from './personalization/attributes.js';

// True when a section's data-pzn and data-exp aim at the SAME target — both whole-
// section, or both the same named block. That's the case where IXP takes precedence
// (Req 4); pzn and exp scoped to different blocks are independent and both run.
function sameTargetAsExp(section) {
  const { pznBlock, expBlock } = section.dataset;
  if (!pznBlock && !expBlock) return true;
  return !!pznBlock && pznBlock === expBlock;
}

// Sections tagged `data-pzn` within `root` (root itself may match), minus `skip`.
// The placement id is the verbatim `data-pzn` value; a `data-pzn-block` scopes the
// target to the block in that section whose `data-block-name` matches (first),
// otherwise the whole section is the target. When the same target also carries an
// experiment (data-exp), IXP wins and the pzn slot is dropped (Req 4).
export function collectSlots(root, skip) {
  const sections = [];
  if (root.matches?.('[data-pzn]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-pzn]').forEach((s) => { if (s !== skip) sections.push(s); });

  const slots = [];
  sections.forEach((section) => {
    const placement = section.dataset.pzn;
    if (!placement) return;
    if (section.dataset.exp && sameTargetAsExp(section)) return;
    const block = section.dataset.pznBlock;
    const el = block ? section.querySelector(`[data-block-name="${block}"]`) : section;
    if (el) slots.push({ el, placement });
  });
  return slots;
}

export async function runPersonalization(root = document.querySelector('main'), { skip } = {}) {
  if (!root) return;
  const slots = collectSlots(root, skip);
  if (slots.length === 0) return;

  const placements = [...new Set(slots.map((s) => s.placement))];
  // Akamai passes the raw batch response through verbatim: an object keyed
  // `<experience>_<placement>_<locale>`. We build the full upstream request here
  // (buildBatchBody: batchItems + client attributes) and read each slot's
  // recommendation directly — the fragment ref (copyData.contentId) for the swap,
  // and the full recommendation for the analytics record.
  const response = await fetchDecision('pzn', {
    method: 'POST',
    body: buildBatchBody(placements),
  });
  if (!response || typeof response !== 'object') return;

  // Primary work (LCP path): apply the DOM swaps first.
  const applications = [];
  const records = [];
  placements.forEach((placement) => {
    const rec = recommendationOf(entryForSlot(response, placement));
    if (!rec) return;
    const record = pznRecord(rec);
    if (record) records.push(record);
    const fragment = pznFragment(rec);
    if (!fragment) return;
    const key = placement.toLowerCase();
    // Apply to every slot sharing this placement; stamp the offer identity once the
    // swap lands (stamp.js) for click attribution.
    slots
      .filter((s) => s.placement.toLowerCase() === key)
      .forEach((slot) => applications.push(
        applyFragment(slot.el, fragment).then((applied) => {
          if (applied && record) stampPzn(slot.el, record);
        }),
      ));
  });
  await Promise.all(applications);

  // Analytics trails the swap (idle-deferred inside recordPzn) — never blocks LCP.
  recordPzn(records);
}

// Whole-page personalization: swaps <main> before decoration for a page tagged with
// `personalization-id` metadata (the page-level placement). Mirrors exp.js
// `runExperiment` — a single placement resolved to a whole-page variant fragment,
// bounded by one shared deadline so a slow decision can't land after decoration.
export async function runPersonalizationPage(doc = document) {
  const placement = getMetadata('personalization-id');
  if (!placement) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const response = await fetchDecision('pzn', {
      method: 'POST',
      body: buildBatchBody([placement]),
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
