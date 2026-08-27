#!/usr/bin/env node
/**
 * golden-crosscheck.mjs — cross-validate OUR reverse-engineered golden
 * (clicktrack-golden.json) against the CUSTOMER's authoritative golden
 * (clicktrack-golden-customer.json).
 *
 * They were captured independently: ours by crawling live prod, theirs handed over.
 * The stable join key across two independent captures is `data-wa-link` — the authored
 * campaign code is the same element's fingerprint regardless of render order or page.
 * For every wa-link present in BOTH goldens we diff the identity fields; agreement
 * raises confidence, divergence flags where OUR golden (or derive assumptions) were
 * wrong. wa-link-less entries can't be joined reliably, so they are reported as
 * coverage-only (counts), not diffed.
 *
 *   node scripts/diff/golden-crosscheck.mjs
 *   node scripts/diff/golden-crosscheck.mjs --ours <path-to-clicktrack-golden.json> --json
 *
 * --ours defaults to the local reverse-engineered golden; point it at another worktree's
 * copy when this worktree doesn't have one (both are gitignored — campaign codes).
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, no-nested-ternary */
import { readFileSync, existsSync } from 'node:fs';

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const OURS = argOf('--ours') || 'scripts/diff/fixtures/local/clicktrack-golden.json';
const CUST = argOf('--customer') || 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';

// Identity fields worth agreeing on. Skip ui_access_point (capture-dependent trail),
// link_name/icom_user_action (derived from wa-link + page), event (= object:action).
const CMP = ['object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action'];
const T = (v) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : v);
const norm = (v) => { const s = T(v); return s === '' || s == null ? null : s; };

// wa-link -> {exp, page} (first occurrence wins; wa-links are ~unique campaign codes)
function indexByWa(golden) {
  const m = new Map();
  for (const e of golden.entries || []) {
    const wa = e.exp && e.exp['data-wa-link'];
    if (!wa || m.has(wa)) continue;
    m.set(wa, { exp: e.exp, page: e.page, key: e.key });
  }
  return m;
}

function main() {
  if (!existsSync(OURS)) {
    console.error(`Missing OUR golden: ${OURS}`);
    console.error('  Pass --ours <path> (e.g. another worktree\'s fixtures/local/clicktrack-golden.json). Both goldens are gitignored.');
    process.exit(2);
  }
  if (!existsSync(CUST)) { console.error(`Missing customer golden: ${CUST}. Run payloads-to-golden.mjs first.`); process.exit(2); }
  const ours = indexByWa(JSON.parse(readFileSync(OURS, 'utf8')));
  const cust = indexByWa(JSON.parse(readFileSync(CUST, 'utf8')));

  const inBoth = [...cust.keys()].filter((wa) => ours.has(wa));
  const custOnly = [...cust.keys()].filter((wa) => !ours.has(wa));
  const oursOnly = [...ours.keys()].filter((wa) => !cust.has(wa));

  const byField = Object.fromEntries(CMP.map((f) => [f, { agree: 0, diff: 0 }]));
  const divergences = [];
  for (const wa of inBoth) {
    const a = ours.get(wa).exp; const b = cust.get(wa).exp;
    const diffs = {};
    for (const f of CMP) {
      const same = JSON.stringify(norm(a[f])) === JSON.stringify(norm(b[f]));
      byField[f][same ? 'agree' : 'diff'] += 1;
      if (!same) diffs[f] = { ours: norm(a[f]), customer: norm(b[f]) };
    }
    if (Object.keys(diffs).length) divergences.push({ wa, page: cust.get(wa).page, diffs });
  }

  const pct = (a, n) => (n ? +((100 * a) / n).toFixed(1) : 100);
  const totalCells = inBoth.length * CMP.length;
  const agreeCells = Object.values(byField).reduce((s, v) => s + v.agree, 0);
  const report = {
    ours_wa: ours.size,
    customer_wa: cust.size,
    joined_on_wa: inBoth.length,
    agreement_pct: pct(agreeCells, totalCells),
    by_field: Object.fromEntries(CMP.map((f) => [f, pct(byField[f].agree, inBoth.length)])),
    divergences: divergences.length,
    customer_only_wa: custOnly.length,
    ours_only_wa: oursOnly.length,
  };

  if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...report, divergenceDetail: divergences }, null, 2)); return; }

  console.log('\nGolden cross-check — OUR reverse-engineered golden vs CUSTOMER authoritative golden');
  console.log(`  wa-links: ours=${ours.size}  customer=${cust.size}  joined=${inBoth.length}`);
  console.log(`  identity agreement on joined wa-links: ${report.agreement_pct}%`);
  console.log('  by field:');
  Object.entries(report.by_field).forEach(([f, p]) => console.log(`    ${String(p).padStart(5)}%  ${f}`));
  if (divergences.length) {
    console.log(`\n  ${divergences.length} wa-link(s) where OUR golden disagrees with the customer (investigate):`);
    divergences.slice(0, 25).forEach((d) => {
      const parts = Object.entries(d.diffs).map(([f, v]) => `${f}: ours=${JSON.stringify(v.ours)} cust=${JSON.stringify(v.customer)}`);
      console.log(`    [${d.page}] ${d.wa}\n        ${parts.join('\n        ')}`);
    });
    if (divergences.length > 25) console.log(`    …and ${divergences.length - 25} more (use --json)`);
  } else if (inBoth.length) {
    console.log('\n  no divergences on joined wa-links — our golden agrees with ground truth where they overlap');
  }
  console.log(`\n  coverage: ${custOnly.length} wa-links only in customer, ${oursOnly.length} only in ours\n`);
}

main();
