#!/usr/bin/env node
/**
 * sheet-from-our-build.mjs — generate residue sheet rows keyed by OUR BUILD's
 * ACTUAL runtime data-track-ids, so the residue actually resolves at runtime.
 *
 * WHY: gen-sheet-from-golden keys rows by the GOLDEN's assigned id (prod's markup),
 * but the runtime resolves by OUR build's id. Where our markup diverges from prod
 * (hero vs cta_block, quickbooks vs erp href, nav label vs nav|capabilities) the ids
 * mismatch and the residue never lands. This tool matches each golden entry to our
 * build's real CTA by IDENTITY (ui_object_detail / label / href), takes our real tid,
 * and emits the authored residue keyed by it — closing cta + hero + nav + footer at once.
 *
 * INPUT: an "ours" scan of our live/preview build — the beacon-free scan the work Chrome
 * renders (__scanMain: pointerdown each CTA -> read stamped data-* -> tracker-replica payload):
 *   { "pages": { "/some/path": [ { "label","href","tid","p": {…11 diff fields…} }, … ], … } }
 * Aggregate per-page __scanMain output under `pages`. (No injected tracker needed — we read
 * the ids/payload our stampInteraction produces.)
 *
 *   node scripts/diff/sheet-from-our-build.mjs --ours ours-scan.json \
 *     --golden scripts/diff/fixtures/local/clicktrack-golden-customer.json \
 *     --out scripts/diff/fixtures/local/tracking-sheet-from-build.json
 *
 * Emits ONLY sheet-settable residue (object, object-detail, action, ui-object,
 * ui-object-detail, ui-action, wa-link, custom-properties/link_name). It CANNOT set
 * ui_access_point (the injected tracker computes that from the data-tracking trail — a
 * block-wiring fix, or #912's DOM-wrapper override). Rows for those, and golden entries
 * with no matching CTA in our build (content-absent), are reported, not emitted.
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, newline-per-chained-call */
import { readFileSync, writeFileSync } from 'node:fs';
import { isStructural, stripBc, assignIds } from './parity-gate.mjs';

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const DIR = 'scripts/diff/fixtures/local';
const GOLDEN_PATH = argOf('--golden') || `${DIR}/clicktrack-golden-customer.json`;
const OURS_PATH = argOf('--ours');
const OUT_PATH = argOf('--out') || `${DIR}/tracking-sheet-from-build.json`;
if (!OURS_PATH) { console.error('need --ours <scan.json> (aggregated __scanMain output under {pages})'); process.exit(2); }

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
assignIds(golden.entries); // sets e.trackId (the golden-derived id) for the remap report
const ours = JSON.parse(readFileSync(OURS_PATH, 'utf8')).pages || {};

// ---- normalization (mirrors the oracle: tag-strip, idx-tolerant, bracket-strip) ----
const T = (v) => (typeof v === 'string' ? v.trim() : v);
const stripTags = (v) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '') : v);
const idxNorm = (v) => (typeof v === 'string' ? v.replace(/_\d+/g, '_N') : v);
const ne = (a, b) => (T(a) || '') !== (T(b) || '');
const neTagless = (a, b) => (T(stripTags(a)) || '') !== (T(stripTags(b)) || '');
const neIdxTagless = (a, b) => (idxNorm(T(stripTags(a))) || '') !== (idxNorm(T(stripTags(b))) || '');
const nl = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const npath = (h) => { try { return new URL(h, 'https://erp.intuit.com').pathname.replace(/\/$/, '') || '/'; } catch { return (h || '').replace(/\/$/, ''); } };

// Match a golden entry to our scanned CTA by identity, then never re-use it.
function matchCta(entry, ctas, used) {
  const et = nl((entry.exp && entry.exp.ui_object_detail) || entry.text);
  const eh = entry.href ? npath(entry.href) : null;
  let i = ctas.findIndex((c, k) => !used.has(k) && c.p && nl(c.p.ui_object_detail) === et && et);
  if (i < 0) i = ctas.findIndex((c, k) => !used.has(k) && nl(c.label) === et && et);
  if (i < 0 && eh) i = ctas.findIndex((c, k) => !used.has(k) && c.href && npath(c.href) === eh);
  if (i < 0) return null;
  used.add(i);
  return ctas[i];
}

const rows = [];
const report = { emitted: 0, absent: [], uiAccessPointOnly: [], idKept: 0, idRemapped: 0 };
const usedByPage = {};
for (const e of golden.entries) {
  if (isStructural(e)) continue;
  const page = e.page === '*' ? '*' : e.page;
  const ctas = ours[e.page] || ours[page] || [];
  if (!usedByPage[e.page]) usedByPage[e.page] = new Set();
  const used = usedByPage[e.page];
  const cta = matchCta(e, ctas, used);
  if (!cta || !cta.tid) { report.absent.push(`${e.page} [${e.key || 'loose'}] ${(e.text || '').slice(0, 40)}`); continue; }
  const x = e.exp; const g = cta.p || {};
  const row = {};
  if (T(x.object) && ne(x.object, g.object)) row.object = T(x.object);
  if (T(x.object_detail) && neIdxTagless(x.object_detail, g.object_detail)) row['object-detail'] = T(x.object_detail);
  if (T(x['data-wa-link']) && ne(x['data-wa-link'], g['data-wa-link'])) row['wa-link'] = T(x['data-wa-link']);
  if (T(x.action) && ne(x.action, g.action)) row.action = T(x.action);
  if (T(x.ui_object) && neIdxTagless(x.ui_object, g.ui_object)) row['ui-object'] = T(x.ui_object);
  if (T(x.ui_object_detail) && neTagless(x.ui_object_detail, g.ui_object_detail)) row['ui-object-detail'] = T(x.ui_object_detail);
  if (T(x.ui_action) && ne(x.ui_action, g.ui_action)) row['ui-action'] = T(x.ui_action);
  const wantLN = T(stripBc(x.link_name));
  if (wantLN && neIdxTagless(wantLN, stripBc(g.link_name))) row['custom-properties'] = `link_name=${wantLN}`;
  // ui_access_point can't be set from the sheet (structural trail) — flag, don't emit.
  if (ne(idxNorm(x.ui_access_point), idxNorm(g.ui_access_point)) && !Object.keys(row).length) {
    report.uiAccessPointOnly.push(`${e.page} ${cta.tid}  want=${x.ui_access_point} got=${g.ui_access_point}`);
    continue;
  }
  if (!Object.keys(row).length) continue;
  if (cta.tid === e.trackId) report.idKept++; else report.idRemapped++;
  rows.push({ path: page, id: cta.tid, ...row });
  report.emitted++;
}

writeFileSync(OUT_PATH, `${JSON.stringify({ data: rows }, null, 2)}\n`);
console.log(`emitted ${report.emitted} residue rows (keyed by our build's real tids) -> ${OUT_PATH}`);
console.log(`  remapped ids (differed from golden): ${report.idRemapped}   kept: ${report.idKept}`);
console.log(`  ui_access_point-only gaps (NOT sheet-fixable — block wiring/#912): ${report.uiAccessPointOnly.length}`);
if (report.uiAccessPointOnly.length) report.uiAccessPointOnly.slice(0, 20).forEach((s) => console.log(`      ${s}`));
console.log(`  golden entries with no matching CTA in our build (content-absent): ${report.absent.length}`);
if (report.absent.length) report.absent.slice(0, 20).forEach((s) => console.log(`      ${s}`));
