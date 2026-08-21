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
 *   isButtonStyled?: boolean, isVideo?: boolean, isIcon?: boolean, host?: string}} ctx
 * @returns {Record<string, unknown>}
 */
export function deriveBaseline({
  tagName, label, blockName, isButtonStyled = true, isVideo = false, isIcon = false, host = '',
}) {
  let kind = uiObject(tagName, isButtonStyled);
  if (isVideo) kind = 'video_link';
  else if (isIcon) kind = 'link_icon'; // an icon/logo-only link (no visible text)
  const detail = (label || '').trim();
  const custom = {};
  // The live tracker appends the page host to link_name (e.g. "... [erp.intuit.com]").
  // Host is supplied only at runtime (stampInteraction); the pure derive + the
  // Node harness stay host-free, and the oracle normalizes the token.
  if (detail) custom.link_name = `${kind}-${slug(detail)}${host ? ` [${host}]` : ''}`;
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
  return cfg;
}

/**
 * Normalize the page path used to scope sheet keys: leading slash, no trailing
 * slash (except root), query/hash stripped — matching the authored `path` column.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  const path = (p || '/').split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

/**
 * Index raw sheet rows into `composite -> config`. Authoring uses TWO columns:
 *  - `path`: the page path for per-page body residue (e.g. /accounting/multi-entity),
 *    or `*` / blank for site-wide chrome (nav/footer/widgets).
 *  - `key`: `<blockKey>-<n>` (1-based DOM order), or a bare `<blockKey>` single-CTA.
 * They compose to the internal key sheetRowFor resolves: `<path>|<key>` (page-scoped)
 * or bare `<key>` (site-wide). A legacy composite `key` (already containing `|`) is
 * kept as-is. Rows with no `key`, or with NO residue at all (every value blank), are
 * skipped — an empty row overrides nothing. A duplicate composite keeps the last row.
 * @param {Array<Record<string, string>>} data
 * @returns {Map<string, Record<string, unknown>>}
 */
