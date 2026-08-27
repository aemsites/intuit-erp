#!/usr/bin/env node
/**
 * stage-parity.mjs — the AUTHORITATIVE live gate: does our deployed EDS build POST the
 * SAME beacons the customer captured on prod, across ALL ~60 fields?
 *
 * Drives the live env (default stage.erp.intuit.com), intercepts + ABORTS the real
 * eventbus /t POST our injected tracker fires (nothing leaves the machine), set-matches
 * captured beacons to the golden per page, and scores them through the SHARED oracle-lib
 * (same field-policy.json + integrity lock + across-the-board MIN verdict the offline
 * customer-oracle uses). GATED fields must value-match (host/env-normalized); the frozen
 * PRESENCE fields must be present+shape only. Built on the hardened live-session.mjs bot
 * ladder so a challenge/404 is never silently measured as parity.
 *
 * Our stage DOM has NO prod data-* at rest (Option B JIT-stamps at click), so elements are
 * located by SEMANTIC identity (label / href / aria), never by prod's data-wa-link.
 *
 *   node scripts/diff/stage-parity.mjs                         # all pages on stage
 *   node scripts/diff/stage-parity.mjs --headed                # stealth Chrome (past a bot block)
 *   node scripts/diff/stage-parity.mjs --page /construction    # one page
 *   node scripts/diff/stage-parity.mjs --base https://main--intuit-erp--aemsites.aem.page
 *   node scripts/diff/stage-parity.mjs --json
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, no-nested-ternary, no-await-in-loop */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  launchStealthHeaded, newLiveContext, gotoLive, defaultWaitUntil, dismissOverlays,
} from './live-session.mjs';
import {
  assertIntegrity, verdict, gatedSpecs, presenceSpecs, gatedMatch, normalizeValue, isStructuralException,
} from './oracle-lib.mjs';

const GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';

const norm = (v) => normalizeValue({ normalizeTags: true }, v);
const stripBc = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);
// content key stable across prod capture and our stage DOM: what the CTA is + its VISIBLE
// label. Deliberately excludes object_detail (e.g. faq|question_5) — its positional index
// differs between our authored order and prod's, so keying on it mis-pairs faqs; instead we
// score object_detail as a gated field. ui_object_detail is tag-stripped + bracket-stripped.
const contentKey = (p) => [p.object || '?', norm(stripBc(p.ui_object_detail)) || ''].join('¦');
const readField = (payload, loc, field) => (loc === 'envelope' ? payload[field] : (payload[loc] || {})[field]);

function parseArgs(argv) {
  const o = { base: 'https://stage.erp.intuit.com', page: null, headed: false, json: false, limit: 0, captures: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') o.base = argv[++i];
    else if (a === '--page') o.page = argv[++i];
    else if (a === '--headed') o.headed = true;
    else if (a === '--json') o.json = true;
    else if (a === '--limit') o.limit = +argv[++i];
    else if (a === '--captures') o.captures = argv[++i]; // offline: diff pre-captured live beacons (from the authenticated work Chrome) instead of driving Playwright
    else if (a === '--out') o.out = argv[++i]; // write the per-entry/per-field detail artifact (for the customer report)
  }
  return o;
}

// Semantic locator ladder for OUR stage DOM (no prod data-* at rest).
async function locate(page, entry) {
  const props = entry.fullPayload.properties || {};
  const label = norm(stripBc(props.ui_object_detail)) || entry.ctaLabel || entry.text;
  const href = props.link_href;
  const tries = [];
  if (href) tries.push(page.locator(`a[href="${href}"], a[href="${href.replace(/\/$/, '')}"]`).first());
  if (label) {
    tries.push(page.getByRole('link', { name: label, exact: false }).first());
    tries.push(page.getByRole('button', { name: label, exact: false }).first());
    tries.push(page.getByText(label, { exact: false }).first());
  }
  for (const l of tries) { try { if (await l.count()) return l; } catch { /* bad selector — next */ } }
  return null;
}

// Load a page once, accept consent, intercept every eventbus POST, click each target
// (staying on-page), and return the captured envelopes.
async function capturePage(browser, url, entries, { headed }) {
  const context = await newLiveContext(browser, {});
  const captured = [];
  const located = [];
  try {
    const page = await context.newPage();
    await page.route('**/eventbus.intuit.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') { try { captured.push(JSON.parse(req.postData() || 'null')); } catch { captured.push({ __unparsed: true }); } }
      await route.abort();
    });
    const resp = await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), timeoutMs: 45000, settleMs: 1500, httpError: 'measure', solveWindow: headed });
    if (resp && resp.status() >= 400) return { status: resp.status(), captured: [], located: [] };
    await dismissOverlays(page).catch(() => {});
    await page.evaluate(() => {
      document.addEventListener('click', (e) => e.preventDefault(), true);
      try { window.history.pushState = () => {}; window.history.replaceState = () => {}; } catch (e) { /* noop */ }
    });
    await page.waitForTimeout(1000);
    for (const entry of entries) {
      const el = await locate(page, entry);
      if (!el) continue;
      located.push(entry.contentKey);
      await el.evaluate((n) => n.scrollIntoView({ block: 'center' })).catch(() => {});
      await el.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape').catch(() => {}); // dismiss a modal a CTA may have opened
    }
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    await page.waitForTimeout(1500);
    const beacons = captured.filter((c) => c && c.event && String(c.event).includes(':'));
    return { status: resp ? resp.status() : 0, captured: beacons, located };
  } finally {
    await context.close().catch(() => {});
  }
}

