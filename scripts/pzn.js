// eslint-disable-next-line import/no-cycle
import { fetchDecision, applyFragment } from './personalization/decision.js';

// Sections tagged `data-pzn` within `root` (root itself may match), minus `skip`.
// The placement id is the verbatim `data-pzn` value; a `data-pzn-block` scopes the
// target to the block in that section whose `data-block-name` matches (first),
// otherwise the whole section is the target.
export function collectSlots(root, skip) {
  const sections = [];
  if (root.matches?.('[data-pzn]') && root !== skip) sections.push(root);
  root.querySelectorAll('[data-pzn]').forEach((s) => { if (s !== skip) sections.push(s); });

  const slots = [];
  sections.forEach((section) => {
    const placement = section.dataset.pzn;
    if (!placement) return;
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
  const decisions = await fetchDecision('de', {
    method: 'POST',
    body: {
      slots: placements.map((placement) => ({ placement })),
      path: window.location.pathname,
    },
  });
  if (!Array.isArray(decisions) || decisions.length === 0) return;

  const applications = [];
  decisions.forEach((d) => {
    if (!d || !d.fragment) return;
    const key = String(d.placement || '').toLowerCase();
    // Apply to every slot sharing this placement, not just the first.
    slots
      .filter((s) => s.placement.toLowerCase() === key)
      .forEach((slot) => applications.push(applyFragment(slot.el, d.fragment)));
  });
  await Promise.all(applications);
}
