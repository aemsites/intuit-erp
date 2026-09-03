/**
 * JIT click-tracking attributes for CTAs in content regions and declared blocks.
 * Blocks configure ids, trails, and defaults with trackAs(); data-track-skip opts out.
 * See CLICK-TRACKING.md for the DOM contract and authoring model.
 */

import { isVideoLink } from '../blocks/video/video-info.js';

export const PREFIX = 'tracking-';

// Derive values shared by the browser runtime and parity tools.

const UI_ACTION = 'clicked';
const ACTION = 'interacted';
const VIDEO_ACTION = 'engaged';
const DEFAULT_OBJECT = 'content';

/** Slugify a visible label for ids and `link_name`. */
export function slug(label) {
  return (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derive `ui_object` from an element type and presentation. */
export function uiObject(tagName, isButtonStyled) {
  if (tagName === 'BUTTON') return 'button';
  if (tagName === 'A') return isButtonStyled ? 'button' : 'link';
  return 'button';
}

/** Build a block's default access-point segment. */
export function blockAccessPoint(blockName) {
  if (!blockName) return '';
  return `${blockName.replace(/-/g, '_')}_block`;
}

/**
 * Derive a CTA's baseline payload.
 * @param {{tagName: string, label: string, blockName: string,
 *   isButtonStyled?: boolean, isVideo?: boolean, isIcon?: boolean, host?: string}} ctx
 * @returns {Record<string, unknown>}
 */
export function deriveBaseline({
  tagName, label, blockName, isButtonStyled = true, isVideo = false, isIcon = false, host = '', kind: kindOverride,
}) {
  let kind = uiObject(tagName, isButtonStyled);
  if (isVideo) kind = 'video_link';
  else if (isIcon) kind = 'link_icon';
  if (kindOverride) kind = kindOverride;
  const detail = (label || '').trim();
  const custom = {};
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

// Sparse authored residue from /tracking.json.

const SHEET_URL = '/tracking.json';

const SCALAR_COLUMNS = [
  'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
  'ui-action', 'access-point', 'ui-access-point', 'wa-link',
];

/** Parse newline- or semicolon-separated `k=v` pairs. */
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

/** Normalize a sheet row, dropping blank residue. */
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

/** Normalize a path for sheet lookup. */
export function normalizePath(p) {
  const path = (p || '/').split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

/** Canonicalize a navigational HTTP(S) href for id derivation. */
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

// Site-specific hosts stripped from ids; the canonical host keeps relative ids deploy-independent.
const CANONICAL_HOST = 'erp.intuit.com';
const OWN_HOSTS = new Set([CANONICAL_HOST, 'intuit.com', 'www.intuit.com']);

/** Return a short host label for a tracking id. */
export function hostLabel(href) {
  const norm = normalizeHref(href);
  if (!norm) return '';
  const host = new URL(norm).host.replace(/^www\./, '');
  if (host === 'intuit.com') return 'intuit';
  if (host.endsWith('.intuit.com')) return host.slice(0, host.indexOf('.'));
  const labels = host.split('.');
  return labels.length > 2 ? labels[labels.length - 2] : labels[0];
}

/** Derive a stable, readable id slug from an href. */
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
  // Relative root links use the canonical label on non-canonical deployment hosts.
  return OWN_HOSTS.has(url.host) ? hostLabel(norm) : hostLabel(`https://${CANONICAL_HOST}`);
}

/** Derive the default `<namespace>:<href-slug>` id. */
export function hrefTrackId(el, key) {
  const s = hrefSlug(el && el.getAttribute ? el.getAttribute('href') : el);
  return s ? `${key}:${s}` : null;
}

/** Index sheet rows by `[path|]id`; the last duplicate wins. */
export function indexRows(data) {
  const byKey = new Map();
  (data || []).forEach((row) => {
    const key = (row.id ?? row.key ?? '').toString().trim();
    if (!key) return;
    const cfg = normalizeRow(row);
    if (!Object.keys(cfg).length) return;
    const p = (row.path ?? '').toString().trim();
    const composite = (p && p !== '*') ? `${normalizePath(p)}|${key}` : key;
    byKey.set(composite, cfg);
  });
  return byKey;
}

let sheetPromise;
let sheetMap = null;

/** Fetch and cache the tracking sheet; failures resolve to an empty map. */
export function fetchTrackingSheet() {
  if (!sheetPromise) {
    sheetPromise = fetch(SHEET_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => indexRows(json?.data))
      .catch(() => new Map());
  }
  return sheetPromise;
}

const PAYLOAD_DERIVERS = new WeakMap();

/** Reset cached sheet state for tests. */
export function resetTrackingState() {
  sheetPromise = undefined;
  sheetMap = null;
}

// Resolve derived values, block defaults, sheet residue, and region context.

/** Assemble tracker custom properties, dropping values that contain its delimiters. */
export function assembleCustomProperties(map) {
  return Object.entries(map || {})
    .filter(([k, v]) => k && v != null && v !== ''
      && !/[|,]/.test(k) && !/[|,]/.test(String(v)))
    .map(([k, v]) => `${k}|${v}`)
    .join(',');
}

/** Merge custom-property maps; later sources win. */
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

  // `data-tracking` is the sacrificial leaf; attribute presence opts into the trail.
  if (derived.anchor != null) attrs['data-tracking'] = derived.anchor;
  attrs['data-ui-access-point'] = cfg['ui-access-point'] ?? '';

  const cp = mergeCustomProperties(context.customProperties, derived['custom-properties'], cfg['custom-properties']);
  const cpStr = assembleCustomProperties(cp);

  attrs['data-object'] = cfg.object ?? derived.object;
  if (cfg['object-detail'] != null) attrs['data-object-detail'] = cfg['object-detail'];
  attrs['data-action'] = cfg.action ?? derived.action;
  attrs['data-ui-object'] = cfg['ui-object'] ?? derived['ui-object'];
  attrs['data-ui-object-detail'] = cfg['ui-object-detail'] ?? derived['ui-object-detail'];
  attrs['data-ui-action'] = cfg['ui-action'] ?? derived['ui-action'];
  if (waLink) attrs['data-wa-link'] = waLink;
  if (cpStr) attrs['data-custom-properties'] = cpStr;

  Object.entries(cfg.survey || {}).forEach(([k, v]) => {
    const name = k.startsWith('survey-') ? k : `survey-${k}`;
    attrs[`data-${name}`] = v;
  });

  return attrs;
}

// Stamp managed attributes onto the DOM.

const MANAGED = [
  'data-object', 'data-object-detail', 'data-action', 'data-ui-object',
  'data-ui-object-detail', 'data-ui-action', 'data-ui-access-point',
  'data-tracking', 'data-wa-link', 'data-custom-properties',
];

/** Stamp resolved attributes, removing managed values that no longer apply. */
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

/** Stamp a non-empty trail segment. */
export function stampTracking(el, value) {
  if (el && value) el.setAttribute('data-tracking', value);
}

// Runtime orchestration.

/** Read a block's `tracking-<key>` class. */
export function trackingKey(block) {
  const cls = [...block.classList].find((c) => c.startsWith(PREFIX) && c.length > PREFIX.length);
  return cls ? cls.slice(PREFIX.length) : null;
}

/** Read a CTA's stable sheet id. */
export function trackIdOf(el) {
  return (el && el.getAttribute && el.getAttribute('data-track-id')) || null;
}

/** Read a block name from its dataset or first non-structural class. */
export function blockNameOf(block) {
  if (block.dataset && block.dataset.blockName) return block.dataset.blockName;
  return [...block.classList].find((c) => c !== 'block' && !c.startsWith(PREFIX)) || '';
}

export const CTA_SELECTOR = 'a[href], button, summary, [role="button"]';

export const TRACKED_REGIONS = 'main, header, footer';

export const PAGE_KEY = 'page';

/** Return a block's CTAs in DOM order. */
export function ctasIn(block) {
  return [...block.querySelectorAll(CTA_SELECTOR)];
}

/**
 * Apply defaults from the CTA's nearest configured ancestor.
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

/** Look up page-scoped residue before a global row with the same id. */
export function sheetRowById(map, id, path) {
  if (!map || !id) return null;
  const pp = normalizePath(path);
  const candidates = [`${pp}|${id}`, id];
  for (let c = 0; c < candidates.length; c += 1) {
    if (map.has(candidates[c])) return map.get(candidates[c]);
  }
  return null;
}

/** Read visible text, image alt text, or aria-label as the CTA label. */
export function labelFor(el) {
  const text = (el.textContent || '').trim();
  if (text) return text;
  const img = el.matches && el.matches('img[alt]') ? el : el.querySelector('img[alt]');
  const alt = img && (img.getAttribute('alt') || '').trim();
  if (alt) return alt;
  return (el.getAttribute('aria-label') || '').trim();
}

/** Prefer a heading/title when labeling an `alsoTrack` part. */
export function partLabel(el) {
  const title = el.querySelector && el.querySelector('h1, h2, h3, h4, h5, h6, [class$="-title"]');
  const t = title && (title.textContent || '').trim();
  return t || labelFor(el);
}

/** Derive a live element's baseline, including video and icon classifications. */
export function deriveForCta(el, blockName, host = '') {
  const partKind = el.getAttribute && el.getAttribute('data-track-as');
  const isVideo = !partKind && el.tagName === 'A' && isVideoLink(el.getAttribute('href'));
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

/** Stamp page and block trail segments without replacing authored values. */
export function stampTrail(scope = document) {
  const root = scope.querySelectorAll ? scope : document;
  const main = document.querySelector('main');
  const pageSeg = (document.head?.querySelector('meta[name="tracking"]')?.content || '').trim();
  if (main && pageSeg && !main.hasAttribute('data-tracking')) main.setAttribute('data-tracking', pageSeg);

  optedInBlocks(root).forEach((block) => {
    if (block.hasAttribute('data-tracking') || block.hasAttribute('data-track-no-trail')) return;
    const seg = blockNameOf(block);
    if (seg) block.setAttribute('data-tracking', seg);
  });
}

/** Resolve a trackable CTA/part and its declared block. */
export function resolveTrackable(target) {
  if (!target || !target.closest) return null;
  const el = target.closest(`[data-track-as], ${CTA_SELECTOR}`);
  if (!el || el.closest('[data-track-skip]')) return null;
  const blk = el.closest(`[class*="${PREFIX}"]`);
  const block = (blk && trackingKey(blk)) ? blk : null;
  if (el.hasAttribute('data-track-as')) return block ? { cta: el, block } : null;
  if (!el.closest(TRACKED_REGIONS) && !block) return null;
  return { cta: el, block };
}

// Optional pzn/ixp region context published through window.__pznTrackingContext.

/** Return the nearest registered experience region, excluding `body`. */
export function resolveRegionContext(fromEl) {
  // eslint-disable-next-line no-underscore-dangle -- integration contract
  const registry = typeof window !== 'undefined' ? window.__pznTrackingContext : null;
  if (!registry) return null;
  for (let node = fromEl; node && node !== document.body; node = node.parentElement) {
    if (registry.has(node)) return registry.get(node);
  }
  return null;
}

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

/** Map known region identity fields to namespaced custom properties. */
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

/** JIT-stamp the interacted target before the injected tracker handles the click. */
export function stampInteraction(e) {
  const hit = resolveTrackable(e.target);
  if (!hit) return;
  const { cta, block } = hit;
  const loc = (typeof window !== 'undefined' && window.location) || {};
  const host = loc.hostname || '';
  const isPart = cta.hasAttribute('data-track-as');
  const blockName = block ? blockNameOf(block) : '';
  let row = null;
  if (!isPart) {
    let id = trackIdOf(cta);
    if (!id && !block) id = hrefTrackId(cta, PAGE_KEY) || (labelFor(cta) ? `${PAGE_KEY}:${slug(labelFor(cta))}` : null);
    if (id) {
      row = sheetRowById(sheetMap, id, loc.pathname);
      // Retry label identity when production represented the same CTA as a button.
      if (!row) {
        const label = labelFor(cta);
        const sep = id.indexOf(':');
        const ns = sep > 0 ? id.slice(0, sep) : '';
        if (ns && label) {
          const labelId = `${ns}:${slug(label)}`;
          if (labelId !== id) row = sheetRowById(sheetMap, labelId, loc.pathname);
        }
      }
    }
  }
  let derived = deriveForCta(cta, blockName, host);
  if (isPart) {
    if (cta.getAttribute('data-track-link-name') === 'off' && derived['custom-properties']) {
      delete derived['custom-properties'].link_name;
    }
  } else {
    derived = applyBlockDefaults(derived, cta);
  }
  if (block && !isPart) {
    const derivePayload = PAYLOAD_DERIVERS.get(block);
    if (derivePayload) { const ov = derivePayload(cta); if (ov) row = { ...ov, ...(row || {}) }; }
  }
  const regionCtx = resolveRegionContext(cta);
  const context = regionCtx ? { customProperties: regionCustomProperties(regionCtx) } : {};
  stampCta(cta, resolveCta(derived, row, context));
}

/** Initialize trails, sheet caching, and capture handlers. */
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
 * Declare a block's tracking ids, trails, defaults, parts, and opt-outs.
 * @param {string|null} name trail segment (data-tracking); falsy = opt in, no trail
 * @param {Element} block
 * @param {object} [opts]
 * @param {string} [opts.key] tracking-<key> opt-in + id namespace (defaults to name)
 * @param {(el: Element) => (string|null)} [opts.trackId] per-CTA id deriver
 * @param {Record<string, string|((i:number, el:Element)=>string)>} [opts.items]
 *   selector -> inner trail segment
 * @param {Record<string, string|{as:string, linkName?:boolean}>} [opts.alsoTrack]
 *   selector -> ui_object for non-CTA sources
 * @param {(el: Element) => (Record<string, unknown>|null)} [opts.payload] per-CTA JIT
 *   partial sheet-shaped defaults
 * @param {string} [opts.action]
 * @param {string} [opts.object]
 * @param {string} [opts.uiObject] code-built payload defaults
 * @param {boolean} [opts.linkName] false drops the derived link_name
 * @param {string} [opts.skip] selector for pure-UI controls to exclude
 * @returns {Element} block
 */
export function trackAs(name, block, {
  key = name, items, trackId, alsoTrack, action, object,
  uiObject: uiObjectDefault, linkName, skip, payload,
} = {}) {
  if (!block) return block;
  if (payload) PAYLOAD_DERIVERS.set(block, payload);
  if (skip) block.querySelectorAll(skip).forEach((el) => el.setAttribute('data-track-skip', ''));
  // Default ids are content-derived and deduplicated; custom derivation owns its collisions.
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
  const optKey = key || name;
  if (optKey && !trackingKey(block)) block.classList.add(`${PREFIX}${optKey}`);
  if (name && !block.hasAttribute('data-tracking')) block.setAttribute('data-tracking', name);
  else if (!name && !block.hasAttribute('data-tracking')) block.setAttribute('data-track-no-trail', '');
  if (object) block.setAttribute('data-track-object', object);
  if (action) block.setAttribute('data-track-action', action);
  if (uiObjectDefault) block.setAttribute('data-track-ui-object', uiObjectDefault);
  if (linkName === false) block.setAttribute('data-track-link-name', 'off');
  if (items) {
    Object.entries(items).forEach(([sel, label]) => {
      block.querySelectorAll(sel).forEach((el, i) => {
        if (el.hasAttribute('data-tracking')) return;
        const seg = typeof label === 'function' ? label(i, el) : label;
        if (seg) el.setAttribute('data-tracking', String(seg));
      });
    });
  }
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
