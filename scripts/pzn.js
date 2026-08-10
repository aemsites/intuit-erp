/**
 * Client-side block/section personalization (Decision Engine).
 *
 * Slots are authored as block/section divs carrying a `pzn-<placement>` class
 * (lowercased by EDS `toClassName`). The block's own authored content is the
 * baseline: on control / no decision it stays; on a decision it is replaced by
 * the returned fragment. All slots on the page are resolved in one batch call.
 */

import { fetchDecision, applyFragment } from './personalization/decision.js';

const PZN_CLASS_RE = /^pzn-(.+)$/;

/**
 * Every element under `root` with a `pzn-<placement>` class.
 * @param {Element} root
 * @returns {{ el: Element, placement: string }[]}
 */
export function collectSlots(root) {
  const slots = [];
  root.querySelectorAll('[class]').forEach((el) => {
    const classes = Array.from(el.classList);
    const matched = classes.find((cls) => PZN_CLASS_RE.test(cls));
    if (matched) {
      const m = PZN_CLASS_RE.exec(matched);
      slots.push({ el, placement: m[1] });
    }
  });
  return slots;
}

/**
 * Resolves and applies personalization for all `pzn-` slots under `root`.
 * @param {Element} [root=document.querySelector('main')]
 * @returns {Promise<void>}
 */
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

  await Promise.all(decisions.map(async (d) => {
    if (!d || !d.fragment) return;
    const key = String(d.placement || '').toLowerCase();
    const slot = slots.find((s) => s.placement.toLowerCase() === key);
    if (slot) await applyFragment(slot.el, d.fragment);
  }));
}
