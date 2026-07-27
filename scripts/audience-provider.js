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

/**
 * Maps Adobe Journey Optimizer / RTCDP propositions (as returned by
 * aem-martech's getPersonalizationForView) to OF1 audience ids.
 *
 * REAL-MODE SEAM: today no propositions are passed (martech is inert), so this
 * returns []. When the AEP sandbox is live, martech's propositions carry the
 * activated audience membership; extract the ids here. The exact field depends
 * on how AJO offers/decision-scopes are configured — commonly a proposition's
 * scopeDetails.activity / decision metadata. Fill this in against the real
 * datastream response; until then it is a documented no-op.
 */
export function audiencesFromPropositions(propositions) {
  if (!Array.isArray(propositions) || propositions.length === 0) return [];
  const ids = [];
  for (const p of propositions) {
    const id = p?.scopeDetails?.activity?.id || p?.scope;
    if (id) ids.push(id);
  }
  return ids;
}

export default async function resolveAudiences({ firmographics, alloyResult, propositions } = {}) {
  // Real AJO/RTCDP path (later): audiences from martech propositions.
  const fromPropositions = audiencesFromPropositions(propositions);
  if (fromPropositions.length) return fromPropositions;

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
