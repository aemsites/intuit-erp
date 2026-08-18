#!/usr/bin/env node
/**
 * scripts/diff/clicktrack-diff.mjs
 *
 * Parity gate for the AUTHORED click-tracking channel (sibling of appvars-diff.mjs,
 * which covers the data-pzn channel). For every trackable CTA it computes the
 * payload the tracker would send — via the reverse-engineered tracker-replica —
 * on the prod baseline vs our build, matches CTAs across the two DOMs by identity,
 * and diffs the payloads. Green when our build reproduces prod.
 *
 * Modes:
 *   node scripts/diff/clicktrack-diff.mjs --path /                 # prod baseline only (report)
 *   node scripts/diff/clicktrack-diff.mjs --path / \
 *        --ours http://localhost:3000/drafts/click-tracking \
 *        --sheet scripts/diff/fixtures/tracking-homepage.candidate.json --assert
 *   node scripts/diff/clicktrack-diff.mjs --html-baseline a.html --html-ours b.html  # offline
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline */

import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchStealthHeaded } from './live-session.mjs';
import { captureHtml } from './capture-html.mjs';
import { computeTrackingPayload } from './tracker-replica.mjs';

const PROD = 'https://erp.intuit.com';

const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');

// Identity key stable across prod's and our DOMs: what the CTA is + where it sits.
export function ctaKey(payload, label) {
  return [payload.object || 'walink', norm(payload.ui_object_detail) || label, payload.ui_access_point || ''].join('¦');
}

// Every trackable CTA's payload from a rendered HTML string.
export function payloadsFrom(html) {
  const { document } = new JSDOM(html).window;
  const list = [];
  for (const el of document.querySelectorAll('a[href], button')) {
    const payload = computeTrackingPayload(el);
    if (!payload) continue;
    const label = norm(el.textContent);
    list.push({ label, key: ctaKey(payload, label), payload });
  }
  return list;
}

// Field-level payload comparison -> human-readable diffs.
export function payloadDiff(a, b) {
  const diffs = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = JSON.stringify(a[k]);
    const bv = JSON.stringify(b[k]);
    if (av !== bv) diffs.push(`${k}: ${av ?? '∅'} -> ${bv ?? '∅'}`);
  }
  return diffs;
}

// Match ours to baseline by identity key (repeats consumed in order), then diff.
export function diffCaptures(baseline, ours) {
  const oursByKey = new Map();
  ours.forEach((c) => {
    if (!oursByKey.has(c.key)) oursByKey.set(c.key, []);
    oursByKey.get(c.key).push(c);
  });
  const matched = [];
  const missing = [];
  for (const b of baseline) {
    const q = oursByKey.get(b.key);
    if (q && q.length) {
      const o = q.shift();
      matched.push({ b, o, diffs: payloadDiff(b.payload, o.payload) });
    } else {
      missing.push(b);
    }
  }
  return { matched, missing, extra: [...oursByKey.values()].flat() };
}

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function reportBaseline(baseline) {
  console.log(`\nProd baseline: ${G(baseline.length)} trackable CTAs\n`);
  baseline.slice(0, 12).forEach((c) => {
    console.log(`  ${DIM(c.key)}`);
    console.log(`    object=${c.payload.object} ui_access_point=${c.payload.ui_access_point || '(none)'} cp=${JSON.stringify(c.payload.custom_properties)}`);
  });
  console.log('');
}

function report(result) {
  const clean = result.matched.filter((m) => m.diffs.length === 0);
  const drifted = result.matched.filter((m) => m.diffs.length);
  console.log('\nClick-tracking parity (prod baseline vs ours):');
  console.log(`  ${G(`${clean.length} match`)} · ${drifted.length ? R(`${drifted.length} differ`) : DIM('0 differ')} · ${result.missing.length ? Y(`${result.missing.length} missing in ours`) : DIM('0 missing')} · ${DIM(`${result.extra.length} extra in ours`)}\n`);
  drifted.forEach((m) => {
    console.log(`  ${R('DIFF')} ${m.b.label || m.b.key}`);
    m.diffs.forEach((d) => console.log(`       ${d}`));
  });
  result.missing.slice(0, 20).forEach((b) => console.log(`  ${Y('MISSING')} ${b.label || b.key} ${DIM(`(${b.key})`)}`));
  console.log('');
  return drifted.length === 0 && result.missing.length === 0;
}

function parseArgs(argv) {
  const o = { path: '/', ours: null, sheet: null, htmlBaseline: null, htmlOurs: null, assert: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') o.path = argv[++i];
    else if (a === '--ours') o.ours = argv[++i];
    else if (a === '--sheet') o.sheet = argv[++i];
    else if (a === '--html-baseline') o.htmlBaseline = argv[++i];
    else if (a === '--html-ours') o.htmlOurs = argv[++i];
    else if (a === '--assert') o.assert = true;
    else if (a === '--headed') o.headed = true;
  }
  return o;
}

// A sheet fixture may be the DA shape ({data:[...]}) or the extractor's ({rows:[...]}).
function sheetRoutes(sheetPath) {
  if (!sheetPath) return [];
  const j = JSON.parse(readFileSync(sheetPath, 'utf8'));
  return [{ pattern: '**/tracking.json', json: { data: j.data || j.rows || [] } }];
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let baselineHtml;
  let oursHtml = null;

  if (o.htmlBaseline) {
    baselineHtml = readFileSync(o.htmlBaseline, 'utf8');
    if (o.htmlOurs) oursHtml = readFileSync(o.htmlOurs, 'utf8');
  } else {
    const browser = o.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
    try {
      baselineHtml = await captureHtml(browser, `${PROD}${o.path}`, { headed: o.headed });
      if (o.ours) oursHtml = await captureHtml(browser, o.ours, { headed: o.headed, routes: sheetRoutes(o.sheet), settleMs: 2500 });
    } catch (e) {
      console.error(`\n✖ capture failed: ${e.name || 'Error'} — ${e.message.split('\n')[0]}\n  (Akamai bot ladder — retry with --headed on a machine with a display.)\n`);
      await browser.close().catch(() => {});
      process.exit(2);
    }
    await browser.close().catch(() => {});
  }

  const baseline = payloadsFrom(baselineHtml);
  if (!oursHtml) { reportBaseline(baseline); return; }
  const ok = report(diffCaptures(baseline, payloadsFrom(oursHtml)));
  if (o.assert && !ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
