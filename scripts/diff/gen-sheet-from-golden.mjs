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
import { oursPayload, sheetKeyOf, isStructural, stripBc } from './parity-gate.mjs';

const DIR = 'scripts/diff/fixtures/local';
const golden = JSON.parse(readFileSync(`${DIR}/clicktrack-golden.json`, 'utf8'));
const EMPTY = new Map();

const rows = [];
const counters = {};
for (const e of golden.entries) {
  if (isStructural(e)) continue;
  const ck = `${e.page}#${sheetKeyOf(e)}`;
  const idx = counters[ck] || 0; counters[ck] = idx + 1;
  const ours = oursPayload(e, idx, EMPTY) || {}; // no-sheet derive + block defaults
  const x = e.exp;
  const row = {};
  if (x.object && x.object !== ours.object) row.object = x.object;
  if (x.object_detail && x.object_detail !== ours.object_detail) row['object-detail'] = x.object_detail;
  if (x['data-wa-link']) row['wa-link'] = x['data-wa-link'];
  if (x.action && x.action !== ours.action) row.action = x.action;
  if (x.ui_object && x.ui_object !== ours.ui_object) row['ui-object'] = x.ui_object;
  if (x.ui_object_detail && x.ui_object_detail !== ours.ui_object_detail) row['ui-object-detail'] = x.ui_object_detail;
  if (x.ui_action && x.ui_action !== ours.ui_action) row['ui-action'] = x.ui_action;
  const wantLN = stripBc(x.link_name);
  if (wantLN && wantLN !== stripBc(ours.link_name)) row['custom-properties'] = `link_name=${wantLN}`;
  if (Object.keys(row).length) {
    rows.push({ path: e.page === '*' ? '*' : e.page, key: `${sheetKeyOf(e)}-${idx + 1}`, ...row });
  }
}

writeFileSync(`${DIR}/tracking-sheet.json`, `${JSON.stringify({ data: rows })}\n`);
const cols = {};
rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'path' && k !== 'key') cols[k] = (cols[k] || 0) + 1; }));
console.log(`generated ${rows.length} residue rows -> ${DIR}/tracking-sheet.json`);
console.log('by residue column:', JSON.stringify(cols));
