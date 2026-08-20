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
 *
 * Models the LIVE `track-event-lib-init` tracker as re-verified 2026-08-20 (see
 * scripts/diff/fixtures/backend-contract.json), NOT the older reverse-engineered
 * shape:
 *  - event name is `${object}:${action}`;
 *  - unauthored defaults: object=content, action=engaged, ui_object=link,
 *    ui_action=clicked (there is NO separate walink/INTERACTED path);
 *  - every `data-custom-properties` `k|v` pair expands to a TOP-LEVEL property
 *    (no `custom_properties` object);
 *  - ui_access_point is the computed data-tracking trail (fallback `page`),
 *    opt-in by the mere PRESENCE of data-ui-access-point — an authored value
 *    does NOT win;
 *  - a wa-link adds a top-level `data-wa-link` and `icom_user_action`
 *    (`<wa-link> [breadcrumb]`, breadcrumb = page context supplied by caller).
 * @param {Element} target clicked element
 * @param {{breadcrumb?: string}} [context] page context (org|purpose|scope|
 *   scope_area|screen) the tracker appends to icom_user_action — not DOM-derivable.
 * @returns {Record<string, unknown>|null}
 */
export function computeTrackingPayload(target, context = {}) {
  const el = findTrackableAncestor(target, 5, ['object', 'waLink']);
  if (!el) return null;
  const ds = el.dataset;

  const object = ds.object || 'content';
  const action = ds.action || 'engaged';
  const payload = {
    event: `${object}:${action}`,
    object,
    action,
    ui_object: ds.uiObject || 'link',
    ui_action: ds.uiAction || 'clicked',
  };
  if (ds.objectDetail != null) payload.object_detail = ds.objectDetail;
  if (ds.uiObjectDetail != null) payload.ui_object_detail = ds.uiObjectDetail;

  // ui_access_point: opt-in by PRESENCE of data-ui-access-point (empty '' counts);
  // value = the computed data-tracking trail, falling back to 'page'.
  if (el.closest('[data-ui-access-point]')) {
    payload.ui_access_point = getTrackingAccessStructure(target) || 'page';
  }

  const { waLink } = ds;
  if (waLink) {
    payload['data-wa-link'] = waLink;
    payload.icom_user_action = context.breadcrumb ? `${waLink} [${context.breadcrumb}]` : waLink;
  }

  // custom-properties: every k|v pair becomes a TOP-LEVEL property.
  Object.assign(payload, parseCustomProperties(ds.customProperties));

  collectSurvey(ds, payload);
  return payload;
}