// Full-envelope result for one matched (golden entry, captured beacon), via the policy.
function buildResult(entry, env) {
  const g = entry.fullPayload;
  const gated = {}; const presence = {};
  for (const loc of ['envelope', 'properties', 'context']) {
    for (const [field, spec] of gatedSpecs(loc)) {
      const want = readField(g, loc, field);
      if (want == null || want === '') continue; // only gate fields prod populated
      gated[`${loc}.${field}`] = gatedMatch(spec, want, readField(env, loc, field));
    }
  }
  for (const loc of ['envelope', 'properties', 'context', 'integrations']) {
    for (const [field] of presenceSpecs(loc)) {
      if (readField(g, loc, field) === undefined) continue; // prod didn't carry it -> nothing to require
      presence[`${loc}.${field}`] = readField(env, loc, field) !== undefined;
    }
  }
  return { page: entry.page, component: entry.key || '(loose)', event: entry.event, reproduced: true, gated, presence };
}

// Per-field detail for the customer report: every field prod carried, with our LIVE value,
// the match verdict, and its policy bucket. `got` is the sanitized capture (PII fields are
// shape tokens; gated fields are raw), so nothing sensitive is echoed into the artifact.
function buildDetail(entry, env) {
  const g = entry.fullPayload;
  const fields = [];
  const show = (v) => (v === undefined ? '‹absent›' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  for (const loc of ['envelope', 'properties', 'context']) {
    for (const [field, spec] of gatedSpecs(loc)) {
      const want = readField(g, loc, field);
      if (want == null || want === '') continue;
      const got = env ? readField(env, loc, field) : undefined;
      fields.push({
        loc,
        field,
        bucket: 'gated',
        kind: spec.kind || '',
        expected: show(normalizeValue(spec, want)),
        got: show(got === undefined ? undefined : normalizeValue(spec, got)),
        match: env ? gatedMatch(spec, want, got) : false,
      });
    }
  }
  for (const loc of ['envelope', 'properties', 'context', 'integrations']) {
    for (const [field, spec] of presenceSpecs(loc)) {
      if (readField(g, loc, field) === undefined) continue;
      const present = env ? readField(env, loc, field) !== undefined : false;
      fields.push({
        loc,
        field,
        bucket: 'frozen',
        group: spec.group || '',
        reason: spec.reason || '',
        expected: '‹present›',
        got: present ? '‹present›' : '‹MISSING›',
        match: present,
      });
    }
  }
  return {
    page: entry.page,
    component: entry.key || '(loose)',
    event: entry.event,
    text: (entry.ctaLabel || entry.text || '').slice(0, 80),
    href: (g.properties || {}).link_href || entry.href || '',
    reproduced: !!env,
    fields,
  };
}

// Offline diff of pre-captured live beacons (from the authenticated work Chrome). Same
// contentKey set-match + oracle scoring as the Playwright path — just no browser.
function runFromCaptures(golden, o) {
  const cap = JSON.parse(readFileSync(o.captures, 'utf8'));
  const capPages = cap.pages || cap;
  const byPage = new Map();
  for (const e of golden.entries) {
    if (o.page && e.page !== o.page) continue;
    if (e.nonCta && isStructuralException(e.event)) continue;
    e.contentKey = contentKey(e.fullPayload.properties || {});
    if (!byPage.has(e.page)) byPage.set(e.page, []);
    byPage.get(e.page).push(e);
  }
  const results = []; const details = []; const notMigrated = []; const pageLog = [];
  for (const [page, entries] of byPage) {
    const beacons = capPages[page];
    if (beacons == null) { notMigrated.push({ page, status: 'not-captured', beacons: entries.length }); pageLog.push({ page, notCaptured: true }); for (const entry of entries) { results.push({ page, component: entry.key || '(loose)', event: entry.event, reproduced: false, gated: {}, presence: {} }); details.push(buildDetail(entry, null)); } continue; }
    const real = beacons.filter((c) => c && c.event && String(c.event).includes(':'));
    const capByKey = new Map();
    for (const env of real) { const k = contentKey(env.properties || {}); if (!capByKey.has(k)) capByKey.set(k, []); capByKey.get(k).push(env); }
    let matched = 0;
    for (const entry of entries) {
      const q = capByKey.get(entry.contentKey);
      const env = q && q.length ? q.shift() : null;
      if (env) matched++;
      results.push(env ? buildResult(entry, env) : { page: entry.page, component: entry.key || '(loose)', event: entry.event, reproduced: false, gated: {}, presence: {} });
      details.push(buildDetail(entry, env));
    }
    pageLog.push({ page, expected: entries.length, matched, missing: entries.length - matched });
  }
  return { results, details, notMigrated, pageLog };
}

function goldenByPage(golden, o) {
  const byPage = new Map();
  for (const e of golden.entries) {
    if (o.page && e.page !== o.page) continue;
    if (e.nonCta && isStructuralException(e.event)) continue; // passive impressions — reported by the oracle as frozen exceptions
    e.contentKey = contentKey(e.fullPayload.properties || {});
    if (!byPage.has(e.page)) byPage.set(e.page, []);
    byPage.get(e.page).push(e);
  }
  return byPage;
}

// Live path: drive Playwright against the base env, capturing the real eventbus POSTs.
async function runFromPlaywright(golden, o) {
  const byPage = goldenByPage(golden, o);
  const browser = o.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  const results = []; const details = []; const notMigrated = []; const pageLog = [];
  try {
    for (const [page, entries] of byPage) {
      const url = `${o.base}${page === '/' ? '/' : page}`;
      const use = o.limit ? entries.slice(0, o.limit) : entries;
      let cap;
      try { cap = await capturePage(browser, url, use, { headed: o.headed }); } catch (e) {
        pageLog.push({ page, error: e.name || 'Error', message: (e.message || '').split('\n')[0] });
        continue;
      }
      if (cap.status >= 400) { notMigrated.push({ page, status: cap.status, beacons: use.length }); pageLog.push({ page, notYetMigrated: true, status: cap.status }); for (const entry of use) details.push(buildDetail(entry, null)); continue; }
      const capByKey = new Map();
      for (const env of cap.captured) { const k = contentKey(env.properties || {}); if (!capByKey.has(k)) capByKey.set(k, []); capByKey.get(k).push(env); }
      let matched = 0;
      for (const entry of use) {
        const q = capByKey.get(entry.contentKey);
        const env = q && q.length ? q.shift() : null;
        if (env) matched++;
        results.push(env ? buildResult(entry, env) : { page: entry.page, component: entry.key || '(loose)', event: entry.event, reproduced: false, gated: {}, presence: {} });
        details.push(buildDetail(entry, env));
      }
      pageLog.push({ page, expected: use.length, matched, missing: use.length - matched });
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { results, details, notMigrated, pageLog };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!existsSync(GOLDEN)) { console.error(`Missing ${GOLDEN}. Run payloads-to-golden.mjs first.`); process.exit(2); }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  assertIntegrity(golden); // hand-edited golden => throws

  const { results, details, notMigrated, pageLog } = o.captures
    ? runFromCaptures(golden, o)
    : await runFromPlaywright(golden, o);

  if (o.out) {
    const captured = details.filter((d) => d.reproduced).length;
    writeFileSync(o.out, JSON.stringify({ base: o.base, source: o.captures ? 'live-work-chrome' : 'playwright', generatedAt: new Date().toISOString(), captured, total: details.length, entries: details }, null, 2));
    console.log(`wrote detail artifact ${o.out} — ${captured}/${details.length} entries reproduced`);
  }

  const report = verdict(results);
  const out = {
    base: o.base,
    ...report,
    not_yet_migrated: notMigrated,
    pages: pageLog,
  };
  if (o.json) { console.log(JSON.stringify(out, null, 2)); process.exit(report.verdict === 'PASS' ? 0 : 1); }

  console.log(`\nStage full-envelope parity — ${o.base}  (across-the-board MIN, threshold ${report.threshold}%)`);
  console.log(`  SCORE = ${report.score}%  (weakest: ${report.weakest})   verdict: ${report.verdict}`);
  console.log(`  reproduced ${report.reproduced}/${report.gable}  ·  coverage ${report.axes.coverage}%  ·  overall gated ${report.axes.overall}%  ·  PRESENCE ${report.presence_pct}%`);
  if (notMigrated.length) console.log(`  NOT-YET-MIGRATED: ${notMigrated.map((n) => `${n.page}(${n.beacons})`).join(', ')} — ${notMigrated.reduce((s, n) => s + n.beacons, 0)} prod beacons unvalidated`);
  console.log('\n  per gated field (lowest first):');
  Object.entries(report.axes.byField).sort((a, b) => a[1] - b[1]).slice(0, 15).forEach(([f, p]) => console.log(`    ${String(p).padStart(5)}%  ${f}`));
  console.log('\n  per component (lowest first):');
  Object.entries(report.axes.byComponent).sort((a, b) => a[1] - b[1]).forEach(([k, p]) => console.log(`    ${String(p).padStart(5)}%  ${k}`));
  if (report.stuck) {
    console.log('\n  STUCK — human resolve:');
    if (Object.keys(report.stuck.failing_components).length) console.log(`    components: ${JSON.stringify(report.stuck.failing_components)}`);
    if (Object.keys(report.stuck.failing_fields).length) console.log(`    fields: ${JSON.stringify(report.stuck.failing_fields)}`);
    if (report.presence_pct < 100) console.log('    PRESENCE < 100% — an inherited field is missing from our beacon (tracker not firing it)');
  }
  console.log('');
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
