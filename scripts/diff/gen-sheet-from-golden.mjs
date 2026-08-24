#!/usr/bin/env node
/**
 * gen-sheet-from-golden.mjs — reverse-engineer the residue sheet FROM the prod
 * golden, keyed to align with the runtime.
 *
 * For each golden entry it computes what OUR pipeline derives with NO sheet
 * (reusing parity-gate's exact oursPayload), diffs against prod, and emits ONLY
 * the fields the derive/block-defaults can't produce — the genuine authored
 * residue: object-detail, wa-link, semantic ui-object, non-default action,
 * differing ui-object-detail, and authored link_name (as custom-properties).
 * Keys use the SAME (page, sheetKey, DOM-order index) the gate/runtime index by,
 * so residue lands on the right CTA (fixes the capture-vs-runtime key drift).
 *
 * Output overwrites the LOCAL sheet (gitignored — campaign codes):
 *   scripts/diff/fixtures/local/tracking-sheet.json
 * This is the customer's sheet reverse-engineered; hand it over as the seed.
 *
 *   node scripts/diff/gen-sheet-from-golden.mjs
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  oursPayload, sheetKeyOf, isStructural, stripBc, footerIdOf, ID_KEYED,
} from './parity-gate.mjs';

const DIR = 'scripts/diff/fixtures/local';
const golden = JSON.parse(readFileSync(`${DIR}/clicktrack-golden.json`, 'utf8'));
const EMPTY = new Map();

// Trim strings before comparing/emitting: whitespace/newline diffs are matches,
// and the sheet should carry clean values.
const T = (v) => (typeof v === 'string' ? v.trim() : v);
const ne = (a, b) => (T(a) || '') !== (T(b) || '');

const rows = []; // legacy positional rows (`key: <sheetKey>-<n>`)
const footerRows = new Map(); // id -> row for id-keyed blocks; last wins
const seenFooter = new Map(); // id -> residue JSON, to flag genuine collisions
const counters = {};
for (const e of golden.entries) {
  if (isStructural(e)) continue;
  const ck = `${e.page}#${sheetKeyOf(e)}`;
  const idx = counters[ck] || 0; counters[ck] = idx + 1;
  const ours = oursPayload(e, idx, EMPTY) || {}; // no-sheet derive + block defaults
  const x = e.exp;
  const row = {};
  if (T(x.object) && ne(x.object, ours.object)) row.object = T(x.object);
  if (T(x.object_detail) && ne(x.object_detail, ours.object_detail)) row['object-detail'] = T(x.object_detail);
  if (T(x['data-wa-link'])) row['wa-link'] = T(x['data-wa-link']);
  if (T(x.action) && ne(x.action, ours.action)) row.action = T(x.action);
  if (T(x.ui_object) && ne(x.ui_object, ours.ui_object)) row['ui-object'] = T(x.ui_object);
  if (T(x.ui_object_detail) && ne(x.ui_object_detail, ours.ui_object_detail)) row['ui-object-detail'] = T(x.ui_object_detail);
  if (T(x.ui_action) && ne(x.ui_action, ours.ui_action)) row['ui-action'] = T(x.ui_action);
  const wantLN = T(stripBc(x.link_name));
  if (wantLN && wantLN !== T(stripBc(ours.link_name))) row['custom-properties'] = `link_name=${wantLN}`;
  if (!Object.keys(row).length) continue;
  // Id-keyed blocks (footer): key each row by the CTA's identity — its semantic
  // data-track-id (chrome) or normalized href — matching what footer.js stamps and
  // the runtime resolves. Order-independent, so it dedupes the mobile/desktop
  // duplicates and is immune to render-order drift. Others stay positional.
  if (ID_KEYED.has(e.key)) {
    const id = e.key === 'footer' ? footerIdOf(e) : '';
    if (!id) { console.warn(`  ⚠ unkeyable ${e.key} entry (no id): ${T(x['data-wa-link']) || e.href}`); continue; }
    const rj = JSON.stringify(row);
    if (seenFooter.has(id) && seenFooter.get(id) !== rj) {
      console.warn(`  ⚠ id collision "${id}": ${seenFooter.get(id)} vs ${rj} — keeping last`);
    }
    seenFooter.set(id, rj);
    footerRows.set(id, { path: '*', id, ...row });
  } else {
    rows.push({ path: e.page === '*' ? '*' : e.page, key: `${sheetKeyOf(e)}-${idx + 1}`, ...row });
  }
}

const allRows = [...rows, ...footerRows.values()];
writeFileSync(`${DIR}/tracking-sheet.json`, `${JSON.stringify({ data: allRows })}\n`);
const cols = {};
allRows.forEach((r) => Object.keys(r).forEach((k) => { if (!['path', 'key', 'id'].includes(k)) cols[k] = (cols[k] || 0) + 1; }));
console.log(`generated ${allRows.length} residue rows (${footerRows.size} id-keyed, ${rows.length} positional) -> ${DIR}/tracking-sheet.json`);
console.log('by residue column:', JSON.stringify(cols));
