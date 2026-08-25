/**
 * Click-tracking runtime (single file). Track-by-default: every CTA
 * (a[href]/button/[role="button"]) in <main>/<header>/<footer> is tracked; pure-UI
 * controls opt out via data-track-skip. A block MAY declare its trail + payload
 * defaults + id scheme via trackAs. Nothing is stamped per-CTA at rest — on
 * pointerdown/keydown (capture) stampInteraction JIT-stamps the resolved data-* for
 * the injected ies-erp tracker to read. Loaded lazily from scripts.js; the Node dev
 * tools import the derive/resolve helpers. Full model: CLICK-TRACKING.md.
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
 * Derived baseline for one CTA (keyed by tracking-field name), plus `anchor` (the
 * sacrificial data-tracking; null for a video link -> resolves flat to `page`) and
 * `custom-properties` (merged later). A video link derives object=video /
 * ui_object=video_link / action=engaged.
 * @param {{tagName: string, label: string, blockName: string,
 *   isButtonStyled?: boolean, isVideo?: boolean, isIcon?: boolean, host?: string}} ctx
 * @returns {Record<string, unknown>}
 */
export function deriveBaseline({
  tagName, label, blockName, isButtonStyled = true, isVideo = false, isIcon = false, host = '', kind: kindOverride,
}) {
  let kind = uiObject(tagName, isButtonStyled);
  if (isVideo) kind = 'video_link';
  else if (isIcon) kind = 'link_icon'; // an icon/logo-only link (no visible text)
  if (kindOverride) kind = kindOverride; // alsoTrack part: explicit ui_object (image, …)
  const detail = (label || '').trim();
  const custom = {};
  // link_name = <kind>-<slug>; the tracker appends the page host at runtime.
  if (detail) custom.link_name = `${kind}-${slug(detail)}${host ? ` [${host}]` : ''}`;
  return {
    object: isVideo ? 'video' : DEFAULT_OBJECT,
    'ui-object': kind,
    'ui-object-detail': detail,
    'ui-action': UI_ACTION,
    action: isVideo ? VIDEO_ACTION : ACTION,
    'access-point': blockAccessPoint(blockName),
    anchor: isVideo ? null : kind,
    'custom-properties': custom,
  };
}

// ===========================================================================
// Sheet — authored residue, fetched once from a DA sheet and cached. Rows are
// keyed by `path` + `id` (the CTA's data-track-id) — see indexRows. Blank cells
// defer to the derived value; `custom-properties`/`survey` are `k=v` pairs.
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
 * Canonicalize an href: absolute URL, query/hash/trailing-slash stripped, relative
 * resolved against the page origin. '' for non-navigational hrefs (#, javascript:,
 * mailto:, tel:, empty). The basis for hrefSlug.
 * @param {string} href
 * @returns {string}
 */
