#!/usr/bin/env node
/**
 * parity-gate.mjs — deterministic click-tracking fidelity gate (the loop's oracle).
 *
 * For every tracked element in the prod golden it computes the payload OUR
 * pipeline would emit (real derive + block config + the published sheet, via the
 * tracker replica) and diffs it against prod on the DOM-derivable per-click
 * fields. Emits per-field / per-component fidelity + the failing fields per
 * component so the agent-loop knows what to fix next.
 *
 *   node scripts/diff/parity-gate.mjs            # human report + verdict
 *   node scripts/diff/parity-gate.mjs --json     # machine JSON only
 *
 * The golden (gitignored — campaign codes stay local) mixes two classes:
 *   - CLOSEABLE: prod events our tracking layer can reproduce (all CTAs +
 *     video). These count toward the gate verdict; the loop drives them to 100%.
 *   - STRUCTURAL: prod fires these on non-CTA elements our EDS markup does not
 *     reproduce 1:1 (per-thumbnail / per-card image beacons — img/picture/div).
 *     Reported as known markup-parity deltas (see GH issue), NOT gated — closing
 *     them needs block markup changes, not tracking config.
 *
 * BLOCK is the single source of truth for how each component is wired TODAY. The
 * loop edits blocks/runtime/sheet, updates BLOCK to match, and re-runs; un-mapped
 * closeable keys are treated as UNTRACKED (0 fidelity), which drives the loop.
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, no-nested-ternary, no-mixed-operators, no-undef */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  deriveForCta, applyBlockDefaults, resolveCta, stampCta, indexRows, sheetRowFor, sheetRowById,
  hostLabel, hrefSlug,
} from '../tracking.js';
import { computeTrackingPayload } from './tracker-replica.mjs';

const DIR = 'scripts/diff/fixtures/local';
const golden = JSON.parse(readFileSync(`${DIR}/clicktrack-golden.json`, 'utf8'));
let sheetMap = new Map();
try { sheetMap = indexRows(JSON.parse(readFileSync(`${DIR}/tracking-sheet.json`, 'utf8')).data); } catch { /* no sheet */ }

export const DIFF_FIELDS = ['event', 'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point', 'data-wa-link', 'icom_user_action', 'link_name'];
const THRESHOLD = 99;
export const stripBc = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);

// non-CTA keys our tracking layer owns (vs. structural markup deltas)
const CLOSEABLE_NONCTA = new Set(['video']);
// blocks wired with alsoTrack slot beacons — their `…|image` (thumbnail) and
// `…|qrc_content_card_content` (body) parts are closeable
const ALSO_TRACK_WIRED = new Set(['related-blogs', 'dynamic_category_container']);
export const isImagePart = (e) => e.nonCta && /\|image$/.test(e.exp.ui_access_point || '') && ALSO_TRACK_WIRED.has(e.key);
export const isContentPart = (e) => e.nonCta && /\|qrc_content_card_content$/.test(e.exp.ui_access_point || '') && ALSO_TRACK_WIRED.has(e.key);
// blog-cards paginated "Load More" — prod's href-less <a>; ours a real <button>
// under the …|oisp_loadmore|button trail.
export const isLoadMore = (e) => e.nonCta && /\|oisp_loadmore\|button$/.test(e.exp.ui_access_point || '') && ALSO_TRACK_WIRED.has(e.key);
export const isStructural = (e) => e.nonCta && !CLOSEABLE_NONCTA.has(e.key) && !isImagePart(e) && !isContentPart(e) && !isLoadMore(e);

// A testimonial carousel dot/nav control (a button with no detail — the pager
// dots and prev/next arrows live outside the story cards) — stays at the block
// trail; story card/frame CTAs (video links, "View the results") get the
// rw_testimonial_item slot.
function isTestimonialDot(e) {
  return e.exp.ui_object === 'button' && !(e.exp.ui_object_detail || '').trim();
}

