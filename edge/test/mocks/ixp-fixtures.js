/**
 * Fixture catalog for the IXP Assignment mock (test-only scaffolding).
 *
 * Each fixture is an experiment the mock "knows about". A real assignment is
 * produced by combining a fixture with request context (ivid bucketing + cache
 * scope). The fixtures illustrate the four cases the edge worker cares about:
 *
 *   - page-level redirect   (variation.html key)        → whole-page replace
 *   - block-level content   (assetLocation)             → block/section replace
 *   - control arm           (control: true)             → passthrough (baseline)
 *   - none / unbucketed     (empty assignments)         → passthrough
 *
 * `15972` is reproduced verbatim from the shared spec capture so mock responses
 * can be diffed against the PDF. The `39xxx` fixtures are added to exercise the
 * worker-relevant scenarios explicitly.
 */

/**
 * @typedef {import('./ixp-assignment.js').Assignment} Assignment
 */

/**
 * A known experiment + the treatment the mock hands out for it.
 * @typedef {Object} Fixture
 * @property {string} label Human label; `?label=<regex>` matches against this (may match many).
 * @property {boolean} [ividTyped] False ⇒ this experiment is not IVID-typed ⇒ graceful SDK error.
 * @property {number} [treatmentSplit] Percentage (0–100) of bucketed visitors who get the
 *   treatment; the rest are assigned the control arm (stable per ivid — see `bucketPercent`).
 *   Omit for a fixture that always hands out its defined arm.
 * @property {Assignment} assignment The assignment returned when a user is bucketed into this experiment.
 */

/** Cache-scope allow lists from the spec (out of scope ⇒ empty assignments). */
export const ALLOWED_BUSINESS_UNITS = new Set(['CG', 'SBSEG', 'INTUIT', 'PCG']);
export const ALLOWED_APPLICATIONS = new Set([
  'INTUITCOM',
  'SBGM',
  'TurboTax_Community',
  'QBDT_IPD',
  'Tsheets',
  'PCGM',
]);

/**
 * Builds an assignment, filling the common defaults so fixtures stay terse.
 * @param {Partial<Assignment> & Pick<Assignment, 'experimentId' | 'experimentType'>} partial
 * @returns {Assignment}
 */
function assignment(partial) {
  return {
    experimentVersion: 1,
    assignmentId: 'IVID',
    experimentFlags: 0,
    application: 'SBGM',
    businessUnit: 'SBSEG',
    experimentKey: `IXP1_${partial.experimentId}`,
    country: 'US',
    label: '',
    id: 0,
    treatmentKey: '',
    payload: '',
    assetLocation: null,
    control: false,
    isAPIIL: false,
    isAPIEL: false,
    isExisting: false,
    isPersistent: false,
    ...partial,
  };
}

