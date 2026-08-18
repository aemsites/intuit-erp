/**
 * Click-tracking decoration entry.
 *
 * Opt-in: a block is tracked only when it carries a `tracking-<key>` variant
 * class. PREFIX is a single constant — change it here to re-map the trigger.
 *
 * Two passes:
 *  - decorateTracking(): synchronous. Stamps the derived baseline on every CTA
 *    in an opted-in block (so clicks are trackable before the sheet loads) plus
 *    the page + block access-point trail segments.
 *  - applyTrackingSheet(): asynchronous. Fetches the authored sheet and
 *    re-stamps identity overrides, custom-properties, wa-link and survey.
 *
 * See CLICK-TRACKING.md ("The EDS authoring model").
 */

import { deriveBaseline, blockAccessPoint } from './tracking/derive.js';
import { fetchTrackingSheet } from './tracking/sheet.js';
import { resolveCta } from './tracking/resolve.js';
import { stampCta, stampTracking } from './tracking/stamp.js';

// The block-variant class prefix that opts a block into click tracking.
export const PREFIX = 'tracking-';

/**
 * The tracking key from a block's `tracking-<key>` class, or null.
 * @param {Element} block
 * @returns {string|null}
 */
export function trackingKey(block) {
  const cls = [...block.classList].find((c) => c.startsWith(PREFIX) && c.length > PREFIX.length);
  return cls ? cls.slice(PREFIX.length) : null;
}

/**
 * The block's name (its access-point base): dataset.blockName, else the first
 * non-structural class.
 * @param {Element} block
 * @returns {string}
 */
export function blockNameOf(block) {
  if (block.dataset && block.dataset.blockName) return block.dataset.blockName;
  return [...block.classList].find((c) => c !== 'block' && !c.startsWith(PREFIX)) || '';
}

/**
 * Trackable CTAs within a block, in DOM order.
 * @param {Element} block
 * @returns {Element[]}
 */
export function ctasIn(block) {
  return [...block.querySelectorAll('a[href], button')];
}

/**
 * Pick the sheet row for the CTA at index `i`: an explicit 1-based `cta` match
 * wins; otherwise the first CTA falls back to the single row without a `cta`.
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} i
 * @returns {Record<string, unknown>|null}
 */
export function rowForIndex(rows, i) {
  const byCta = rows.find((r) => r.cta === i + 1);
  if (byCta) return byCta;
  if (i === 0) return rows.find((r) => r.cta == null) || null;
  return null;
}

function deriveForCta(el, blockName) {
  return deriveBaseline({
    tagName: el.tagName,
    label: el.textContent,
    blockName,
    isButtonStyled: el.tagName === 'BUTTON' || el.classList.contains('button'),
  });
}

function optedInBlocks(root) {
  return [...root.querySelectorAll(`[class*="${PREFIX}"]`)].filter((b) => trackingKey(b));
}

/**
 * Synchronous derived pass: stamp the baseline on every CTA in an opted-in
 * block, plus the page + block trail segments. Safe before the sheet loads and
 * idempotent across re-runs.
 * @param {ParentNode} [scope]
 */
export function decorateTracking(scope = document) {
  const root = scope.querySelectorAll ? scope : document;
  const main = document.querySelector('main');
  const pageSeg = (document.head?.querySelector('meta[name="tracking"]')?.content || '').trim();
  if (main && pageSeg) stampTracking(main, pageSeg);

  optedInBlocks(root).forEach((block) => {
    const blockName = blockNameOf(block);
    stampTracking(block, blockAccessPoint(blockName));
    ctasIn(block).forEach((el) => stampCta(el, resolveCta(deriveForCta(el, blockName), null)));
  });
}

/**
 * Asynchronous authored pass: fetch the sheet and re-stamp overrides/residue.
 * No-op when the sheet is empty/unavailable (CTAs keep their derived stamp).
 * @param {ParentNode} [scope]
 */
export async function applyTrackingSheet(scope = document) {
  const sheet = await fetchTrackingSheet();
  const root = scope.querySelectorAll ? scope : document;

  // Authoritative pass: re-derive + overlay the sheet for every opted-in CTA.
  // Runs after blocks decorate (some rebuild their own DOM), so it restores
  // stamps a block's decoration may have replaced and fills in the residue.
  optedInBlocks(root).forEach((block) => {
    const rows = (sheet && sheet.get(trackingKey(block))) || [];
    const blockName = blockNameOf(block);
    const apRow = rows.find((r) => r['access-point']);
    stampTracking(block, apRow ? apRow['access-point'] : blockAccessPoint(blockName));
    ctasIn(block).forEach((el, i) => {
      stampCta(el, resolveCta(deriveForCta(el, blockName), rowForIndex(rows, i)));
    });
  });
}
