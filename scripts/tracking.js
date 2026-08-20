/**
 * Click-tracking decoration (single-file runtime).
 *
 * Opt-in: a block is tracked only when it carries a `tracking-<key>` variant
 * class. PREFIX is a single constant — change it here to re-map the trigger.
 *
 * Loaded LAZILY from scripts.js (like pzn/exp): tracking is not render-critical,
 * so it never sits on the eager/LCP module graph. Option B (data-layer):
 *  - initTracking(): register a delegated, capture-phase pointerdown/keydown
 *    handler and stamp the structural access-point trail.
 *  - stampInteraction(): on interaction, derive + JIT-stamp the CTA's data-* so
 *    the injected `ies-erp` clickstream tracker reads them on the ensuing click.
 * Nothing is stamped per-CTA at rest; the injected tracker attaches the ~47
 * context + consent and posts the batched `content:<action>` beacon.
 *
 * Everything the runtime needs lives here in one file (derive, sheet, resolve,
 * stamp, orchestration). The Node dev tools import the derive helpers from here
 * too — scripts/ is marked `type: module` so Node loads this ESM directly. See
 * CLICK-TRACKING.md ("The EDS authoring model").
 */

import { isVideoLink } from '../blocks/video/video-info.js';

// The block-variant class prefix that opts a block into click tracking.
export const PREFIX = 'tracking-';

// ===========================================================================
// Derive — the ~75% of a CTA's payload derivable from element + block context
// (no authoring). Exported so the Node dev tools reuse the exact same logic.
// ===========================================================================

const UI_ACTION = 'clicked';
const ACTION = 'interacted';
// A video link opens a player -> the live tracker reports object=video with
// action=engaged (vs the generic content default). Play buttons that emit
// `started` are a separate authored pattern (sheet), not auto-derived here.
const VIDEO_ACTION = 'engaged';
const DEFAULT_OBJECT = 'content';

/**
 * Slugify a visible label the way the live `link_name` reads:
 * "Schedule a call" -> "schedule-a-call".
 * @param {string} label
 * @returns {string}
 */
