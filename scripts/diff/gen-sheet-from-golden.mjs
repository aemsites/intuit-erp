#!/usr/bin/env node
/**
 * gen-sheet-from-golden.mjs — reverse-engineer the residue sheet FROM the prod
 * golden, keyed by id to align with the runtime.
 *
 * For each golden entry it computes what OUR pipeline derives with NO sheet
 * (reusing parity-gate's oursPayload), diffs against prod, and emits ONLY the
 * fields the derive/block-defaults can't produce — the authored residue:
 * object-detail, wa-link, semantic ui-object, non-default action, differing
 * ui-object-detail, and authored link_name (as custom-properties). Every row is
 * keyed by the entry's assigned `id` (assignIds — the same data-track-id the block
 * stamps and the runtime resolves), so residue lands on the right CTA regardless of
 * render order.
 *
 * Overwrites the LOCAL sheet (gitignored — campaign codes); hand it over as the seed:
 *   node scripts/diff/gen-sheet-from-golden.mjs
 *   node scripts/diff/gen-sheet-from-golden.mjs \
 *     --golden scripts/diff/fixtures/local/clicktrack-golden-customer.json \
 *     --out scripts/diff/fixtures/local/tracking-sheet-customer.json
 *
 * The printed residue histogram is the AUTHORABLE-vs-STRUCTURAL split: columns it can
 * emit (object-detail, wa-link, ui-object, ui-action, ui-object-detail, link_name) are
 * authorable; what it CAN'T encode (event, ui_access_point trail — those come from block
 * wiring) is where residual parity-gate gaps are truly structural.
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  oursPayload, sheetKeyOf, isStructural, stripBc, assignIds,
} from './parity-gate.mjs';

const DIR = 'scripts/diff/fixtures/local';
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const GOLDEN_PATH = argOf('--golden') || `${DIR}/clicktrack-golden.json`;
const OUT_PATH = argOf('--out') || `${DIR}/tracking-sheet.json`;
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
assignIds(golden.entries);
const EMPTY = new Map();

// Trim strings before comparing/emitting: whitespace/newline diffs are matches.
const T = (v) => (typeof v === 'string' ? v.trim() : v);
const ne = (a, b) => (T(a) || '') !== (T(b) || '');

const rows = [];
const counters = {};
for (const e of golden.entries) {
  if (isStructural(e) || !e.trackId) continue;
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
  rows.push({ path: e.page === '*' ? '*' : e.page, id: e.trackId, ...row });
}

writeFileSync(OUT_PATH, `${JSON.stringify({ data: rows })}\n`);
const cols = {};
rows.forEach((r) => Object.keys(r).forEach((k) => { if (!['path', 'id'].includes(k)) cols[k] = (cols[k] || 0) + 1; }));
console.log(`generated ${rows.length} id-keyed residue rows -> ${OUT_PATH}`);
console.log('by residue column:', JSON.stringify(cols));
