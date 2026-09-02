#!/usr/bin/env node
/**
 * coverage-matrix.mjs — emit a readable golden + coverage matrix as
 * CLICK-TRACKING-COVERAGE.md: per prod component, how many events the golden
 * captured, which fields prod populates, and where our runtime matches vs gaps.
 *
 * Counts only — NO campaign-code values — so it is safe to commit/share as the
 * shared understanding between the customer and the implementation team.
 *
 *   node scripts/diff/coverage-matrix.mjs
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, object-property-newline, no-mixed-operators */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  oursPayload, sheetKeyOf, isStructural, stripBc, DIFF_FIELDS, assignIds,
} from './parity-gate.mjs';
import { indexRows } from '../tracking.js';

const DIR = 'scripts/diff/fixtures/local';
// --golden/--sheet/--out select the source golden (default: our reverse-engineered one;
// pass clicktrack-golden-customer.json + its sheet for the customer coverage matrix).
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const GOLDEN_PATH = argOf('--golden') || `${DIR}/clicktrack-golden.json`;
const SHEET_PATH = argOf('--sheet') || `${DIR}/tracking-sheet.json`;
const OUT_PATH = argOf('--out') || 'CLICK-TRACKING-COVERAGE.md';
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
assignIds(golden.entries); // assign each entry its id-based key (oursPayload resolves by it)
let sheet = new Map();
try { sheet = indexRows(JSON.parse(readFileSync(SHEET_PATH, 'utf8')).data); } catch { /* no sheet — derive-only coverage */ }
const norm = (v) => { const s = typeof v === 'string' ? v.trim() : v; return s === '' || s == null ? null : s; };

// short column headers for the 11 diff fields
const ABBR = {
  event: 'event', object: 'object', object_detail: 'obj_det', action: 'action',
  ui_object: 'ui_obj', ui_object_detail: 'ui_od', ui_action: 'ui_act',
  ui_access_point: 'ui_ap', 'data-wa-link': 'wa', icom_user_action: 'icom', link_name: 'link_nm',
};

// per-component classification of the residual gap (A markup / B prod / C ours / — none)
const CLASS = {
  video: ['B', 'inconsistent prod trails for the same play control'],
  'secondary-nav': ['A', 'flyout buttons vs prod link-based 3-level nav'],
  disclaimer: ['A+B', 'tracked entry is the <summary> toggle (A); link_name over-production (B)'],
  'case-study-header': ['B', 'golden double-keys the share-row trail'],
  testimonial: ['B', 'ui_object_detail dots emit ""; trail varies by template'],
  toc: ['B', 'prod ui_object_detail=""; we emit the heading (superset)'],
  page: ['B', 'link_name inconsistently omitted by prod (we emit it — superset)'],
  button: ['B+C', 'link_name over-production (B); generic-button trail (C)'],
  faq: ['C', 'answer-body links inside .faq-answer resolve to page on prod'],
  cards: ['C', 'grid vs carousel trail variant'],
  link: ['B', 'prod emits no ui_access_point/link_name (we emit — superset)'],
  image: ['B', 'prod emits no ui_access_point (we emit page — superset)'],
  product_banner: ['A', 'no product-banner block in our port'],
  'related-blogs': ['A', 'per-card nested video; single-anchor cards (#769)'],
  dynamic_category_container: ['A', 'per-thumbnail card tracking (#769)'],
  video_link: ['B', 'link_name over-production'],
  feature: ['B', 'video trail'],
  cta: ['B', 'link_name over-production'],
};

// aggregate per component
const counters = {};
const comp = {};
for (const e of golden.entries) {
  if (isStructural(e)) continue;
  const ck = `${e.page}#${sheetKeyOf(e)}`;
  const idx = counters[ck] || 0; counters[ck] = idx + 1;
  const ours = oursPayload(e, idx, sheet) || {};
  const c = comp[e.key] || (comp[e.key] = { n: 0, pages: new Set(), trails: {}, f: {} });
  c.n++; c.pages.add(e.page);
  const tr = e.exp.ui_access_point == null ? '(none)' : e.exp.ui_access_point;
  c.trails[tr] = (c.trails[tr] || 0) + 1;
  for (const f of DIFF_FIELDS) {
    let w = e.exp[f]; let g = ours[f];
    if (f === 'icom_user_action' || f === 'link_name') { w = stripBc(w); g = stripBc(g); }
    const cell = c.f[f] || (c.f[f] = { present: 0, fails: 0 });
    if (norm(w) != null) cell.present++;
    if (JSON.stringify(norm(w)) !== JSON.stringify(norm(g))) cell.fails++;
  }
}