export function slug(label) {
  return (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `ui_object` from the element: styled CTAs report "button", a plain anchor "link".
 * @param {string} tagName uppercase tag (e.g. 'A', 'BUTTON')
 * @param {boolean} isButtonStyled whether an anchor is decorated as a button
 * @returns {string}
 */
export function uiObject(tagName, isButtonStyled) {
  if (tagName === 'BUTTON') return 'button';
  if (tagName === 'A') return isButtonStyled ? 'button' : 'link';
  return 'button';
}

/**
 * The block's own access-point segment, defaulted from its block name: a "cta"
 * block -> "cta_block". Hyphens become underscores (the tracker's trail rule).
 * @param {string} blockName
 * @returns {string}
 */
export function blockAccessPoint(blockName) {
  if (!blockName) return '';
  return `${blockName.replace(/-/g, '_')}_block`;
}

/**
 * Derived baseline for one CTA (map keyed by tracking-field name), plus `anchor`
 * (the sacrificial data-tracking value) and `custom-properties` (merged later).
 * A video link derives object=video / ui_object=video_link / action=engaged.
 * @param {{tagName: string, label: string, blockName: string,
 *   isButtonStyled?: boolean, isVideo?: boolean}} ctx
 * @returns {Record<string, unknown>}
 */
export function deriveBaseline({
  tagName, label, blockName, isButtonStyled = true, isVideo = false,
}) {
  const kind = isVideo ? 'video_link' : uiObject(tagName, isButtonStyled);
  const detail = (label || '').trim();
  const custom = {};
  if (detail) custom.link_name = `${kind}-${slug(detail)}`;
  return {
    object: isVideo ? 'video' : DEFAULT_OBJECT,
    'ui-object': kind,
    'ui-object-detail': detail,
    'ui-action': UI_ACTION,
    action: isVideo ? VIDEO_ACTION : ACTION,
    'access-point': blockAccessPoint(blockName),
    anchor: kind,
    'custom-properties': custom,
  };
}

// ===========================================================================
// Sheet — the authored residue + overrides.
//
// A dedicated multi-column DA sheet (not the flat site-config.json), fetched
// once and cached. Rows are keyed by `key` (matches `tracking-<key>`); a block
// with multiple CTAs uses one row per CTA with a 1-based `cta` column (DOM
// order), else a single row applies to the first CTA. Blank cells mean "defer
// to the derived value" and are dropped. Columns: key, cta, object,
// object-detail, action, ui-object, ui-object-detail, ui-action, access-point,
// ui-access-point, wa-link, custom-properties, survey. `custom-properties` and
// `survey` are authored as `k=v` pairs separated by newlines or semicolons.
// ===========================================================================

const SHEET_URL = '/tracking.json';

const SCALAR_COLUMNS = [
  'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
  'ui-action', 'access-point', 'ui-access-point', 'wa-link',
];

/**
 * Parse a `k=v` list (newline- or semicolon-separated) into a map. Blank-safe;
 * segments without a `=` (or with an empty key) are skipped.
 * @param {string} str
 * @returns {Record<string, string>}
 */
export function parseKeyValues(str) {
  const out = {};
  (str || '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 1) return;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (k) out[k] = v;
    });
  return out;
}

/**
 * Normalize one raw sheet row into a per-CTA config: blank cells dropped,
 * `custom-properties`/`survey` parsed to maps, `cta` coerced to a number.
 * @param {Record<string, string>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeRow(row) {
  const cfg = {};
  SCALAR_COLUMNS.forEach((col) => {
    const v = (row[col] ?? '').toString().trim();
    if (v !== '') cfg[col] = v;
  });
  const cp = parseKeyValues(row['custom-properties']);
  if (Object.keys(cp).length) cfg['custom-properties'] = cp;
  const survey = parseKeyValues(row.survey);
  if (Object.keys(survey).length) cfg.survey = survey;
  const cta = parseInt(row.cta, 10);
  if (Number.isFinite(cta)) cfg.cta = cta;
  return cfg;
}

/**
 * Index raw sheet rows into `key -> [config, ...]`, each key's configs ordered
 * by `cta` (rows without a `cta` sort last). Rows without a `key` are skipped.
 * @param {Array<Record<string, string>>} data
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
export function indexRows(data) {
  const byKey = new Map();
  (data || []).forEach((row) => {
    const key = (row.key ?? '').toString().trim();
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(normalizeRow(row));
  });
  byKey.forEach((rows) => rows.sort((a, b) => (a.cta ?? Infinity) - (b.cta ?? Infinity)));
  return byKey;
}

let sheetPromise;
// The resolved sheet map, cached synchronously once the fetch settles so the
// delegated pointerdown handler can read it without awaiting at click time.
let sheetMap = null;

/**
 * Fetch + index the tracking sheet once (cached). Returns an empty Map when the
 * sheet is unavailable (local/dev without it), so decoration fails open.
 * @returns {Promise<Map<string, Array<Record<string, unknown>>>>}
 */
export function fetchTrackingSheet() {
  if (!sheetPromise) {
    sheetPromise = fetch(SHEET_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => indexRows(json?.data))
      .catch(() => new Map());
  }
  return sheetPromise;
}

/**
 * Reset cached sheet state — test isolation only (each test needs a fresh fetch
 * stub and an empty resolved map).
 */
export function resetTrackingState() {
  sheetPromise = undefined;
  sheetMap = null;
}

// ===========================================================================
// Resolve — merge derived baseline + sheet + context into a data-* map.
// ===========================================================================

/**
 * Assemble the tracker's `k|v,k|v` custom-properties string. Values can't hold
 * the tracker's delimiters or the parse breaks (authoring trap #2) — since we
 * build the string, we drop unrepresentable pairs rather than corrupt it.
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
 * broad -> specific so the CTA's own props win.
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

// ===========================================================================
// Stamp — write resolved attributes onto the DOM (idempotent across the managed
// CTA set, so the sheet pass can correct the derived pass; survey is additive).
// ===========================================================================

const MANAGED = [
  'data-object', 'data-object-detail', 'data-action', 'data-ui-object',
  'data-ui-object-detail', 'data-ui-action', 'data-ui-access-point',
  'data-tracking', 'data-wa-link', 'data-custom-properties',
];

/**
 * Stamp the resolved data-* map onto a CTA. Managed attributes missing from
 * `attrs` are removed; `data-ui-access-point=''` is written on purpose (empty
 * presence is the opt-in switch).
 * @param {Element} el
 * @param {Record<string, string>} attrs
 */
export function stampCta(el, attrs) {
  if (!el || !attrs) return;
  MANAGED.forEach((name) => {
    if (name in attrs && attrs[name] != null) el.setAttribute(name, String(attrs[name]));
    else el.removeAttribute(name);
  });
  Object.keys(attrs).forEach((name) => {
    if (name.startsWith('data-survey-') && attrs[name] != null) {
      el.setAttribute(name, String(attrs[name]));
    }
  });
}

/**
 * Stamp a `data-tracking` segment onto a block/section/main element (a trail
 * contributor). No-op for a blank value or missing element.
 * @param {Element} el
 * @param {string} value
 */
export function stampTracking(el, value) {
  if (el && value) el.setAttribute('data-tracking', value);
}

// ===========================================================================
// Orchestration.
// ===========================================================================

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

/**
 * Derive the baseline for a live element, detecting video links (YouTube/Vimeo)
 * so they map to object=video / ui_object=video_link. Exported so the Node dev
 * tools (harness, extractor) derive exactly as the runtime does.
 * @param {Element} el
 * @param {string} blockName
 * @returns {Record<string, unknown>}
 */
export function deriveForCta(el, blockName) {
  return deriveBaseline({
    tagName: el.tagName,
    label: el.textContent,
    blockName,
    isButtonStyled: el.tagName === 'BUTTON' || el.classList.contains('button'),
    isVideo: el.tagName === 'A' && isVideoLink(el.getAttribute('href')),
  });
}

function optedInBlocks(root) {
  return [...root.querySelectorAll(`[class*="${PREFIX}"]`)].filter((b) => trackingKey(b));
}

/**
 * Stamp the STRUCTURAL access-point trail (page + per-block segments) — a
 * handful of attributes, never per-CTA. This is the one thing that must exist
 * at rest so the injected clickstream tracker's ancestor-chain walk resolves a
 * trail (rather than falling back to `page`). Idempotent; consults the sheet
 * for a block access-point override once it has loaded.
 * @param {ParentNode} [scope]
 */
export function stampTrail(scope = document) {
  const root = scope.querySelectorAll ? scope : document;
  const main = document.querySelector('main');
  const pageSeg = (document.head?.querySelector('meta[name="tracking"]')?.content || '').trim();
  if (main && pageSeg) stampTracking(main, pageSeg);

  optedInBlocks(root).forEach((block) => {
    const rows = (sheetMap && sheetMap.get(trackingKey(block))) || [];
    const apRow = rows.find((r) => r['access-point']);
    stampTracking(block, apRow ? apRow['access-point'] : blockAccessPoint(blockNameOf(block)));
  });
}

/**
 * From an interaction target, resolve the trackable CTA — the nearest
 * a[href]/button inside an opted-in `tracking-` block — plus that block. Null
 * when the target is untracked.
 * @param {EventTarget} target
 * @returns {{cta: Element, block: Element}|null}
 */
export function resolveTrackable(target) {
  if (!target || !target.closest) return null;
  const cta = target.closest('a[href], button');
  if (!cta) return null;
  const block = cta.closest(`[class*="${PREFIX}"]`);
  if (!block || !trackingKey(block)) return null;
  return { cta, block };
}

/**
 * JIT-stamp the resolved (derived + sheet) data-* onto the interacted CTA so the
 * injected clickstream tracker reads them on the ensuing click. This is the
 * Option B core: nothing is stamped at rest — only the element the user is about
 * to activate, on the pointerdown/keydown that precedes its click.
 * @param {Event} e
 */
export function stampInteraction(e) {
  const hit = resolveTrackable(e.target);
  if (!hit) return;
  const { cta, block } = hit;
  const blockName = blockNameOf(block);
  const rows = (sheetMap && sheetMap.get(trackingKey(block))) || [];
  const idx = ctasIn(block).indexOf(cta);
  stampCta(cta, resolveCta(deriveForCta(cta, blockName), rowForIndex(rows, idx)));
}

/**
 * Option B runtime entry point: a delegated, capture-phase handler that derives
 * and JIT-stamps click-tracking data-* on interaction (pointerdown + keyboard
 * activation), feeding the injected `ies-erp` clickstream tracker without
 * cluttering the DOM at rest. Pre-warms the sheet and stamps the structural
 * trail up front (and re-stamps it once the sheet resolves).
 * @param {ParentNode} [scope]
 * @returns {(e: Event) => void} the bound handler (for teardown/tests)
 */
export function initTracking(scope = document) {
  const root = scope && scope.addEventListener ? scope : document;
  fetchTrackingSheet().then((m) => { sheetMap = m; stampTrail(root); }).catch(() => {});
  stampTrail(root);
  root.addEventListener('pointerdown', stampInteraction, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') stampInteraction(e);
  }, true);
  return stampInteraction;
}