export function normalizeHref(href) {
  const raw = (href || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  const base = (typeof window !== 'undefined' && window.location && window.location.href) || 'https://localhost/';
  let url;
  try { url = new URL(raw, base); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

// Hosts treated as "our own" and stripped from a derived id, so a link reads
// `company`, not `intuit-company`. Must include the canonical PROD host so ids are
// deploy-independent: a relative link resolves to whatever host the runtime is on
// (aem.page preview, stage, prod), but its id must be the same everywhere and match
// the prod-golden-derived sheet. CANONICAL_HOST also labels own-host root links
// (`/` -> `<key>:erp`, not the runtime host's label). Site-specific knob.
const CANONICAL_HOST = 'erp.intuit.com';
const OWN_HOSTS = new Set([CANONICAL_HOST, 'intuit.com', 'www.intuit.com']);

/**
 * The distinctive host label for an id: a product subdomain, else the SLD.
 * turbotax.intuit.com -> turbotax, www.intuit.com -> intuit, mailchimp.com -> mailchimp.
 * @param {string} href
 * @returns {string}
 */
export function hostLabel(href) {
  const norm = normalizeHref(href);
  if (!norm) return '';
  const host = new URL(norm).host.replace(/^www\./, '');
  if (host === 'intuit.com') return 'intuit';
  if (host.endsWith('.intuit.com')) return host.slice(0, host.indexOf('.'));
  const labels = host.split('.');
  return labels.length > 2 ? labels[labels.length - 2] : labels[0];
}

/**
 * A short, readable id slug from a CTA's href — the deterministic core trackId
 * builds on. Own-site links reduce to their path (intuit.com/company -> company);
 * external ones keep a host label (turbotax.intuit.com/ -> turbotax). '' if not
 * navigational.
 * @param {string} href
 * @returns {string}
 */
export function hrefSlug(href) {
  const norm = normalizeHref(href);
  if (!norm) return '';
  const url = new URL(norm);
  const pageHost = (typeof window !== 'undefined' && window.location && window.location.host) || '';
  const own = url.host === pageHost || OWN_HOSTS.has(url.host);
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  const parts = [];
  if (!own) parts.push(hostLabel(norm));
  if (path) parts.push(path);
  if (parts.length) return slug(parts.join('/'));
  // Own-host root link: a KNOWN own host keeps its own label (intuit.com -> intuit,
  // erp.intuit.com -> erp); a relative link resolved to the RUNTIME deploy host
  // (aem.page/stage) uses the canonical label so the id is deploy-independent.
  return OWN_HOSTS.has(url.host) ? hostLabel(norm) : hostLabel(`https://${CANONICAL_HOST}`);
}

/**
 * Default trackId deriver: `<key>:<hrefSlug>`, or null for an href-less control
 * (the block's own trackId gives those a semantic id). Accepts an element or href.
 * @param {Element|string} el
 * @param {string} key id namespace
 * @returns {string|null}
 */
export function hrefTrackId(el, key) {
  const s = hrefSlug(el && el.getAttribute ? el.getAttribute('href') : el);
  return s ? `${key}:${s}` : null;
}

/**
 * Index raw sheet rows into `composite -> config`. `path` (page path, or `*`/blank =
 * site-wide) + `id` (the CTA's data-track-id) compose to `<path>|<id>` or bare `<id>`;
 * a legacy positional `key` (`<blockKey>-<n>`) is read as an id fallback. Rows with no
 * id/key or no residue are dropped; a duplicate composite keeps the last.
 * @param {Array<Record<string, string>>} data
 * @returns {Map<string, Record<string, unknown>>}
 */
export function indexRows(data) {
  const byKey = new Map();
  (data || []).forEach((row) => {
    const key = (row.id ?? row.key ?? '').toString().trim();
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

  // Sacrificial anchor (null for a video link -> block trail consumed -> resolves
  // flat to `page`, as prod does) + the opt-in switch ('' = compute the trail).
  if (derived.anchor != null) attrs['data-tracking'] = derived.anchor;
  attrs['data-ui-access-point'] = cfg['ui-access-point'] ?? '';

  const cp = mergeCustomProperties(context.customProperties, derived['custom-properties'], cfg['custom-properties']);
  const cpStr = assembleCustomProperties(cp);

  // No separate wa-link path: object defaults to content, every field is read, and
  // a wa-link only ADDS data-wa-link (so a row can carry wa-link + object-detail).
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
 * The CTA's data-track-id (its stable sheet key), or null when the block stamped
 * none — the resolver reads only this attribute, never href.
 * @param {Element} el
 * @returns {string|null}
 */
export function trackIdOf(el) {
  return (el && el.getAttribute && el.getAttribute('data-track-id')) || null;
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

// Content regions we track. Track-by-default fires only inside these, so injected
// chrome mounted at the body root (OneTrust consent, dev sidekick, third-party
// widgets) is never tracked — matching what the live tracker effectively covers.
export const TRACKED_REGIONS = 'main, header, footer';

// The generic key + trail segment for CTAs that belong to no declared block —
// loose content links the live tracker reports with ui_access_point "page".
export const PAGE_KEY = 'page';

/**
 * Trackable CTAs within a block, in DOM order.
 * @param {Element} block
 * @returns {Element[]}
 */
export function ctasIn(block) {
  return [...block.querySelectorAll(CTA_SELECTOR)];
}

/**
 * Apply a block's code-built payload defaults (data-track-object/-action/-ui-object/
 * -link-name) onto the derived baseline, each read from the CTA's NEAREST ancestor
 * carrying it (so a block sets a default and a sub-section refines it). Precedence:
 * derive < ancestor default < sheet. `-link-name="off"` drops the derived link_name.
 * @param {Record<string, unknown>} derived (mutated)
 * @param {Element} cta
 * @returns {Record<string, unknown>}
 */
export function applyBlockDefaults(derived, cta) {
  if (!cta || !cta.closest) return derived;
  const near = (attr) => { const el = cta.closest(`[${attr}]`); return el ? el.getAttribute(attr) : null; };
  const object = near('data-track-object');
  const action = near('data-track-action');
  const uiObj = near('data-track-ui-object');
  if (object) derived.object = object;
  if (action) derived.action = action;
  if (uiObj) derived['ui-object'] = uiObj;
  if (near('data-track-link-name') === 'off' && derived['custom-properties']) {
    delete derived['custom-properties'].link_name;
  }
  return derived;
}

/**
 * Look up the sheet row for a CTA by its `data-track-id`. Identity, not DOM
 * position, so it is immune to render-order drift. Page-scoped body residue tries
 * `<path>|<id>` first, then the bare site-wide `<id>` (nav/footer/widget chrome).
 * @param {Map<string, Record<string, unknown>>|null} map
 * @param {string|null} id the CTA's data-track-id / normalized href
 * @param {string} [path] the page path (defaults to '/')
 * @returns {Record<string, unknown>|null}
 */
export function sheetRowById(map, id, path) {
  if (!map || !id) return null;
  const pp = normalizePath(path);
  const candidates = [`${pp}|${id}`, id];
  for (let c = 0; c < candidates.length; c += 1) {
    if (map.has(candidates[c])) return map.get(candidates[c]);
  }
  return null;
}

/**
 * The label the live tracker reads for ui_object_detail + link_name: an element's
 * accessible name — visible text, else an inner image's alt, else aria-label.
 * Prod annotates text-less CTAs (icon/image/logo links) from their alt/aria-label,
 * so a plain textContent read under-derives both fields.
 * @param {Element} el
 * @returns {string}
 */
export function labelFor(el) {
  const text = (el.textContent || '').trim();
  if (text) return text;
  const img = el.matches && el.matches('img[alt]') ? el : el.querySelector('img[alt]');
  const alt = img && (img.getAttribute('alt') || '').trim();
  if (alt) return alt;
  return (el.getAttribute('aria-label') || '').trim();
}

/**
 * The accessible name for an alsoTrack "part" (a non-CTA beacon source like a
 * card's body/thumbnail). A content container's name is its TITLE, not its full
 * flowing text (category + title + date), so prefer a heading or a `*-title`
 * element; falls back to labelFor (an image part's own alt, which we set to the
 * card title). Matches prod, which reports the card title as a slot's detail.
 * @param {Element} el
 * @returns {string}
 */
export function partLabel(el) {
  const title = el.querySelector && el.querySelector('h1, h2, h3, h4, h5, h6, [class$="-title"]');
  const t = title && (title.textContent || '').trim();
  return t || labelFor(el);
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
  const partKind = el.getAttribute && el.getAttribute('data-track-as'); // alsoTrack part
  const isVideo = !partKind && el.tagName === 'A' && isVideoLink(el.getAttribute('href'));
  // icon/logo-only LINK (an anchor with no visible text) -> ui_object=link_icon;
  // a text-less button stays a button (prod reserves link_icon for icon anchors).
  const isIcon = !partKind && !isVideo && el.tagName === 'A' && !(el.textContent || '').trim() && !!el.querySelector('img, svg, picture, .icon');
  return deriveBaseline({
    tagName: el.tagName,
    label: partKind ? partLabel(el) : labelFor(el),
    blockName,
    isButtonStyled: el.tagName === 'BUTTON' || el.classList.contains('button'),
    isVideo,
    isIcon,
    host,
    kind: partKind || undefined,
  });
}

function optedInBlocks(root) {
  return [...root.querySelectorAll(`[class*="${PREFIX}"]`)].filter((b) => trackingKey(b));
}

/**
 * Stamp the structural access-point trail (page + per-block data-tracking segments)
 * — the one thing stamped at rest, so the tracker's ancestor walk resolves a trail.
 * Idempotent.
 * @param {ParentNode} [scope]
 */
export function stampTrail(scope = document) {
  const root = scope.querySelectorAll ? scope : document;
  const main = document.querySelector('main');
  const pageSeg = (document.head?.querySelector('meta[name="tracking"]')?.content || '').trim();
  // Authored data-tracking always wins; fill a default only where none exists.
  if (main && pageSeg && !main.hasAttribute('data-tracking')) main.setAttribute('data-tracking', pageSeg);

  optedInBlocks(root).forEach((block) => {
    // Authored value or a no-trail opt-in wins; else default to the block name.
    if (block.hasAttribute('data-tracking') || block.hasAttribute('data-track-no-trail')) return;
    const seg = blockNameOf(block);
    if (seg) block.setAttribute('data-tracking', seg);
  });
}

/**
 * Resolve the trackable CTA nearest an interaction target (or an alsoTrack part),
 * plus its declared block if any. Null when the target isn't a CTA, is
 * data-track-skip, or sits outside <main>/<header>/<footer> with no declared block.
 * @param {EventTarget} target
 * @returns {{cta: Element, block: Element|null}|null}
 */
export function resolveTrackable(target) {
  if (!target || !target.closest) return null;
  // An alsoTrack part (nearest-wins over the enclosing CTA), else the CTA itself.
  const el = target.closest(`[data-track-as], ${CTA_SELECTOR}`);
  if (!el || el.closest('[data-track-skip]')) return null; // pure-UI controls opt out
  const blk = el.closest(`[class*="${PREFIX}"]`);
  const block = (blk && trackingKey(blk)) ? blk : null;
  // A part tracks only inside its block; a declared block tracks anywhere it mounts.
  if (el.hasAttribute('data-track-as')) return block ? { cta: el, block } : null;
  if (!el.closest(TRACKED_REGIONS) && !block) return null;
  return { cta: el, block };
}

// ===========================================================================
// Region context (pzn/ixp) — fold the winning personalized/experiment region's
// identity into the CTA's custom_properties. Reads window.__pznTrackingContext,
// a WeakMap<Element, {source:'pzn'|'ixp', ...identity}> the decision-engine
// renderer publishes (no DOM attributes). Separate from the data-pzn-*/
// data-experiment-* walk in CLICK-TRACKING.md, which this leaves untouched.
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
 * JIT-stamp the resolved (derived + sheet + region context) data-* onto the
 * interacted CTA so the injected tracker reads them on the ensuing click. Nothing
 * is stamped at rest. Any enclosing pzn/ixp region's identity folds into
 * custom_properties (nearest wins).
 * @param {Event} e
 */
export function stampInteraction(e) {
  const hit = resolveTrackable(e.target);
  if (!hit) return;
  const { cta, block } = hit;
  const loc = (typeof window !== 'undefined' && window.location) || {};
  const host = loc.hostname || '';
  // A declared block gives its name (trail/derive); a loose CTA falls to `page`. An
  // alsoTrack part (card thumbnail) is pure-derive — no sheet residue.
  const isPart = cta.hasAttribute('data-track-as');
  const blockName = block ? blockNameOf(block) : '';
  // Resolve the sheet row by the CTA's id (identity, order-independent). A block
  // stamps data-track-id via trackAs; a loose content CTA derives its `page:<...>`
  // id here (the block-less counterpart of the default deriver).
  let row = null;
  if (!isPart) {
    let id = trackIdOf(cta);
    if (!id && !block) id = hrefTrackId(cta, PAGE_KEY) || (labelFor(cta) ? `${PAGE_KEY}:${slug(labelFor(cta))}` : null);
    if (id) row = sheetRowById(sheetMap, id, loc.pathname);
  }
  // Parts are pure-derive (no block payload defaults); the one exception is
  // link-name-off, which alsoTrack stamps on the part itself.
  let derived = deriveForCta(cta, blockName, host);
  if (isPart) {
    if (cta.getAttribute('data-track-link-name') === 'off' && derived['custom-properties']) {
      delete derived['custom-properties'].link_name;
    }
  } else {
    derived = applyBlockDefaults(derived, cta);
  }
  const regionCtx = resolveRegionContext(cta);
  const context = regionCtx ? { customProperties: regionCustomProperties(regionCtx) } : {};
  stampCta(cta, resolveCta(derived, row, context));
}

/**
 * Runtime entry point: register the delegated capture-phase pointerdown/keydown
 * handler, pre-warm the sheet, and stamp the structural trail (re-stamped once the
 * sheet resolves).
 * @param {ParentNode} [scope]
 * @returns {(e: Event) => void} the handler (for teardown/tests)
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
 * Declarative click-tracking opt-in for a block's decorate() — the code-built
 * counterpart to the authored `tracking-<key>` class. Marks the block tracked,
 * stamps its trail segment(s), derives each CTA's data-track-id, and records
 * payload defaults. Explicit authored values (data-tracking, data-track-id) win.
 * Call it last: `return trackAs('hero', block, { key: 'hero' })`. Examples +
 * rationale: CLICK-TRACKING.md.
 *
 * @param {string|null} name trail segment (data-tracking); falsy = opt in, no trail
 * @param {Element} block
 * @param {object} [opts]
 * @param {string} [opts.key] tracking-<key> opt-in + id namespace (defaults to name)
 * @param {(el: Element) => (string|null)} [opts.trackId] per-CTA data-track-id deriver
 *   (default `<key>:<hrefSlug>`); branch inside it for collisions / href-less controls
 * @param {Record<string, string|((i:number, el:Element)=>string)>} [opts.items]
 *   selector -> inner-slot trail segment (fixed string, or (index, el) => string)
 * @param {Record<string, string|{as:string, linkName?:boolean}>} [opts.alsoTrack]
 *   selector -> ui_object, registering non-CTA beacon sources (#769)
 * @param {string} [opts.action]
 * @param {string} [opts.object]
 * @param {string} [opts.uiObject] code-built payload defaults
 * @param {boolean} [opts.linkName] false drops the derived link_name
 * @param {string} [opts.skip] selector for pure-UI controls to exclude
 * @returns {Element} block
 */
export function trackAs(name, block, {
  key = name, items, trackId, alsoTrack, action, object,
  uiObject: uiObjectDefault, linkName, skip,
} = {}) {
  if (!block) return block;
  // Opt pure-UI controls out (hamburger, toggles) via data-track-skip.
  if (skip) block.querySelectorAll(skip).forEach((el) => el.setAttribute('data-track-skip', ''));
  // Stamp each non-skipped CTA's data-track-id (order-independent sheet key). The
  // default is `<key>:<hrefSlug>`, falling back to `<key>:<slug(label)>` for an
  // href-less control; duplicates within the block get a stable -2/-3 suffix. A
  // block passes its own trackId(el) to control ids (and its own dedupe — e.g. the
  // footer's mobile/desktop country share one id) — no auto-suffix there. Returns
  // falsy to leave a CTA pure-derive. An authored data-track-id wins.
  const ns = key || name;
  const custom = typeof trackId === 'function';
  const deriveId = custom
    ? trackId
    : (el) => hrefTrackId(el, ns) || (labelFor(el) ? `${ns}:${slug(labelFor(el))}` : null);
  const usedIds = new Set();
  block.querySelectorAll(CTA_SELECTOR).forEach((el) => {
    if (el.hasAttribute('data-track-id') || el.closest('[data-track-skip]')) return;
    let v = deriveId(el);
    if (!v) return;
    if (!custom) {
      if (usedIds.has(v)) { let n = 2; while (usedIds.has(`${v}-${n}`)) n += 1; v = `${v}-${n}`; }
      usedIds.add(v);
    }
    el.setAttribute('data-track-id', String(v));
  });
  // Opt the block in via the tracking-<key> class (authored opt-in left as-is).
  const optKey = key || name;
  if (optKey && !trackingKey(block)) block.classList.add(`${PREFIX}${optKey}`);
  // Block trail segment (authored data-tracking wins). Falsy `name` = opt in with
  // NO trail; mark it so stampTrail's blockName default doesn't fill one in.
  if (name && !block.hasAttribute('data-tracking')) block.setAttribute('data-tracking', name);
  else if (!name && !block.hasAttribute('data-tracking')) block.setAttribute('data-track-no-trail', '');
  // Code-built payload defaults the runtime applies to this block's CTAs.
  if (object) block.setAttribute('data-track-object', object);
  if (action) block.setAttribute('data-track-action', action);
  if (uiObjectDefault) block.setAttribute('data-track-ui-object', uiObjectDefault);
  if (linkName === false) block.setAttribute('data-track-link-name', 'off');
  // Inner-slot trail segments (selector -> fixed string | (index, el) => string).
  // Authored data-tracking always wins.
  if (items) {
    Object.entries(items).forEach(([sel, label]) => {
      block.querySelectorAll(sel).forEach((el, i) => {
        if (el.hasAttribute('data-tracking')) return;
        const seg = typeof label === 'function' ? label(i, el) : label;
        if (seg) el.setAttribute('data-tracking', String(seg));
      });
    });
  }
  // alsoTrack: register non-CTA elements as their OWN beacon sources (#769) via
  // data-track-as=<ui_object>. Pure-derive; link_name dropped unless { linkName: true }.
  if (alsoTrack) {
    Object.entries(alsoTrack).forEach(([sel, val]) => {
      const as = typeof val === 'string' ? val : val && val.as;
      const keepLinkName = typeof val === 'object' && val.linkName === true;
      block.querySelectorAll(sel).forEach((el) => {
        if (!as || el.hasAttribute('data-track-as')) return;
        el.setAttribute('data-track-as', String(as));
        if (!keepLinkName) el.setAttribute('data-track-link-name', 'off');
      });
    });
  }
  return block;
}
