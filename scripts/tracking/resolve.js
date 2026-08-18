/**
 * Click-tracking: resolve the final CTA attribute map from the derived baseline
 * + the authored sheet config + hierarchical context. Pure (no DOM writes). See
 * CLICK-TRACKING.md ("Identity vs context", "Cascade mechanics").
 */

/**
 * Assemble the tracker's `k|v,k|v` custom-properties string. Values can't hold
 * the tracker's own delimiters or the parse breaks (authoring trap #2) — since
 * we build the string, we drop unrepresentable pairs rather than corrupt the
 * payload.
 * @param {Record<string, string>} map
 * @returns {string}
 */
export function assembleCustomProperties(map) {
  return Object.entries(map || {})
    .filter(([k, v]) => k && v != null && v !== ''
      && !/[|,]/.test(k) && !/[|,]/.test(String(v)))
    .map(([k, v]) => `${k}|${v}`)
    .join(',');
}

/**
 * Merge custom-property maps; later sources win on key collision. Callers pass
 * broad -> specific so the CTA's own props win (CLICK-TRACKING.md).
 * @param  {...Record<string, string>} maps
 * @returns {Record<string, string>}
 */
export function mergeCustomProperties(...maps) {
  return Object.assign({}, ...maps.map((m) => m || {}));
}

/**
 * Resolve the data-* attribute map for one CTA.
 * @param {Record<string, unknown>} derived deriveBaseline() output
 * @param {Record<string, unknown>|null} sheet normalized sheet row, or null
 * @param {{customProperties?: Record<string, string>}} [context] section/page context
 * @returns {Record<string, string>} data-* attribute name -> value
 */
export function resolveCta(derived, sheet, context = {}) {
  const cfg = sheet || {};
  const attrs = {};
  const waLink = cfg['wa-link'];
  // Faithful wa-link path: an authored wa-link with no object stays minimal — do
  // NOT inject the derived object, which would flip the beacon shape.
  const waLinkPath = !!waLink && !cfg.object;

  // The sacrificial anchor (always) + the opt-in switch ('' = compute the trail;
  // an explicit sheet value wins outright).
  attrs['data-tracking'] = derived.anchor;
  attrs['data-ui-access-point'] = cfg['ui-access-point'] ?? '';

  const cp = mergeCustomProperties(context.customProperties, derived['custom-properties'], cfg['custom-properties']);
  const cpStr = assembleCustomProperties(cp);

  if (waLinkPath) {
    attrs['data-wa-link'] = waLink;
    if (cpStr) attrs['data-custom-properties'] = cpStr;
    return attrs;
  }

  attrs['data-object'] = cfg.object ?? derived.object;
  if (cfg['object-detail'] != null) attrs['data-object-detail'] = cfg['object-detail'];
  attrs['data-action'] = cfg.action ?? derived.action;
  attrs['data-ui-object'] = cfg['ui-object'] ?? derived['ui-object'];
  attrs['data-ui-object-detail'] = cfg['ui-object-detail'] ?? derived['ui-object-detail'];
  attrs['data-ui-action'] = cfg['ui-action'] ?? derived['ui-action'];
  // On the full path a wa-link still folds into custom_properties (tracker does that).
  if (waLink) attrs['data-wa-link'] = waLink;
  if (cpStr) attrs['data-custom-properties'] = cpStr;

  Object.entries(cfg.survey || {}).forEach(([k, v]) => {
    const name = k.startsWith('survey-') ? k : `survey-${k}`;
    attrs[`data-${name}`] = v;
  });

  return attrs;
}
