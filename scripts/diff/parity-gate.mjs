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
import { JSDOM } from 'jsdom';
import {
  deriveForCta, applyBlockDefaults, resolveCta, stampCta, indexRows, sheetRowFor,
} from '../tracking.js';
import { computeTrackingPayload } from './tracker-replica.mjs';

const DIR = 'scripts/diff/fixtures/local';
const golden = JSON.parse(readFileSync(`${DIR}/clicktrack-golden.json`, 'utf8'));
let sheetMap = new Map();
try { sheetMap = indexRows(JSON.parse(readFileSync(`${DIR}/tracking-sheet.json`, 'utf8')).data); } catch { /* no sheet */ }

const DIFF_FIELDS = ['event', 'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point', 'data-wa-link', 'icom_user_action', 'link_name'];
const THRESHOLD = 99;
const stripBc = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);

// non-CTA keys our tracking layer owns (vs. structural markup deltas)
const CLOSEABLE_NONCTA = new Set(['video']);
const isStructural = (e) => e.nonCta && !CLOSEABLE_NONCTA.has(e.key);

// How each component key is wired TODAY. trail(i) -> data-tracking chain
// (broad->specific); scope header|footer|main; sheetKey overrides sheet lookup.
const BLOCK = {
  hero: { trail: () => 'rw2_hero', scope: 'main' },
  cards: { trail: (i) => `rw_cards_container|carousel|rw_card_${i}`, scope: 'main' },
  faq: { trail: () => 'accordion', scope: 'main' },
  testimonial: { trail: () => 'rw_testimonial', linkName: false, scope: 'main' },
  'related-blogs': { trail: () => 'qrc_content_card_grid', action: 'engaged', linkName: false, scope: 'main' },
  'case-study-header': { trail: () => 'qrc_article_hero', linkName: false, scope: 'main' },
  social: { trail: () => 'social_media', linkName: false, scope: 'main', sheetKey: 'case-study-header' },
  toc: { trail: () => 'TableOfContents', linkName: false, scope: 'main', sheetKey: 'case-study-header' },
  nav: { trail: () => '', action: 'engaged', linkName: false, scope: 'header' },
  'secondary-nav': { trail: () => 'secondary_nav', action: 'engaged', linkName: false, scope: 'header', sheetKey: 'nav' },
  footer: { trail: null, linkName: false, scope: 'footer' },
  // video play control (blocks/video/video.js: object=video/action=started/ui_object=button, link_name off, no trail)
  video: { trail: () => '', object: 'video', action: 'started', uiObject: 'button', linkName: false, scope: 'main' },
};
const FOOTER_TRAILS = new Set(['footer|products', 'footer|footer_bottom', 'footer|footer_sitemap', 'page']);

const { document } = new JSDOM('<!doctype html><html><head></head><body></body></html>').window;
globalThis.window = { location: { hostname: 'erp.intuit.com', pathname: '/' } };

const HEADER_KEYS = new Set(['nav', 'secondary-nav']);
const regionOf = (key) => (HEADER_KEYS.has(key) ? 'header' : key === 'footer' ? 'footer' : 'main');

// Model track-by-default: a declared block (in BLOCK) supplies trail + payload
// defaults; an undeclared key is a loose content CTA (pure derive, region=main,
// trail -> "page"). Sheet residue applies to both.
function oursPayload(entry, idx) {
  const cfg = BLOCK[entry.key]; // undefined => pure-derive page path
  const region = regionOf(entry.key);
  const scope = document.createElement(region);
  let trailStr = '';
  if (cfg && cfg.trail) trailStr = cfg.trail(idx + 1);
  else if (entry.key === 'footer') trailStr = FOOTER_TRAILS.has(entry.exp.ui_access_point) ? entry.exp.ui_access_point : 'footer';
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
  const cta = document.createElement(entry.href ? 'a' : 'button');
  if (entry.href) cta.setAttribute('href', entry.href);
  if (entry.text) cta.textContent = entry.text; else cta.append(document.createElement('img'));
  host.append(cta);
  document.body.append(scope);
  try {
    const derived = applyBlockDefaults(deriveForCta(cta, cfg ? entry.key : '', 'erp.intuit.com'), block);
    const row = sheetRowFor(sheetMap, (cfg && cfg.sheetKey) || entry.key, idx, entry.page === '*' ? '/' : entry.page);
    stampCta(cta, resolveCta(derived, row, {}));
    return computeTrackingPayload(cta);
  } finally { scope.remove(); }
}

const counters = {};
const closeable = [];
const structuralByKey = {};
for (const e of golden.entries) {
  if (isStructural(e)) { structuralByKey[e.key] = (structuralByKey[e.key] || 0) + 1; continue; }
  const sk = (BLOCK[e.key] && BLOCK[e.key].sheetKey) || e.key;
  const ck = `${e.page}#${sk}`;
  const idx = counters[ck] || 0; counters[ck] = idx + 1;
  const ours = oursPayload(e, idx);
  const perField = {};
  for (const f of DIFF_FIELDS) {
    let want = e.exp[f]; let got = ours ? ours[f] : undefined;
    if (f === 'icom_user_action' || f === 'link_name') { want = stripBc(want); got = stripBc(got); }
    perField[f] = JSON.stringify(want ?? null) === JSON.stringify(got ?? null);
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
// honest overall: structural entries score 0 (untracked in our layer)
const overallAll = pct(matchCells, totalCells + structuralTotal * DIFF_FIELDS.length);

const components = Object.entries(byKey).map(([k, v]) => ({
  key: k,
  ctas: v.n,
  fidelity: pct(v.m, v.n * DIFF_FIELDS.length),
  untracked: v.n - v.tracked,
  top_failing_fields: Object.entries(v.fail).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, c]) => `${f}(${c})`),
})).sort((a, b) => a.fidelity - b.fidelity);

const report = {
  golden: { entries: golden.entries.length, closeable: closeable.length, structural: structuralTotal, pages: golden.pages.filter((p) => p !== '*').length },
  closeable_fidelity_pct: closeableFidelity,
  overall_incl_structural_pct: overallAll,
  by_field: Object.fromEntries(DIFF_FIELDS.map((f) => [f, pct(byField[f], closeable.length)])),
  components,
  structural_deltas: structuralByKey,
  verdict: closeableFidelity >= THRESHOLD ? 'PASS' : 'FAIL',
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nClick-tracking parity gate — ${closeable.length} closeable events (+${structuralTotal} structural) across ${report.golden.pages} pages`);
  console.log(`CLOSEABLE FIDELITY: ${closeableFidelity}%  (threshold ${THRESHOLD}%)   overall incl. structural: ${overallAll}%\n`);
  console.log('By field (closeable):');
  Object.entries(report.by_field).forEach(([f, p]) => console.log(`  ${String(p).padStart(5)}%  ${f}`));
  console.log('\nComponents (lowest first — fix these):');
  components.forEach((c) => console.log(`  ${String(c.fidelity).padStart(5)}%  ${c.key} (${c.ctas})${c.untracked ? ` [${c.untracked} UNTRACKED]` : ''}  ${c.top_failing_fields.join(' ')}`));
  console.log(`\nStructural deltas (markup-parity, not gated): ${JSON.stringify(structuralByKey)}`);
  console.log('');
}
console.log(`verdict: ${report.verdict} score=${closeableFidelity} threshold=${THRESHOLD}`);
process.exit(closeableFidelity >= THRESHOLD ? 0 : 1);
