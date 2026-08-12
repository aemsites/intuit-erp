/**
 * In-worker Decision Engine "Batch" mock — returns a per-visitor offer for each
 * requested slot so the DE slot-personalization flow is demoable without the real
 * key (which is rotation-pending and fires real exposure tracking). Enabled with
 * `DE_MOCK=enabled`; swap to the real service by removing it and setting the
 * `PZN_API_KEY` secret — no code change.
 *
 * The offer (a `copyData.pznblock` fragment path) is chosen from a small
 * firmographic set by a stable hash of the ivid — a stand-in for ZoomInfo/DE
 * segmentation — so different visitors see different slot content. Returns the
 * same response shape as the real Batch endpoint (the subset the worker reads).
 */

// Demo firmographic segments → offer fragment. The fragments live under the local
// html-folder for the POC; the real DE returns its own `fragments/pzn/...` paths.
export const SEGMENTS = ['hospitality', 'construction', 'retail'];

/** Deterministic bucket in [0, mod) for a string (FNV-1a). Stable per visitor. */
function bucket(str, mod) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % mod;
}

/**
 * Mock of the Decision Engine Batch response for the given slots + attributes —
 * one personalized recommendation per slot, keyed like the real service
 * (`<experience>_<placement>_<locale>`).
 * @param {{ slots: import('./routes.js').DeSlot[], attributes: Record<string, unknown> }} opts
 * @returns {Record<string, any>}
 */
export function mockBatch({ slots, attributes }) {
  const ivid = (attributes && attributes.ivid) || '';
  const locale = String((attributes && attributes.locale) || 'en-US').replace('-', '_');
  const response = {};
  for (const slot of slots) {
    const segment = SEGMENTS[bucket(`${ivid}:${slot.placement}`, SEGMENTS.length)];
    response[`${slot.experience}_${slot.placement}_${locale}`] = {
      data: {
        recommendations: {
          recommendation: [{ copyData: { template: 'content', pznblock: `drafts/pzn-demo/offer-${segment}` } }],
        },
      },
      placement: slot.placement,
      experience: slot.experience,
      status: 200,
    };
  }
  return response;
}
