/**
 * Resolves RTCDP B2B audience membership for the current visitor.
 *
 * Mock mode (now): the audience ids travel with the firmographics payload
 * (from the worker preset table), so we return those directly, with a small
 * industry/size fallback map. Real mode (later): read the activated audience
 * ids out of the Adobe Web SDK (Alloy) personalization decision in
 * `alloyResult`. Swapping to real only touches this file + martech config.
 */

const FALLBACK_BY_INDUSTRY = {
  Construction: 'enterprise-active-opportunity',
  'Financial Services': 'enterprise-fintech',
  'Professional Services': 'smb-upgrade-candidate',
  Accounting: 'partner-proadvisor',
  Nonprofit: 'governance-focused',
};

export default async function resolveAudiences({ firmographics, alloyResult } = {}) {
  // Real Alloy path (later): extract audience ids from the decision payload.
  if (alloyResult && Array.isArray(alloyResult.audiences) && alloyResult.audiences.length) {
    return alloyResult.audiences;
  }
  if (firmographics && Array.isArray(firmographics.audiences) && firmographics.audiences.length) {
    return firmographics.audiences;
  }
  if (firmographics && FALLBACK_BY_INDUSTRY[firmographics.industry]) {
    return [FALLBACK_BY_INDUSTRY[firmographics.industry]];
  }
  return [];
}