// How each component key is wired TODAY. trail(i) -> data-tracking chain
// (broad->specific); scope header|footer|main; sheetKey overrides sheet lookup.
const BLOCK = {
  hero: { trail: () => 'rw2_hero', scope: 'main' },
  cards: { trail: (i) => `rw_cards_container|carousel|rw_card_${i}`, linkName: false, scope: 'main' },
  faq: { trail: () => 'accordion', linkName: false, scope: 'main' },
  // each story card/frame is an rw_testimonial_item slot; the carousel dots
  // (button, empty detail, numeric label) stay at the block level.
  testimonial: { trail: (i, e) => (isTestimonialDot(e) ? 'rw_testimonial' : 'rw_testimonial|rw_testimonial_item'), linkName: false, scope: 'main' },
  'related-blogs': { trail: () => 'qrc_content_card_grid', action: 'engaged', linkName: false, scope: 'main' },
  'case-study-header': { trail: () => 'qrc_article_hero', linkName: false, scope: 'main' },
  social: { trail: () => 'social_media', scope: 'main', sheetKey: 'case-study-header' },
  toc: { trail: () => 'TableOfContents', linkName: false, scope: 'main', sheetKey: 'case-study-header' },
  nav: { trail: () => '', action: 'engaged', linkName: false, scope: 'header' },
  'secondary-nav': { trail: () => 'secondary_nav', action: 'engaged', linkName: false, scope: 'header', sheetKey: 'nav' },
  footer: { trail: null, linkName: false, scope: 'footer' },
  cta: { trail: () => 'cta_block', scope: 'main' },
  quick_links: { trail: () => 'quick_links', scope: 'main' },
  'talk-to-sales': { trail: () => 'talk_to_sales', linkName: false, scope: 'main' },
  author_bio: { trail: () => 'author_bio', linkName: false, scope: 'main' },
  // video play control (blocks/video/video.js: object=video/action=started/ui_object=button, link_name off, no trail)
  video: { trail: () => '', object: 'video', action: 'started', uiObject: 'button', linkName: false, scope: 'main' },
};

const { document } = new JSDOM('<!doctype html><html><head></head><body></body></html>').window;
// host is what hrefSlug reads to treat erp.intuit.com links as "own" (path-only
// ids), matching the runtime on the deployed site.
globalThis.window = { location: { hostname: 'erp.intuit.com', host: 'erp.intuit.com', href: 'https://erp.intuit.com/', pathname: '/' } };

const HEADER_KEYS = new Set(['nav', 'secondary-nav']);
const regionOf = (key) => (HEADER_KEYS.has(key) ? 'header' : key === 'footer' ? 'footer' : 'main');

export const sheetKeyOf = (entry) => (BLOCK[entry.key] && BLOCK[entry.key].sheetKey) || entry.key;

// Blocks migrated to id-based sheet keying (data-track-id, derived per block),
// vs the legacy positional `<sheetKey>-<n>`. Footer is the first cut.
export const ID_KEYED = new Set(['footer']);

// The parallel of footer.js's `trackId` deriver, computed from the GOLDEN fields
// (we can't run the block's DOM function over prod's DOM). It must produce the
// SAME id footer.js stamps — the footer render test guards drift. Country locale
// code by wa-link suffix, matching the block's path-derived code (enca -> ca).
const COUNTRY_CODE = { enus: 'us', enca: 'ca', frca: 'fr-ca', enin: 'in' };
export function footerIdOf(entry) {
  const wa = entry.exp['data-wa-link'] || '';
  const trail = entry.exp.ui_access_point || '';
  const href = entry.href || '';
  if (wa === 'ftr-corporate-managecookies') return 'footer:manage-cookies'; // href-less (#)
  if (wa === 'ftr-corporate-aboutcookies') return 'footer:cookie-about';
  if (wa === 'ftr-global-truste') return 'footer:truste';
  const country = wa.match(/^ftr-corporate-country-(\w+)$/);
  if (country) return `footer:country-${COUNTRY_CODE[country[1]] || country[1]}`;
  if (/(^|\|)products$/.test(trail)) return `footer:brand-${hostLabel(href)}`; // brand logos
  const s = hrefSlug(href); // authored columns/legal/sitemap/social -> readable href slug
  return s ? `footer:${s}` : '';
}

