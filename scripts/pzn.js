// eslint-disable-next-line import/no-cycle
import { fetchDecision, applyFragment } from './personalization/decision.js';

const PZN_CLASS_RE = /^pzn-(.+)$/;

// Every element under `root` carrying a `pzn-<placement>` class.
export function collectSlots(root) {
  const slots = [];
  root.querySelectorAll('[class]').forEach((el) => {
    const matched = Array.from(el.classList).find((cls) => PZN_CLASS_RE.test(cls));
    if (matched) slots.push({ el, placement: PZN_CLASS_RE.exec(matched)[1] });
  });
  return slots;
}

export async function runPersonalization(root = document.querySelector('main')) {
  if (!root) return;
  const slots = collectSlots(root);
  if (slots.length === 0) return;

  const decisions = await fetchDecision('de', {
    method: 'POST',
    body: {
      slots: slots.map((s) => ({ placement: s.placement })),
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
