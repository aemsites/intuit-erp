// Stamps the offer/experiment identity onto an applied element as the data-*
// attributes the SBSEG click tracker reads (on click it walks ancestors for
// data-pzn-placement). Values mirror pznRecord / ixpRecord, so this block-level click
// channel agrees with the page-level window.appVars channel.
//   data-pzn-placement      <- personalization_placement
//   data-pzn-id             <- personalization_id
//   data-experiment-id      <- experiment_id
//   data-experiment-version <- experiment_version
//   data-treatment-id       <- experiment_treatment
// (action/workflow are tracker constants, not attributes.)

// Writes the attribute only for a real value — a blank data-pzn-placement would still
// trip the tracker's walk.
function setAttr(el, name, value) {
  if (value !== undefined && value !== null && value !== '') {
    el.setAttribute(name, String(value));
  }
}

// Experiment identity, shared by pzn and ixp records. No-op when the record has none.
export function stampExperiment(el, record) {
  if (!el || !record) return;
  setAttr(el, 'data-experiment-id', record.experiment_id);
  setAttr(el, 'data-experiment-version', record.experiment_version);
  setAttr(el, 'data-treatment-id', record.experiment_treatment);
}

// Placement + id, plus any experiment identity on the same pzn record.
export function stampPzn(el, record) {
  if (!el || !record) return;
  setAttr(el, 'data-pzn-placement', record.personalization_placement);
  setAttr(el, 'data-pzn-id', record.personalization_id);
  stampExperiment(el, record);
}
