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
import {
  launchStealthHeaded, newLiveContext, gotoLive, defaultWaitUntil, dismissOverlays,
} from './live-session.mjs';
import { captureHtml } from './capture-html.mjs';
import { computeTrackingPayload } from './tracker-replica.mjs';
import {
  PREFIX, deriveForCta, resolveCta, stampCta, stampTracking, blockNameOf, blockAccessPoint, trackingKey, ctasIn,
} from '../tracking.js';

const PROD = 'https://erp.intuit.com';

// The DOM-derivable per-click fields the oracle diffs. The ~47 shared context +
// consent, and the page-level personalization_details / experiment_ids /
// site_section, are attached by the injected tracker (not DOM-derived), so they
// are inherited for free and excluded from the diff.
const DIFF_FIELDS = [
  'event', 'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail',
  'ui_action', 'ui_access_point', 'data-wa-link', 'icom_user_action', 'link_name',
];

const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');

// Identity key stable across prod's and our DOMs: what the CTA is + where it sits.
export function ctaKey(payload, label) {
  return [payload.object || 'walink', norm(payload.ui_object_detail) || label, payload.ui_access_point || ''].join('¦');
}

// Option B stamps nothing at rest, so the OURS side has no data-* to read. This
// reproduces the click-time JIT stamp across every CTA (the batch equivalent of
// the runtime's per-interaction stampInteraction) so the replica can compute a
// payload. `forceTrackAll` ignores the tracking- opt-in — used to measure the
// pure auto-derive gap on a page that hasn't been tagged yet.
export function simulateStamps(document, { forceTrackAll = false } = {}) {
  const mainEl = document.querySelector('main');
  const pageSeg = (document.head?.querySelector('meta[name="tracking"]')?.content || '').trim();
  if (mainEl && pageSeg) stampTracking(mainEl, pageSeg);
  const stampOne = (el, blockName) => stampCta(el, resolveCta(deriveForCta(el, blockName), null));
  const scoped = [...document.querySelectorAll(`[class*="${PREFIX}"]`)].filter((b) => trackingKey(b));
  (forceTrackAll ? [...document.querySelectorAll('.block')] : scoped).forEach((block) => {
    const blockName = blockNameOf(block);
    stampTracking(block, blockAccessPoint(blockName));
    ctasIn(block).forEach((el) => stampOne(el, blockName));
  });
  if (forceTrackAll) {
    for (const el of document.querySelectorAll('a[href], button')) {
      if (el.hasAttribute('data-object') || el.hasAttribute('data-wa-link')) continue;
      const block = el.closest('.block');
      stampOne(el, block ? blockNameOf(block) : '');
    }
  }
}

// Every trackable CTA's payload from a rendered HTML string. `simulate` runs the
// Option B JIT stamp first (for the OURS side, which is clean at rest).
export function payloadsFrom(html, { simulate = false, forceTrackAll = false } = {}) {
  const { document } = new JSDOM(html).window;
  if (simulate) simulateStamps(document, { forceTrackAll });
  const list = [];
  for (const el of document.querySelectorAll('a[href], button')) {
    const payload = computeTrackingPayload(el);
    if (!payload) continue;
    const label = norm(el.textContent);
    list.push({ label, key: ctaKey(payload, label), payload });
  }
  return list;
}

// Field-level payload comparison -> human-readable diffs, restricted to the
// DOM-derivable per-click fields (the oracle's scope).
export function payloadDiff(a, b, fields = DIFF_FIELDS) {
  const diffs = [];
  for (const k of fields) {
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

// Extract the DOM-derivable per-click fields from a captured Segment envelope.
export function perClickOf(envelope) {
  const p = (envelope && envelope.properties) || {};
  const out = { event: envelope && envelope.event };
  for (const k of DIFF_FIELDS) if (k !== 'event' && k in p) out[k] = p[k];
  return out;
}

async function resolveLocator(page, locator) {
  if (!locator) return null;
  if (locator.selector) {
    const l = page.locator(locator.selector).nth(locator.nth || 0);
    return (await l.count()) ? l : null;
  }
  if (locator.text) {
    const byRole = page.getByRole(locator.role || 'link', { name: locator.text }).nth(locator.nth || 0);
    if (await byRole.count()) return byRole;
    const byText = page.getByText(locator.text).nth(locator.nth || 0);
    return (await byText.count()) ? byText : null;
  }
  return null;
}

/**
 * TRUE oracle capture. HARD RULE: intercept + ABORT every eventbus /t POST and
 * deliver NOTHING. Loads url, accepts consent so the injected tracker is active,
 * resolves + clicks the locator, forces the batched flush, and returns the
 * captured content:<action> per-click fields. Runs where the injected tracker is
 * present (stage / preview / localhost with the real profile).
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function captureLiveBeacon(browser, url, locator, { headed = false, timeoutMs = 45000 } = {}) {
  const context = await newLiveContext(browser, {});
  const captured = [];
  try {
    const page = await context.newPage();
    await page.route('**/eventbus.intuit.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        try { captured.push(JSON.parse(req.postData() || 'null')); } catch { captured.push({ __unparsed: true }); }
      }
      await route.abort(); // never deliver a test beacon
    });
    await gotoLive(page, url, {
      waitUntil: defaultWaitUntil(url), timeoutMs, settleMs: 1500, httpError: 'measure', solveWindow: headed,
    });
    await dismissOverlays(page).catch(() => {}); // accept consent so the tracker fires (then we abort)
    await page.waitForTimeout(1500);
    const el = await resolveLocator(page, locator);
    if (!el) throw new Error(`locator not found: ${JSON.stringify(locator)}`);
    await el.evaluate((node) => node.scrollIntoView({ block: 'center' })).catch(() => {});
    // block navigation so the batched beacon flushes in-page, then force the flush
    await page.evaluate(() => {
      document.addEventListener('click', (e) => e.preventDefault(), true);
      try { window.history.pushState = () => {}; window.history.replaceState = () => {}; } catch (e) { /* noop */ }
    });
    await el.click({ timeout: 5000 }).catch(() => {});
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(1200);
    return captured.filter((c) => c && c.event && String(c.event).includes(':')).map(perClickOf);
  } finally {
    await context.close().catch(() => {});
  }
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
  const o = {
    path: '/', ours: null, sheet: null, htmlBaseline: null, htmlOurs: null, assert: false, headed: false, forceTrackAll: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') o.path = argv[++i];
    else if (a === '--ours') o.ours = argv[++i];
    else if (a === '--sheet') o.sheet = argv[++i];
    else if (a === '--html-baseline') o.htmlBaseline = argv[++i];
    else if (a === '--html-ours') o.htmlOurs = argv[++i];
    else if (a === '--assert') o.assert = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--force-track-all') o.forceTrackAll = true;
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
  // OURS is Option B (clean at rest) -> JIT-simulate before reading.
  const ours = payloadsFrom(oursHtml, { simulate: true, forceTrackAll: o.forceTrackAll });
  const ok = report(diffCaptures(baseline, ours));
  if (o.assert && !ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