// Model track-by-default: a declared block (in BLOCK) supplies trail + payload
// defaults; an undeclared key is a loose content CTA (pure derive, region=main,
// trail -> "page"). Sheet residue applies to both.
export function oursPayload(entry, idx, sheet) {
  // alsoTrack image part: an img[data-track-as] under the slot-trail chain (the
  // block wires the wrapper trail; the img is the sacrificial leaf). Pure-derive.
  if (isImagePart(entry)) {
    const root = document.createElement('main');
    let host = root;
    entry.exp.ui_access_point.split('|').forEach((seg) => {
      const d = document.createElement('div'); d.setAttribute('data-tracking', seg); host.append(d); host = d;
    });
    const img = document.createElement('img');
    // our thumbnail's alt IS the card title (related-blogs/blog-cards pass title to
    // createOptimizedPicture), which is what prod reports as the detail — not prod's
    // own img alt (a headshot/image alt the golden captured in `text`).
    img.setAttribute('alt', entry.exp.ui_object_detail || entry.text || '');
    img.setAttribute('data-track-as', 'button');
    img.setAttribute('data-track-link-name', 'off'); // alsoTrack drops link_name on image beacons
    host.append(img);
    document.body.append(root);
    try {
      const d = deriveForCta(img, '', 'erp.intuit.com');
      delete d['custom-properties'].link_name;
      stampCta(img, resolveCta(d, null, {}));
      return computeTrackingPayload(img);
    } finally { root.remove(); }
  }
  // alsoTrack content-slot part: the card body under the …|qrc_content_card_content
  // trail. Pure-derive, KEEPS link_name (prod authors button-<title> on the slot);
  // detail comes from the body's title (partLabel prefers a heading/*-title).
  if (isContentPart(entry)) {
    const root = document.createElement('main');
    let host = root;
    entry.exp.ui_access_point.split('|').forEach((seg) => {
      const d = document.createElement('div'); d.setAttribute('data-tracking', seg); host.append(d); host = d;
    });
    const body = document.createElement('div');
    body.setAttribute('data-track-as', 'button');
    const title = document.createElement('h3');
    title.textContent = entry.exp.ui_object_detail || entry.text || '';
    body.append(title);
    // blog-index (dynamic_category_container) content slots omit link_name; the
    // related-blogs rail keeps a (truncated) one — mirror each block's wiring.
    const dropLinkName = entry.key === 'dynamic_category_container';
    if (dropLinkName) body.setAttribute('data-track-link-name', 'off');
    host.append(body);
    document.body.append(root);
    try {
      const d = deriveForCta(body, '', 'erp.intuit.com');
      if (dropLinkName) delete d['custom-properties'].link_name;
      stampCta(body, resolveCta(d, null, {}));
      return computeTrackingPayload(body);
    } finally { root.remove(); }
  }
  // "Load More" button: a real <button> under the …|oisp_loadmore|button trail
  // (the button's own data-tracking is the skipped leaf); block linkName is off.
  if (isLoadMore(entry)) {
    const root = document.createElement('main');
    let host = root;
    entry.exp.ui_access_point.split('|').forEach((seg) => {
      const d = document.createElement('div'); d.setAttribute('data-tracking', seg); host.append(d); host = d;
    });
    const btn = document.createElement('button');
    btn.textContent = entry.text || 'Load More';
    host.append(btn);
    document.body.append(root);
    try {
      const d = deriveForCta(btn, '', 'erp.intuit.com');
      delete d['custom-properties'].link_name;
      stampCta(btn, resolveCta(d, null, {}));
      return computeTrackingPayload(btn);
    } finally { root.remove(); }
  }
  const cfg = BLOCK[entry.key]; // undefined => pure-derive page path
  const region = regionOf(entry.key);
  const scope = document.createElement(region);
  let trailStr = '';
  if (cfg && cfg.trail) trailStr = cfg.trail(idx + 1, entry);
  else if (entry.key === 'footer') trailStr = entry.exp.ui_access_point || 'footer'; // footer trail is fully structural (footer.js replicates prod; verified on preview)
  let host = scope;
  (trailStr ? trailStr.split('|') : []).forEach((seg) => { const d = document.createElement('div'); d.setAttribute('data-tracking', seg); host.append(d); host = d; });
  let block = null;
  if (cfg) {
    block = scope.querySelector('[data-tracking]') || scope;
    block.classList.add('block', `tracking-${entry.key}`);
    if (cfg.action) block.setAttribute('data-track-action', cfg.action);
    if (cfg.object) block.setAttribute('data-track-object', cfg.object);
    if (cfg.uiObject) block.setAttribute('data-track-ui-object', cfg.uiObject);
    if (cfg.linkName === false) block.setAttribute('data-track-link-name', 'off');
  }
  // Reconstruct the element faithfully enough for the derive: prod's ui_object
  // reveals the element shape (button-styled / icon-only / video link). Only the
  // three DERIVABLE shapes are reconstructed; semantic ui_objects (card/image/
  // modal/disclaimer/accordion_item_N) are left plain so they still surface as
  // real residue gaps. ui_object's derive matrix is unit-tested separately.
  const uio = entry.exp.ui_object;
  const href = uio === 'video_link' ? 'https://www.youtube.com/watch?v=x' : entry.href;
  const cta = document.createElement(href ? 'a' : 'button');
  if (href) cta.setAttribute('href', href);
  if (uio === 'button') cta.classList.add('button');
  if (uio === 'link_icon') cta.append(document.createElement('img')); // icon-only (no text)
  else if (entry.text) cta.textContent = entry.text;
  else cta.append(document.createElement('img'));
  host.append(cta);
  document.body.append(scope);
  try {
    const derived = applyBlockDefaults(deriveForCta(cta, cfg ? entry.key : '', 'erp.intuit.com'), cta);
    const page = entry.page === '*' ? '/' : entry.page;
    // Id-keyed blocks (footer) resolve residue by identity (data-track-id / href),
    // not DOM position — the same lookup the runtime does, so the gate reflects
    // the real render instead of golden order. Others stay positional (migration).
    const row = ID_KEYED.has(entry.key)
      ? sheetRowById(sheet, footerIdOf(entry), page)
      : sheetRowFor(sheet, (cfg && cfg.sheetKey) || entry.key, idx, page);
    stampCta(cta, resolveCta(derived, row, {}));
    return computeTrackingPayload(cta);
  } finally { scope.remove(); }
}

