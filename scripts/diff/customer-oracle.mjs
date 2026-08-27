#!/usr/bin/env node
/**
 * customer-oracle.mjs — the OFFLINE, deterministic loop gate against the customer golden.
 *
 * This is the fast inner oracle a /goal loop iterates against. It scores only the
 * fields the offline synthetic derive can compute (OFFLINE_GATED = event + the derive-
 * driven per-click fields), because those are exactly what the loop's code changes move
 * (tracking.js derive, block trackAs wiring, the residue sheet). The LIVE full-envelope
 * gate (stage-parity.mjs) is the authoritative check on ALL 60 fields incl. the inherited
 * ones; run it at milestones / before declaring done.
 *
 * Un-gameable by construction (all enforced in oracle-lib.mjs):
 *   - asserts golden integrity (a hand-edited golden throws);
 *   - gated field set comes from field-policy.json (can't be quietly trimmed here);
 *   - chat:viewed etc. are frozen structural exceptions (enumerated, not silently dropped);
 *   - verdict = MIN across {overall, per-event, per-component, per-field, coverage}.
 *
 *   node scripts/diff/customer-oracle.mjs            # human report + verdict
 *   node scripts/diff/customer-oracle.mjs --json     # machine JSON (for the loop)
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { oursPayload, assignIds, sheetKeyOf } from './parity-gate.mjs';
import { indexRows } from '../tracking.js';
import {
  assertIntegrity, verdict, OFFLINE_GATED, specOf, gatedMatch, isStructuralException,
} from './oracle-lib.mjs';

const DIR = 'scripts/diff/fixtures/local';
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const GOLDEN_PATH = argOf('--golden') || `${DIR}/clicktrack-golden-customer.json`;
const SHEET_PATH = argOf('--sheet') || `${DIR}/tracking-sheet-customer.json`;

export default function runOracle() {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  assertIntegrity(golden); // hand-edited golden => throws (anti-gaming)
  let sheet = new Map();
  try { sheet = indexRows(JSON.parse(readFileSync(SHEET_PATH, 'utf8')).data); } catch { /* no sheet — derive-only floor */ }
  assignIds(golden.entries);

  const results = [];
  const counters = {};
  for (const e of golden.entries) {
    if (isStructuralException(e.event)) { results.push({ page: e.page, component: e.key || '(loose)', event: e.event, reproduced: false, gated: {}, presence: {} }); continue; }
    const ck = `${e.page}#${sheetKeyOf(e)}`;
    const idx = counters[ck] || 0; counters[ck] = idx + 1;
    const ours = oursPayload(e, idx, sheet);
    const gated = {};
    for (const f of OFFLINE_GATED) {
      const want = e.exp[f];
      if (want == null || want === '') continue; // only gate fields prod populated for this element
      const spec = f === 'event' ? specOf('envelope', 'event') : specOf('properties', f);
      gated[f] = gatedMatch(spec, want, ours ? ours[f] : undefined);
    }
    results.push({ page: e.page, component: sheetKeyOf(e), event: e.event, reproduced: !!ours, gated, presence: {} });
  }
  return verdict(results);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = runOracle();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`\nCustomer-golden OFFLINE oracle — across-the-board (MIN of all axes), threshold ${r.threshold}%`);
    console.log(`  SCORE = ${r.score}%  (weakest: ${r.weakest})   verdict: ${r.verdict}`);
    console.log(`  reproduced ${r.reproduced}/${r.gable}  ·  coverage ${r.axes.coverage}%  ·  overall gated ${r.axes.overall}%  ·  presence ${r.presence_pct}%`);
    console.log(`  structural exceptions (frozen, enumerated): ${r.structural_exceptions.length}`);
    console.log('\n  per gated field:');
    Object.entries(r.axes.byField).sort((a, b) => a[1] - b[1]).forEach(([f, p]) => console.log(`    ${String(p).padStart(5)}%  ${f}`));
    console.log('\n  per component (lowest first):');
    Object.entries(r.axes.byComponent).sort((a, b) => a[1] - b[1]).forEach(([k, p]) => console.log(`    ${String(p).padStart(5)}%  ${k}`));
    console.log('\n  per event:');
    Object.entries(r.axes.byEvent).sort((a, b) => a[1] - b[1]).forEach(([k, p]) => console.log(`    ${String(p).padStart(5)}%  ${k}`));
    if (r.stuck) {
      console.log('\n  STUCK — a human must resolve (or ratify a frozen exception):');
      if (Object.keys(r.stuck.failing_components).length) console.log(`    components < ${r.threshold}%: ${JSON.stringify(r.stuck.failing_components)}`);
      if (Object.keys(r.stuck.failing_fields).length) console.log(`    fields < ${r.threshold}%: ${JSON.stringify(r.stuck.failing_fields)}`);
      if (r.stuck.unreproduced.length) console.log(`    unreproduced: ${r.stuck.unreproduced.length} (${JSON.stringify(r.stuck.unreproduced.slice(0, 5))}…)`);
    }
    console.log('');
  }
  process.exit(r.verdict === 'PASS' ? 0 : 1);
}