/** @type {Record<number, Fixture>} */
export const FIXTURES = {
  // --- verbatim spec capture (control arm of a REDIRECT experiment) --------
  15972: {
    label: '081008a2-f507-429a-a408-1d10a7fb4810',
    assignment: assignment({
      experimentId: 15972,
      experimentType: 'REDIRECT',
      experimentVersion: 7,
      experimentFlags: 260,
      application: 'SBGM',
      businessUnit: 'SBSEG',
      experimentKey: 'IXP1_5652',
      label: '081008a2-f507-429a-a408-1d10a7fb4810',
      id: 39927,
      treatmentKey: 'IXP1_T_14654',
      payload: JSON.stringify({ 'intuit.com.integration.variation.html': 'redirect.variation.html' }),
      control: true,
    }),
  },

  // --- page-level redirect treatment → whole-page replace ------------------
  39001: {
    label: 'ERP-HERO-REDIRECT',
    assignment: assignment({
      experimentId: 39001,
      experimentType: 'REDIRECT',
      experimentKey: 'IXP1_39001',
      label: 'ERP-HERO-REDIRECT',
      id: 50001,
      treatmentKey: 'IXP1_T_50001',
      // page-level decision: the variation path IXP redirects the visitor to.
      payload: JSON.stringify({ 'intuit.com.integration.variation.html': '/drafts/suresh/pzn-variant' }),
    }),
  },

  // --- block-level content treatment → block/section replace ---------------
  // Split 50/50 so the demo shows a real A/B: some visitors see the offer,
  // others get the baseline, stable per ivid.
  39002: {
    label: 'ERP-HERO-BLOCK',
    treatmentSplit: 50,
    assignment: assignment({
      experimentId: 39002,
      experimentType: 'REPLACE_WEB_CONTENT',
      experimentKey: 'IXP1_39002',
      label: 'ERP-HERO-BLOCK',
      id: 50002,
      treatmentKey: 'IXP1_T_50002',
      // Block-level decision: the content ref the renderer fetches + injects.
      // In the real API this is an S3/content key; here it points at an
      // authored EDS fragment so the POC renders end-to-end.
      assetLocation: '/fragments/pzn/automation',
    }),
  },

  // --- use case 1: experiment page → whole-page swap to the treatment ------
  // A REDIRECT split 50/50: the treatment arm swaps the whole <main> of the
  // control page (/drafts/pzn/experiment) for the treatment page
  // (/drafts/pzn/treatment); the control arm shows the baseline. Stable per
  // ivid, so `?ivid=` demos both arms on the one experiment URL.
  39010: {
    label: 'ERP-EXPERIMENT-PAGE',
    treatmentSplit: 50,
    assignment: assignment({
      experimentId: 39010,
      experimentType: 'REDIRECT',
      experimentKey: 'IXP1_39010',
      label: 'ERP-EXPERIMENT-PAGE',
      id: 50010,
      treatmentKey: 'IXP1_T_50010',
      // page-level decision: the variation (treatment) path IXP redirects to.
      payload: JSON.stringify({ 'intuit.com.integration.variation.html': '/drafts/pzn/treatment' }),
    }),
  },

  // --- explicit control arm → passthrough (baseline) -----------------------
  39003: {
    label: 'ERP-HERO-CONTROL',
    assignment: assignment({
      experimentId: 39003,
      experimentType: 'DEFAULT',
      experimentKey: 'IXP1_39003',
      label: 'ERP-HERO-CONTROL',
      id: 50003,
      treatmentKey: 'IXP1_C',
      control: true,
    }),
  },

  // --- data-driven block: payload carries data, not just a content ref -----
  // Same REPLACE_WEB_CONTENT path as 39002, but the payload holds *data* the
  // renderer fills into the fragment template's {{token}} placeholders — so the
  // assignment's data visibly renders into an authored template (defaults show
  // for any field the payload omits). No split ⇒ every bucketed ivid gets it.
  39005: {
    label: 'ERP-HERO-DATA',
    assignment: assignment({
      experimentId: 39005,
      experimentType: 'REPLACE_WEB_CONTENT',
      experimentKey: 'IXP1_39005',
      label: 'ERP-HERO-DATA',
      id: 50005,
      treatmentKey: 'IXP1_T_50005',
      assetLocation: '/fragments/pzn/welcome',
      payload: JSON.stringify({
        headline: 'Welcome back, Acme Co.',
        cta: 'Resume your setup',
        badge: '30% off',
      }),
    }),
  },

  // --- non-IVID-typed experiment → graceful SDK error (200 + empty) --------
  39004: {
    label: 'ERP-BADTYPE',
    ividTyped: false,
    assignment: assignment({
      experimentId: 39004,
      experimentType: 'DEFAULT',
      experimentKey: 'IXP1_39004',
      label: 'ERP-BADTYPE',
      assignmentId: 'ENTITYID',
    }),
  },
};

/**
 * Sentinel ivids (only 1s and dashes) model a user bucketed into nothing.
 * @param {string} ivid
 * @returns {boolean}
 */
export function isBucketed(ivid) {
  return !/^[1-]+$/.test(ivid);
}

/**
 * Deterministic 0–99 bucket for an ivid within an experiment (FNV-1a hash).
 * Stable per visitor, so the same ivid always resolves to the same arm — this is
 * how a `treatmentSplit` fixture decides control vs treatment.
 * @param {string} ivid
 * @param {number} experimentId
 * @returns {number}
 */
export function bucketPercent(ivid, experimentId) {
  const s = `${ivid}:${experimentId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * True when the caller's app + BU sit inside the shared-cache scope.
 * @param {string} application
 * @param {string} businessUnit
 * @returns {boolean}
 */
export function inScope(application, businessUnit) {
  return ALLOWED_APPLICATIONS.has(application) && ALLOWED_BUSINESS_UNITS.has(businessUnit);
}

/**
 * Finds fixtures by numeric `experimentId` (0 or 1 match) or by `label` regex
 * (0..n matches — the spec notes a label is a regex that may match several).
 * @param {{ experimentId?: number, label?: string }} opts
 * @returns {Array<{ id: number, fixture: Fixture }>}
 */
export function findFixtures(opts) {
  const all = Object.entries(FIXTURES).map(([id, fixture]) => ({ id: Number(id), fixture }));
  if (opts.experimentId !== undefined) {
    return all.filter((f) => f.id === opts.experimentId);
  }
  if (opts.label !== undefined) {
    let re;
    try {
      re = new RegExp(opts.label);
    } catch {
      return []; // invalid regex → no matches
    }
    return all.filter((f) => re.test(f.fixture.label));
  }
  return [];
}