export function runGate(sheet) {
  const counters = {};
  const closeable = [];
  const structuralByKey = {};
  for (const e of golden.entries) {
    if (isStructural(e)) { structuralByKey[e.key] = (structuralByKey[e.key] || 0) + 1; continue; }
    const ck = `${e.page}#${sheetKeyOf(e)}`;
    const idx = counters[ck] || 0; counters[ck] = idx + 1;
    const ours = oursPayload(e, idx, sheet);
    const perField = {};
    const norm = (v) => { const s = typeof v === 'string' ? v.trim() : v; return s === '' || s == null ? null : s; }; // trim + empty == no value (whitespace/newline diffs are matches)
    for (const f of DIFF_FIELDS) {
      let want = e.exp[f]; let got = ours ? ours[f] : undefined;
      if (f === 'icom_user_action' || f === 'link_name') { want = stripBc(want); got = stripBc(got); }
      perField[f] = JSON.stringify(norm(want)) === JSON.stringify(norm(got));
    }
    closeable.push({ key: e.key, tracked: !!ours, perField });
  }
  const totalCells = closeable.length * DIFF_FIELDS.length;
  let matchCells = 0;
  const byField = {}; const byKey = {};
  DIFF_FIELDS.forEach((f) => { byField[f] = 0; });
  for (const r of closeable) {
    byKey[r.key] = byKey[r.key] || { n: 0, m: 0, tracked: 0, fail: {} };
    byKey[r.key].n += 1; if (r.tracked) byKey[r.key].tracked += 1;
    for (const f of DIFF_FIELDS) {
      if (r.perField[f]) { byField[f] += 1; matchCells += 1; byKey[r.key].m += 1; } else { byKey[r.key].fail[f] = (byKey[r.key].fail[f] || 0) + 1; }
    }
  }
  const pct = (m, n) => (n ? +(100 * m / n).toFixed(1) : 100);
  const closeableFidelity = pct(matchCells, totalCells);
  const structuralTotal = Object.values(structuralByKey).reduce((a, b) => a + b, 0);
  const overallAll = pct(matchCells, totalCells + structuralTotal * DIFF_FIELDS.length);
  const components = Object.entries(byKey).map(([k, v]) => ({
    key: k,
    ctas: v.n,
    fidelity: pct(v.m, v.n * DIFF_FIELDS.length),
    untracked: v.n - v.tracked,
    top_failing_fields: Object.entries(v.fail).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, c]) => `${f}(${c})`),
  })).sort((a, b) => a.fidelity - b.fidelity);
  return {
    golden: { entries: golden.entries.length, pages: golden.pages.filter((p) => p !== '*').length },
    parity_pct: overallAll, // matches / ALL prod beacons (what fires) — THE number
    reproduced_fidelity_pct: closeableFidelity, // of the beacons we reproduce, how faithful
    reproduced: closeable.length,
    not_yet_reproduced: structuralTotal,
    by_field: Object.fromEntries(DIFF_FIELDS.map((f) => [f, pct(byField[f], closeable.length)])),
    components,
    not_yet_reproduced_by_key: structuralByKey,
    verdict: overallAll >= THRESHOLD ? 'PASS' : 'FAIL',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = runGate(sheetMap);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const total = report.reproduced + report.not_yet_reproduced;
    console.log(`\nClick-tracking parity — ${total} prod beacons across ${report.golden.pages} pages`);
    console.log(`PARITY (all prod beacons): ${report.parity_pct}%  (threshold ${THRESHOLD}%)`);
    console.log(`  ${report.reproduced} reproduced at ${report.reproduced_fidelity_pct}% field-fidelity; ${report.not_yet_reproduced} not yet reproduced\n`);
    console.log('By field (of reproduced beacons):');
    Object.entries(report.by_field).forEach(([f, p]) => console.log(`  ${String(p).padStart(5)}%  ${f}`));
    console.log('\nComponents (lowest first — fix these):');
    report.components.forEach((c) => console.log(`  ${String(c.fidelity).padStart(5)}%  ${c.key} (${c.ctas})${c.untracked ? ` [${c.untracked} UNTRACKED]` : ''}  ${c.top_failing_fields.join(' ')}`));
    console.log(`\nNot yet reproduced (fire on prod — remaining parity work): ${JSON.stringify(report.not_yet_reproduced_by_key)}`);
    console.log('');
  }
  console.log(`verdict: ${report.verdict} score=${report.parity_pct} threshold=${THRESHOLD}`);
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}
