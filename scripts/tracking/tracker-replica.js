/**
 * Faithful replica of the live SBSEG click tracker's read logic, reverse-
 * engineered from erp.intuit.com (see CLICK-TRACKING.md). Given a clicked
 * element it returns the payload the tracker WOULD send, or null when the gate
 * blocks it.
 *
 * This is the parity oracle for the harness — it lets us diff our build's CTAs
 * against prod's by comparing computed payloads. Pure DOM reads; never shipped
 * (the real tracker does this at click time).
 */

const DATATRACKING = 'tracking';

// Walk up to the first data-tracking-bearing element, then step one above it, so
// the nearest data-tracking (the sacrificial "anchor") is skipped.
function findParentComponent(el) {
  let cur = el;
  let found = false;
  while (!found && cur && cur.nodeType === 1) {
    if (DATATRACKING in cur.dataset) found = true;
    cur = cur.parentNode;
  }
  return cur;
}

/**
 * ui_access_point trail: ancestors' data-tracking joined broad->specific
 * (outermost first, nearest last), hyphens -> underscores, the anchor skipped.
 * @param {Element} el clicked element
 * @returns {string}
 */
export function getTrackingAccessStructure(el) {
  let trackThread = '';
  let cur = findParentComponent(el);
  while (cur && cur.nodeType === 1) {
    if (DATATRACKING in cur.dataset) trackThread = `${cur.dataset.tracking}|${trackThread}`;
    cur = cur.parentNode;
  }
  trackThread = trackThread.trim();
  if (trackThread.length > 1 && trackThread.charAt(trackThread.length - 1) === '|') {
    trackThread = trackThread.slice(0, -1).replace(/-/g, '_').trim();
  }
  return trackThread;
}

// The gate: walk up to `max` ancestors from the clicked element for a truthy
// data-<key>; tests the VALUE (an empty attribute does not qualify).
function hasTruthyDataKey(el, keys) {
  return keys.some((k) => el.dataset[k]);
}

function findTrackableAncestor(el, max, keys) {
  let cur = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth <= max) {
    if (hasTruthyDataKey(cur, keys)) return cur;
    cur = cur.parentNode;
    depth += 1;
  }
  return null;
}

// Parse the tracker's `k|v,k|v` string; segments that aren't exactly two parts
// are dropped (authoring trap #2), mirroring the live parser.
export function parseCustomProperties(str) {
  const out = {};
  (str || '').split(',').forEach((pair) => {
    const kv = pair.split('|');
    if (kv.length === 2) {
      const [k, v] = kv;
      out[k] = v;
    }
  });
  return out;
}

function collectSurvey(ds, payload) {
  Object.keys(ds).forEach((k) => {
    if (!/^survey[A-Z]/.test(k)) return;
    const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (snake.startsWith('survey_answer_')) {
      const field = snake.slice('survey_answer_'.length);
      let v = ds[k];
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      payload[field] = v;
    } else {
      payload[snake] = ds[k];
    }
  });
}

/**
 * Compute the tracker payload for a clicked element, or null when the gate
 * (no data-object / data-wa-link within 5 ancestors) blocks it.
 * @param {Element} target clicked element
 * @returns {Record<string, unknown>|null}
 */
export function computeTrackingPayload(target) {
  const el = findTrackableAncestor(target, 5, ['object', 'waLink']);
  if (!el) return null;
  const ds = el.dataset;

  // ui_access_point: an explicit own value wins; otherwise the trail, but only
  // if the opt-in key is present on the element or an ancestor (presence, not value).
  let uiAccessPoint = '';
  if (ds.uiAccessPoint) uiAccessPoint = ds.uiAccessPoint;
  else if (el.closest('[data-ui-access-point]')) uiAccessPoint = getTrackingAccessStructure(target);

  const { waLink } = ds;
  if (!ds.object && waLink) {
    // wa-link path: minimal, hardcoded; element object/action attrs discarded.
    return {
      object: 'walink',
      ui_object: 'walink',
      action: 'INTERACTED',
      ui_action: 'INTERACTED',
      ui_access_point: uiAccessPoint,
      custom_properties: { 'data-wa-link': waLink },
    };
  }

  const payload = {
    object: ds.object,
    object_detail: ds.objectDetail ?? '',
    action: ds.action ?? '',
    ui_object: ds.uiObject ?? '',
    ui_object_detail: ds.uiObjectDetail ?? '',
    ui_action: ds.uiAction ?? '',
    ui_access_point: uiAccessPoint,
    custom_properties: parseCustomProperties(ds.customProperties),
  };
  if (waLink) payload.custom_properties['data-wa-link'] = waLink;
  collectSurvey(ds, payload);
  return payload;
}