export function indexRows(data) {
  const byKey = new Map();
  (data || []).forEach((row) => {
    const key = (row.key ?? '').toString().trim();
    if (!key) return;
    const cfg = normalizeRow(row);
    if (!Object.keys(cfg).length) return; // residue-less row = no-op; drop it
    const p = (row.path ?? '').toString().trim();
    const composite = (p && p !== '*') ? `${normalizePath(p)}|${key}` : key;
    byKey.set(composite, cfg);
  });
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

  // The sacrificial anchor (always) + the opt-in switch ('' = compute the trail;
  // an explicit sheet value wins outright).
  attrs['data-tracking'] = derived.anchor;
  attrs['data-ui-access-point'] = cfg['ui-access-point'] ?? '';

  const cp = mergeCustomProperties(context.customProperties, derived['custom-properties'], cfg['custom-properties']);
  const cpStr = assembleCustomProperties(cp);

  // The re-verified tracker has NO separate wa-link path: object defaults to
  // content and every authored field is read. A wa-link only ADDS data-wa-link
  // (the tracker folds it into icom_user_action) — it never drops object-detail /
  // ui-object, so a sheet row can carry wa-link + object-detail together.
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

// What counts as a clickable CTA: real links/buttons, plus role=button widgets
// (e.g. the video block's poster/play control is a <div role="button">).
export const CTA_SELECTOR = 'a[href], button, [role="button"]';

/**
 * Trackable CTAs within a block, in DOM order.
 * @param {Element} block
 * @returns {Element[]}
 */
export function ctasIn(block) {
  return [...block.querySelectorAll(CTA_SELECTOR)];
}

/**
 * Apply a block's code-built payload defaults (stamped by trackAs) onto the
 * derived baseline — the seam for CODE-BUILT surfaces (header nav = engaged,
 * footer, video play = started) to override the generic derive without a sheet
 * row. Precedence: derive < block defaults < sheet. `data-track-link-name="off"`
 * drops the derived link_name (prod omits it where no custom-properties are
 * authored, e.g. footer/nav links).
 * @param {Record<string, unknown>} derived deriveBaseline() output (mutated)
 * @param {Element} block the opted-in block
 * @returns {Record<string, unknown>} derived
 */
export function applyBlockDefaults(derived, block) {
  if (!block || !block.getAttribute) return derived;
  const object = block.getAttribute('data-track-object');
  const action = block.getAttribute('data-track-action');
  const uiObj = block.getAttribute('data-track-ui-object');
  if (object) derived.object = object;
  if (action) derived.action = action;
  if (uiObj) derived['ui-object'] = uiObj;
  if (block.getAttribute('data-track-link-name') === 'off' && derived['custom-properties']) {
    delete derived['custom-properties'].link_name;
  }
  return derived;
}

/**
 * Look up the sheet row for the CTA at index `i` in a block whose opt-in key is
 * `key`, using UNIQUE keys (1-based DOM order). Body-content residue is PER-PAGE,
 * so rows may be page-scoped `<path>|<key>-<n>`; site-wide chrome (nav/footer/
 * widgets) stays `<key>-<n>`. Resolution order (most specific first):
 *   <path>|<key>-<n>  ->  <path>|<key> (i=0)  ->  <key>-<n>  ->  <key> (i=0)
 * @param {Map<string, Record<string, unknown>>|null} map
 * @param {string|null} key the block's tracking-<key>
 * @param {number} i CTA index within the block
 * @param {string} [path] the page path (defaults to '/')
 * @returns {Record<string, unknown>|null}
 */
export function sheetRowFor(map, key, i, path) {
  if (!map || !key) return null;
  const n = i + 1;
  const pp = normalizePath(path);
  const candidates = [
    `${pp}|${key}-${n}`,
    i === 0 ? `${pp}|${key}` : null,
    `${key}-${n}`,
    i === 0 ? key : null,
  ];
  for (let c = 0; c < candidates.length; c += 1) {
    if (candidates[c] && map.has(candidates[c])) return map.get(candidates[c]);
  }
  return null;
}

/**
 * Derive the baseline for a live element, detecting video links (YouTube/Vimeo)
 * so they map to object=video / ui_object=video_link. Exported so the Node dev
 * tools (harness, extractor) derive exactly as the runtime does.
 * @param {Element} el
 * @param {string} blockName
 * @param {string} [host] page host to append to link_name (runtime only)
 * @returns {Record<string, unknown>}
 */
export function deriveForCta(el, blockName, host = '') {
  const isVideo = el.tagName === 'A' && isVideoLink(el.getAttribute('href'));
  // A link/button whose visible content is an icon/logo (no text) reports
  // ui_object=link_icon on prod (brand logos, social icons).
  const isIcon = !isVideo && !(el.textContent || '').trim() && !!el.querySelector('img, svg, picture, .icon');
  return deriveBaseline({
    tagName: el.tagName,
    label: el.textContent,
    blockName,
    isButtonStyled: el.tagName === 'BUTTON' || el.classList.contains('button'),
    isVideo,
    isIcon,
    host,
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
  // Explicit authored data-tracking ALWAYS wins — the customer can inject trail
  // values on any parent (block, section, container) and the injected tracker
  // walks them up the DOM. We only fill in a default where none was authored.
  if (main && pageSeg && !main.hasAttribute('data-tracking')) main.setAttribute('data-tracking', pageSeg);

  optedInBlocks(root).forEach((block) => {
    // Author's explicit value wins; a trackAs no-trail opt-in (header/video)
    // stays trail-less on purpose.
    if (block.hasAttribute('data-tracking') || block.hasAttribute('data-track-no-trail')) return;
    // Default: the block name (dataset.blockName), falling back to its CSS class.
    // The trail is authored via markup data-tracking or trackAs; the sheet is
    // per-CTA identity only, so it no longer overrides the block trail.
    const seg = blockNameOf(block);
    if (seg) block.setAttribute('data-tracking', seg);
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
  const cta = target.closest(CTA_SELECTOR);
  // Pure-UI controls a code-built block opted out of (hamburger, flyout-back,
  // accordion/country toggles) carry data-track-skip and are never tracked.
  if (!cta || cta.closest('[data-track-skip]')) return null;
  const block = cta.closest(`[class*="${PREFIX}"]`);
  if (!block || !trackingKey(block)) return null;
  return { cta, block };
}

// ===========================================================================
// Region context (pzn/ixp) — Option B reads the personalization/experiment
// region registry the decision-engine renderer publishes and folds the
// winning region's identity into the interacted CTA's custom_properties. NO
// DOM data-attributes are involved (unlike the data-pzn-*/data-experiment-*
// walk in CLICK-TRACKING.md's "Personalization / experiment" section — that
// is a separate, already-shipped mechanism this leaves untouched).
//
// The registry contract is `scripts/personalization/tracking-context.js` on
// the pzn-exp-byo branch (PR #756, not present on this branch): byo.js's
// `renderDecision` calls `registerRegionContext(el, ctx)` for the winning
// PZN/IXP decision, publishing `window.__pznTrackingContext` as a
// `WeakMap<Element, ctx>` so a separate module graph (this runtime, today on
// its own branch) can resolve it without importing that exact specifier.
// `ctx = { source: 'pzn'|'ixp', ...identity }` — PZN carries { offerId,
// experimentId, treatmentId, placement }; IXP carries { experimentId,
// treatmentId, treatmentKey, control }.
//
// `resolveRegionContext` below is a LOCAL reader that mirrors that module's
// function of the same name by design (two separate branches today) — de-dupe
// once both land on main.
// ===========================================================================

/**
 * Walk from `fromEl` (inclusive) up to (not including) `document.body`,
 * returning the nearest ancestor's registered region context. Null when the
 * registry was never published (nothing upstream rendered a personalized/
 * experiment region on this page) or when no ancestor is registered — fails
 * open so a CTA outside any region resolves to no-op.
 * @param {Element} fromEl the interaction target (the CTA) to resolve from
 * @returns {{source: ('pzn'|'ixp')}|null} the nearest region's context, or null
 */
export function resolveRegionContext(fromEl) {
  // eslint-disable-next-line no-underscore-dangle -- fixed global name, see section header comment
  const registry = typeof window !== 'undefined' ? window.__pznTrackingContext : null;
  if (!registry) return null;
  for (let node = fromEl; node && node !== document.body; node = node.parentElement) {
    if (registry.has(node)) return registry.get(node);
  }
  return null;
}

// Identity field -> custom-properties key, namespaced by ctx.source. Only
// fields listed here are folded in; `source` itself is never emitted as a
// bare key (deliberately excluded from both maps).
const REGION_CUSTOM_PROPERTY_KEYS = {
  pzn: {
    offerId: 'pzn_offer',
    experimentId: 'pzn_experiment',
    treatmentId: 'pzn_treatment',
    placement: 'pzn_placement',
  },
  ixp: {
    experimentId: 'ixp_experiment',
    treatmentId: 'ixp_treatment',
    treatmentKey: 'ixp_treatment_key',
    control: 'ixp_control',
  },
};

/**
 * Map a resolved region context's identity fields onto `custom-properties`
 * keys namespaced by `ctx.source` (e.g. `offerId` -> `pzn_offer`; see
 * REGION_CUSTOM_PROPERTY_KEYS). A falsy/unrecognized-source `ctx` yields {},
 * so the result can be passed straight into resolveCta's
 * `context.customProperties` unconditionally.
 * @param {{source?: ('pzn'|'ixp')}|null} ctx resolveRegionContext() output
 * @returns {Record<string, string>}
 */
export function regionCustomProperties(ctx) {
  const keys = ctx && REGION_CUSTOM_PROPERTY_KEYS[ctx.source];
  if (!keys) return {};
  const out = {};
  Object.entries(ctx).forEach(([k, v]) => {
    if (k === 'source' || v == null || !keys[k]) return;
    out[keys[k]] = String(v);
  });
  return out;
}

/**
 * JIT-stamp the resolved (derived + sheet) data-* onto the interacted CTA so the
 * injected clickstream tracker reads them on the ensuing click. This is the
 * Option B core: nothing is stamped at rest — only the element the user is about
 * to activate, on the pointerdown/keydown that precedes its click. When the CTA
 * sits inside a registered pzn/ixp region, that region's identity is folded into
 * custom_properties too (nearest region wins; see resolveRegionContext) — a CTA
 * outside any region resolves an empty context, so its payload is unchanged.
 * @param {Event} e
 */
export function stampInteraction(e) {
  const hit = resolveTrackable(e.target);
  if (!hit) return;
  const { cta, block } = hit;
  const blockName = blockNameOf(block);
  const idx = ctasIn(block).indexOf(cta);
  const loc = (typeof window !== 'undefined' && window.location) || {};
  const host = loc.hostname || '';
  const row = sheetRowFor(sheetMap, trackingKey(block), idx, loc.pathname);
  const derived = applyBlockDefaults(deriveForCta(cta, blockName, host), block);
  const regionCtx = resolveRegionContext(cta);
  const context = regionCtx ? { customProperties: regionCustomProperties(regionCtx) } : {};
  stampCta(cta, resolveCta(derived, row, context));
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

/**
 * Declarative opt-in for a block's own `decorate()` — the code-built counterpart
 * to the authored `tracking-<key>` class. Marks the block tracked and stamps its
 * access-point trail segment (+ optional per-item segments), the way prod's
 * components emit their own `data-tracking`. Explicit authored values win.
 * Call it as the last statement of a block's decorate:
 *
 *   export default function decorate(block) { … return trackAs('hero', block); }
 *
 *   return trackAs('carousel', block, {
 *     itemSelector: '.carousel-card',
 *     itemLabel: (i, item) => `carousel_${i}`,
 *   });
 *
 * Multi-level trails (e.g. rw_cards_container|carousel|rw_card_N): use a broad
 * itemSelector that matches every contributing element and branch in itemLabel
 * on the element (return a falsy value to skip one). Because querySelectorAll is
 * in document order, a wrapper matches before its children, so the child index
 * lines up 1-based:
 *
 *   return trackAs('rw_cards_container', block, {
 *     itemSelector: '.cards-track, .cards-track > .card',
 *     itemLabel: (i, el) => (el.classList.contains('cards-track') ? 'carousel' : `rw_card_${i}`),
 *   });
 *
 * The trail segment (`name`) and the sheet/opt-in key are DECOUPLED: prod trail
 * strings carry cruft (rw2_hero) but the sheet keys stay clean. Pass `key` to set
 * the `tracking-<key>` opt-in class + the sheet lookup key; it defaults to `name`.
 *
 *   return trackAs('rw2_hero', block, { key: 'hero' }); // trail rw2_hero, sheet key hero-<n>
 *
 * CODE-BUILT surfaces (header nav, footer, video play) declare their payload
 * defaults here so the runtime reproduces prod without a sheet row: `action`
 * (nav -> engaged, video play -> started), `object` (video), `uiObject`, and
 * `linkName: false` to suppress the derived link_name (prod omits it on
 * footer/nav links). Pass a falsy `name` (with an explicit `key`) to opt a block
 * in WITHOUT contributing a trail segment — e.g. the header, whose links have no
 * data-tracking ancestor, so their trail resolves to '' (outside <main>).
 *
 *   return trackAs(null, block, { key: 'nav', action: 'engaged', linkName: false });
 *
 * @param {string|null} name the trail segment (data-tracking value), or falsy for opt-in only
 * @param {Element} block
 * @param {{key?: string, itemSelector?: string,
 *   itemLabel?: (index: number, item: Element) => string,
 *   action?: string, object?: string, uiObject?: string, linkName?: boolean, skip?: string}} [opts]
 *   `key` = the tracking-<key> opt-in + sheet key (defaults to `name`); `action`/`object`/
 *   `uiObject` = code-built payload defaults; `linkName:false` drops the derived link_name;
 *   `skip` = a selector for pure-UI controls to exclude from tracking (hamburger, toggles).
 * @returns {Element} the block (so it can be the decorate return value)
 */
export function trackAs(name, block, {
  key = name, itemSelector, itemLabel, action, object, uiObject: uiObjectDefault, linkName, skip,
} = {}) {
  if (!block) return block;
  // Exclude pure-UI controls (a code-built block opts them out): marks matching
  // descendants data-track-skip so resolveTrackable ignores them.
  if (skip) block.querySelectorAll(skip).forEach((el) => el.setAttribute('data-track-skip', ''));
  // Opt the block into click tracking (reuses the tracking-<key> machinery so
  // the delegated handler JIT-stamps its CTAs + the sheet is looked up by <key>-<n>);
  // an authored opt-in is left as-is. `key` is required when `name` is falsy.
  const optKey = key || name;
  if (optKey && !trackingKey(block)) block.classList.add(`${PREFIX}${optKey}`);
  // Block trail segment — an explicit authored data-tracking wins. A falsy `name`
  // means "opt in but contribute NO trail segment" (header links -> '', video play
  // -> 'page'); mark it so stampTrail's blockName default doesn't fill one in.
  if (name && !block.hasAttribute('data-tracking')) block.setAttribute('data-tracking', name);
  else if (!name && !block.hasAttribute('data-tracking')) block.setAttribute('data-track-no-trail', '');
  // Code-built payload defaults the runtime applies to this block's CTAs.
  if (object) block.setAttribute('data-track-object', object);
  if (action) block.setAttribute('data-track-action', action);
  if (uiObjectDefault) block.setAttribute('data-track-ui-object', uiObjectDefault);
  if (linkName === false) block.setAttribute('data-track-link-name', 'off');
  // Per-item trail segments for repeated children (carousel cards, accordion items…).
  if (itemSelector && typeof itemLabel === 'function') {
    block.querySelectorAll(itemSelector).forEach((item, idx) => {
      if (item.hasAttribute('data-tracking')) return; // respect explicit
      const seg = itemLabel(idx, item);
      if (seg) item.setAttribute('data-tracking', String(seg));
    });
  }
  return block;
}