// structural (non-CTA) tail
const struct = {};
for (const e of golden.entries) if (isStructural(e)) struct[e.key] = (struct[e.key] || 0) + 1;

const keys = Object.keys(comp).sort((a, b) => comp[b].n - comp[a].n);
const cell = (c, f) => { const x = c.f[f]; if (!x) return '·'; if (x.fails) return `${x.fails}✗`; return x.present === 0 ? '·' : '✓'; };
const fid = (c) => {
  let m = 0; for (const f of DIFF_FIELDS) m += (c.n - (c.f[f]?.fails || 0)); return `${(100 * m / (c.n * DIFF_FIELDS.length)).toFixed(0)}%`;
};
const domTrail = (c) => Object.entries(c.trails).sort((a, b) => b[1] - a[1])[0][0];
const totalClose = keys.reduce((s, k) => s + comp[k].n, 0);
const totalStruct = Object.values(struct).reduce((s, n) => s + n, 0);

let md = `# Click-tracking coverage matrix

Readable view of the ${golden.pages.filter((p) => p !== '*').length}-page prod golden and how our Option B runtime covers it.
Source golden: \`${GOLDEN_PATH.split('/').pop()}\`. Regenerate: \`node scripts/diff/coverage-matrix.mjs\`. Counts only — no campaign codes.

- **${totalClose} closeable events** (CTAs + video) + **${totalStruct} structural** (non-CTA blog-card elements) = ${totalClose + totalStruct} across ${golden.pages.filter((p) => p !== '*').length} pages.
- Cells compare our emitted value to prod on \`trim()\`. Legend: **✓** all match · **N✗** N events differ (gap) · **·** prod does not populate this field for this component.
- \`Class\`: residual-gap owner — **A** our markup, **B** prod inconsistency (we emit a clean/superset value), **C** fixable on our end, **—** none.

## Coverage summary

| Component | Events | Pages | Fidelity | Class | Dominant trail (ui_access_point) | Residual gap |
|---|--:|--:|--:|:--:|---|---|
`;
for (const k of keys) {
  const c = comp[k]; const cl = CLASS[k] || ['—', ''];
  md += `| \`${k}\` | ${c.n} | ${c.pages.size} | ${fid(c)} | ${cl[0]} | \`${domTrail(c)}\` | ${cl[1]} |\n`;
}

md += '\n## Field matrix\n\nEach cell: **✓** match · **N✗** N events differ · **·** field not populated by prod here.\n\n';
md += `| Component | ${DIFF_FIELDS.map((f) => ABBR[f]).join(' | ')} |\n`;
md += `|---|${DIFF_FIELDS.map(() => '--').join('|')}|\n`;
for (const k of keys) md += `| \`${k}\` | ${DIFF_FIELDS.map((f) => cell(comp[k], f)).join(' | ')} |\n`;

md += '\n## Structural (non-CTA) — prod tracks per-element, our cards are single-anchor (#769)\n\n';
md += '| Component | Elements | Note |\n|---|--:|---|\n';
const SNOTE = {
  dynamic_category_container: 'blog-index category/card grid — per img/picture/div',
  'related-blogs': 'in-article related cards — per img/picture/div',
  'secondary-nav': 'non-CTA sub-elements',
  'pause-button': 'carousel pause control',
};
for (const [k, n] of Object.entries(struct).sort((a, b) => b[1] - a[1])) md += `| \`${k}\` | ${n} | ${SNOTE[k] || ''} |\n`;

writeFileSync(OUT_PATH, md);
console.log(`wrote ${OUT_PATH} — ${keys.length} components, ${totalClose} closeable + ${totalStruct} structural`);
