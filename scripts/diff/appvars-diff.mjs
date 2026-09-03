#!/usr/bin/env node
/**
 * scripts/diff/appvars-diff.mjs
 *
 * Data-layer parity gate for the EDS rebuild: does our migrated site expose the
 * `window.appVars` contract the Intuit clickstream / page-view tracker reads, and
 * the same block-level `data-pzn-*` click channel as live prod erp.intuit.com?
 *
 * Sibling of martech-diff.mjs — reuses the SAME hardened live navigation
 * (./live-session.mjs: Akamai/Cloudflare bot-management ladder) so a prod capture is
 * never silently measured as an "Access Denied" page.
 *
 * THREE TRUTH SOURCES (the data layer is delivered differently on prod vs EDS):
 *
 *  1. window.appVars — the page-level object. On prod erp it is ABSENT
 *     (`app_vars_enabled` is off; erp uses `window.mktg_datalayer` instead), so there
 *     is nothing on prod to diff its shape against. Instead we assert our build's
 *     appVars against the FIXED customer contract (CONTRACT below): exactly four
 *     fields — `externalContentIdentifier` (string) + `pznPageRecDetailsArr` /
 *     `pznRecDetailsArr` / `ixpDetailsArr` (REAL arrays, not JSON strings). The array
 *     typing is unit-gated in test/analytics.test.js; here we confirm the DEPLOYED
 *     build actually emits the contract.
 *
 *  2. data-pzn-* block attributes — the click channel. Present on BOTH prod (client-
 *     injected on personalized blocks) and, once wired, our build. Prod is the baseline:
 *     we diff the set of `data-pzn-*` attribute NAMES so the click-time DOM traversal
 *     keeps working. (mktg_datalayer keys are captured too, informational — we do NOT
 *     reproduce that object; the tracker was moved onto appVars only.)
 *
 *  3. page-view beacon — the `screen:viewed` POST the tracker sends. Sources 1–2 prove the data
 *     LAYER exists, not that pzn/ixp reach the wire; when prod or measured appVars proves a page is
 *     personalized, assert our build sends both fields. Closes the appVars→beacon loop.
 *
 * ENV LADDER — captured best-effort; an env we cannot measure is SKIPPED with a reason,
 * never mistaken for parity (identical model to martech-diff):
 *   prod    (baseline, public)            erp.intuit.com          appVars absent (expected)
 *   stage   (VPN-gated -> auto-SKIP)      stage.erp.intuit.com
 *   preview (our build)                   <branch>--intuit-erp--aemsites.aem.page
 *   local   (our build)                   localhost:3000
 *
 * SCOPE — report-only by default (exit 0), like martech-diff's MVP. Pass `--assert` to
 * exit non-zero when a MEASURED env fails the appVars contract (for CI once previews are
 * reliably capturable). The unit test is the always-on hard gate; this is integration.
 *
 * Usage:
 *   node scripts/diff/appvars-diff.mjs                          # all pages, all reachable envs
 *   node scripts/diff/appvars-diff.mjs --env prod,local
 *   node scripts/diff/appvars-diff.mjs --local-base http://localhost:3001
 *   node scripts/diff/appvars-diff.mjs --ours-path /drafts/home # a page that has pzn
 *   node scripts/diff/appvars-diff.mjs --baseline fixtures/appvars-homepage.golden.json
 *   node scripts/diff/appvars-diff.mjs --refresh  fixtures/appvars-homepage.golden.json
 *   node scripts/diff/appvars-diff.mjs --assert   # exit 1 on a contract failure (CI mode)
 */

/* standalone dev tool (sibling of martech-diff): CLI-style loops + argv walking by design */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, object-property-newline, max-len, no-plusplus, no-continue, prefer-destructuring, no-use-before-define */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  newLiveContext, gotoLive, dismissOverlays, launchStealthHeaded,
} from './live-session.mjs';

// --------------------------------------------------------------------------
// Config — pages and envs are DATA (same shape as martech-diff).
// --------------------------------------------------------------------------

const PAGES = [
  { name: 'homepage', prod: '/', ours: '/' },
  { name: 'construction', prod: '/construction/', ours: '/construction/' },
];

const ENVS = [
  { name: 'prod', base: 'https://erp.intuit.com', role: 'baseline' },
  { name: 'stage', base: 'https://stage.erp.intuit.com', vpn: true },
  { name: 'preview', base: 'https://main--intuit-erp--aemsites.aem.page' },
  { name: 'local', base: 'http://localhost:3000' },
];

// Pin geo/consent so behaviour is deterministic across envs (US opt-out auto-grants).
const SCENARIOS = {
  'us-optout': { AKES_GEO: 'US~CA' },
};

// The FIXED customer contract for window.appVars. `type` uses 'array' for arrays (typeof
// would say 'object'). These four — and, per the customer, only these four — are what the
// tracker reads. Keep in lockstep with the scripts.js seed + analytics.js flushAppVars.
const CONTRACT = {
  externalContentIdentifier: 'string',
  pznPageRecDetailsArr: 'array',
  pznRecDetailsArr: 'array',
  ixpDetailsArr: 'array',
};
const CONTRACT_KEYS = Object.keys(CONTRACT).sort();

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function urlFor(env, path) {
  const u = new URL(path, env.base);
  if (env.query) u.search = env.query;
  return u.toString();
}

// Runs IN the page: pull the data-layer state after load. Values are never captured —
// only field names, types, record-key shapes, and counts — so the output is env-independent
// and safe to commit as a golden.
function extractAppVarsState() {
  const typeOf = (val) => (Array.isArray(val) ? 'array' : typeof val);
  const recordKeys = (arr) => {
    if (!Array.isArray(arr)) return [];
    const keys = new Set();
    arr.forEach((r) => r && typeof r === 'object' && Object.keys(r).forEach((k) => keys.add(k)));
    return [...keys].sort();
  };
  const av = window.appVars;
  const appVars = av && typeof av === 'object'
    ? {
      present: true,
      keys: Object.keys(av).sort(),
      types: Object.fromEntries(Object.keys(av).map((k) => [k, typeOf(av[k])])),
      recordKeys: {
        pznRecDetailsArr: recordKeys(av.pznRecDetailsArr),
        pznPageRecDetailsArr: recordKeys(av.pznPageRecDetailsArr),
        ixpDetailsArr: recordKeys(av.ixpDetailsArr),
      },
      counts: {
        pznRecDetailsArr: Array.isArray(av.pznRecDetailsArr) ? av.pznRecDetailsArr.length : null,
        pznPageRecDetailsArr: Array.isArray(av.pznPageRecDetailsArr) ? av.pznPageRecDetailsArr.length : null,
        ixpDetailsArr: Array.isArray(av.ixpDetailsArr) ? av.ixpDetailsArr.length : null,
      },
    }
    : { present: false };

  // Block-level click channel: every data-pzn-* attribute NAME present + how many blocks.
  const attrNames = new Set();
  document.querySelectorAll('*').forEach((el) => {
    for (const a of el.attributes) if (/^data-pzn-/i.test(a.name)) attrNames.add(a.name.toLowerCase());
  });
  const pznBlocks = {
    count: document.querySelectorAll('[data-pzn-placement]').length,
    attrNames: [...attrNames].sort(),
  };

  // Informational only — prod erp's live page-level layer, which we deliberately do NOT
  // reproduce (the tracker was moved onto appVars). Captured so the divergence stays visible.
  const md = window.mktg_datalayer && window.mktg_datalayer.properties;
  const mktgDatalayer = md && typeof md === 'object'
    ? { present: true, keys: Object.keys(md).sort() }
    : { present: false };

  return { appVars, pznBlocks, mktgDatalayer };
}

// Check a captured appVars summary against the fixed CONTRACT.
function checkContract(appVars) {
  if (!appVars || !appVars.present) return { ok: false, reason: 'absent', missing: CONTRACT_KEYS, wrongType: [], extra: [] };
  const missing = CONTRACT_KEYS.filter((k) => !appVars.keys.includes(k));
  const wrongType = CONTRACT_KEYS
    .filter((k) => appVars.keys.includes(k) && appVars.types[k] !== CONTRACT[k])
    .map((k) => `${k}: ${appVars.types[k]} (want ${CONTRACT[k]})`);
  const extra = appVars.keys.filter((k) => !CONTRACT_KEYS.includes(k));
  return { ok: missing.length === 0 && wrongType.length === 0, reason: null, missing, wrongType, extra };
}

function setDiff(base, tgt) {
  const b = new Set(base); const t = new Set(tgt);
  return { missing: base.filter((x) => !t.has(x)), extra: tgt.filter((x) => !b.has(x)) };
}

function skipReason(e) {
  if (e.name === 'BotChallengeError') return 'bot challenge (retry --headed)';
  if (e.name === 'LiveHTTPError') return `HTTP ${e.status}`;
  if (/timeout/i.test(e.message)) return 'timeout (unreachable — VPN? server down?)';
  if (/ERR_|ECONNREFUSED|ENOTFOUND|net::/i.test(e.message)) return 'unreachable (VPN? server down?)';
  return e.message.split('\n')[0];
}

// --------------------------------------------------------------------------
// Page-view beacon capture: the clickstream "page" POST, to verify pzn/ixp reach the wire
// (the appVars shape-check alone can't — that's the gap that shipped).
// --------------------------------------------------------------------------
const CLICKSTREAM_RE = /eventbus\.intuit\.com|api\.segment\.io|collect\.tealiumiq\.com/i;

// Fills & returns an array of captured "page" events. Attach BEFORE navigation. Bodies may be a
// single event or a batch.
function attachPageBeaconCapture(pg) {
  const events = [];
  pg.on('request', (req) => {
    try {
      if (req.method() !== 'POST' || !CLICKSTREAM_RE.test(req.url())) return;
      const body = req.postData();
      if (!body) return;
      let parsed;
      try { parsed = JSON.parse(body); } catch { return; }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const ev of list) if (ev && ev.type === 'page') events.push(ev);
    } catch { /* ignore a body we can't read */ }
  });
  return events;
}

// Reduce captured page events to names/shape/counts only (env-independent, golden-safe).
export function summarizePageBeacon(events) {
  if (!events || !events.length) return { present: false };
  // The last captured page call is the final state. Picking an earlier enriched call could hide a
  // later sender rebuild that stripped the fields this harness exists to verify.
  const representative = events.at(-1);
  const props = representative.properties || {};
  const pd = props.personalization_details;
  let pdCount = -1; // -1 = present but not an array (unexpected)
  if (Array.isArray(pd)) pdCount = pd.length;
  else if (pd == null) pdCount = 0;
  const pdRecordKeys = Array.isArray(pd) && pd[0] && typeof pd[0] === 'object' ? Object.keys(pd[0]).sort() : [];
  return {
    present: true,
    count: events.length,
    hasPdKey: Object.prototype.hasOwnProperty.call(props, 'personalization_details'),
    pdCount,
    pdRecordKeys,
    hasExperimentIds: typeof props.experiment_ids === 'string' && props.experiment_ids.trim().length > 0,
  };
}

// Human-readable description of a captured beacon's personalization_details state.
function describePd(pb) {
  if (pb.pdCount > 0) return `${pb.pdCount} record(s) [${pb.pdRecordKeys.join(', ')}]`;
  if (pb.hasPdKey) return 'present but empty';
  return 'ABSENT';
}

// Require page-view PZN/IXP whenever prod or the measured runtime proves they should be present.
export function checkPageBeacon(cap, baseline) {
  const base = baseline && baseline.status === 'OK' ? baseline.pageBeacon : null;
  const prodHasPd = base && base.present && base.pdCount > 0;
  const prodHasIxp = !!(base && base.present && base.hasExperimentIds);
  const counts = cap?.appVars?.counts || {};
  const appVarsPdCount = counts.pznPageRecDetailsArr > 0
    ? counts.pznPageRecDetailsArr
    : (counts.pznRecDetailsArr || 0);
  const appVarsIxpCount = counts.ixpDetailsArr || 0;
  const expectedPdCount = Math.max(prodHasPd ? base.pdCount : 0, appVarsPdCount);
  const expectsPzn = expectedPdCount > 0;
  const expectsIxp = prodHasIxp || appVarsIxpCount > 0;
  if (!expectsPzn && !expectsIxp) return { relevant: false };
  const ours = cap.pageBeacon;
  const pznOk = !expectsPzn
    || !!(ours && ours.present && ours.hasPdKey && ours.pdCount > 0);
  const ixpOk = !expectsIxp || !!(ours && ours.present && ours.hasExperimentIds);
  return {
    relevant: true,
    ok: pznOk && ixpOk,
    expectsPzn,
    expectsIxp,
    pznOk,
    ixpOk,
    expectedPdCount,
    prodPdCount: prodHasPd ? base.pdCount : 0,
    appVarsPdCount,
    appVarsIxpCount,
    oursPresent: !!(ours && ours.present),
    ours,
  };
}

// --------------------------------------------------------------------------
// Capture one env x page x scenario. Best-effort: any failure to MEASURE returns SKIPPED.
// --------------------------------------------------------------------------

async function captureEnv({ browser, env, page, scenario, opts }) {
  const path = env.role === 'baseline' ? page.prod : (opts.oursPath || page.ours);
  const url = urlFor(env, path);
  const cfg = SCENARIOS[scenario];
  const context = await newLiveContext(browser, {});
  try {
    if (cfg.AKES_GEO) await context.addCookies([{ name: 'AKES_GEO', value: cfg.AKES_GEO, url: env.base }]);
    if (opts.cookies.length) await context.addCookies(opts.cookies.map((c) => ({ ...c, url: env.base })));
    const pg = await context.newPage();
    // Attach BEFORE navigation so the (late, consent-gated) initial page view is caught.
    const pageEvents = attachPageBeaconCapture(pg);

    let resp;
    try {
      resp = await gotoLive(pg, url, {
        waitUntil: 'domcontentloaded', timeoutMs: 45000, settleMs: 0,
        httpError: 'measure', solveWindow: opts.headed,
      });
    } catch (e) {
      return { status: 'SKIPPED', reason: skipReason(e), url };
    }
    if (resp && resp.status() >= 400) return { status: 'SKIPPED', reason: `HTTP ${resp.status()} (page not deployed?)`, url };

    await dismissOverlays(pg).catch(() => {});
    // Let eager build + pzn/ixp decisions settle (they resolve across eager + lazy).
    await pg.waitForTimeout(opts.settleMs);
    const state = await pg.evaluate(extractAppVarsState).catch(() => null);
    if (!state) return { status: 'SKIPPED', reason: 'could not read page state', url };
    return { status: 'OK', url, ...state, pageBeacon: summarizePageBeacon(pageEvents) };
  } finally {
    await context.close().catch(() => {});
  }
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function renderBaseline(cap) {
  const lines = [];
  if (!cap || cap.status !== 'OK') { lines.push(`${R('NO BASELINE')} — prod unavailable; the data-pzn-* channel can't be diffed`); return lines; }
  const av = cap.appVars.present
    ? Y(`appVars PRESENT (${cap.appVars.keys.length} keys) — unexpected on erp (app_vars_enabled was off)`)
    : G('appVars absent (app_vars_enabled off — expected on erp)');
  lines.push(`${'baseline'.padEnd(8)} ${av}`);
  lines.push(`${' '.repeat(9)}${DIM(`data-pzn blocks: ${cap.pznBlocks.count} · attrs: [${cap.pznBlocks.attrNames.join(', ') || '(none)'}]`)}`);
  const pb = cap.pageBeacon;
  const pbStr = pb && pb.present
    ? `page-view beacon: personalization_details ${describePd(pb)}${pb.hasExperimentIds ? ' · experiment_ids ✓' : ''}`
    : 'page-view beacon: not captured';
  lines.push(`${' '.repeat(9)}${DIM(pbStr)}`);
  lines.push(`${' '.repeat(9)}${DIM(`mktg_datalayer: ${cap.mktgDatalayer.present ? `${cap.mktgDatalayer.keys.length} keys (informational — not reproduced)` : 'absent'}`)}`);
  return lines;
}

function renderOurs(env, cap, baseline, problems) {
  const tag = env.name.padEnd(8);
  if (!cap) return null;
  if (cap.status === 'SKIPPED') return `${tag} ${DIM('SKIPPED')}  ${DIM(cap.reason)}`;
  const lines = [];
  const c = checkContract(cap.appVars);
  // 1. appVars contract
  if (c.ok) {
    const extra = c.extra.length ? Y(` (+extra: ${c.extra.join(', ')})`) : '';
    lines.push(`${tag} ${G('CONTRACT ✓')}  appVars has the 4 fields, types ok${extra}`);
  } else {
    problems.push(`${env.name}: ${cap.appVars.present ? 'appVars contract' : 'window.appVars ABSENT'}`);
    const parts = [];
    if (!cap.appVars.present) parts.push('window.appVars ABSENT (built in loadEager — did martech/appvars run?)');
    if (c.missing.length) parts.push(`missing: [${c.missing.join(', ')}]`);
    if (c.wrongType.length) parts.push(`wrong type: [${c.wrongType.join('; ')}]`);
    lines.push(`${tag} ${R('CONTRACT ✗')}  ${parts.join(' · ')}`);
  }
  // 2. data-pzn-* block channel vs prod baseline
  if (baseline && baseline.status === 'OK' && baseline.pznBlocks.attrNames.length) {
    const d = setDiff(baseline.pznBlocks.attrNames, cap.pznBlocks.attrNames);
    if (d.missing.length) {
      lines.push(`${' '.repeat(9)}${R(`data-pzn channel GAP: prod stamps [${d.missing.join(', ')}] — our build stamps none/fewer (click tracking needs these)`)}`);
    } else {
      lines.push(`${' '.repeat(9)}${G(`data-pzn channel ✓ (${cap.pznBlocks.count} blocks)`)}`);
    }
    if (d.extra.length) lines.push(`${' '.repeat(9)}${Y(`extra data-pzn attrs: [${d.extra.join(', ')}]`)}`);
  } else {
    lines.push(`${' '.repeat(9)}${DIM(`data-pzn blocks: ${cap.pznBlocks.count} (no prod baseline attrs to diff)`)}`);
  }
  // 3. page-view beacon: does personalization_details actually REACH the screen:viewed event?
  //    (appVars shape ✓ is necessary but not sufficient — this closes the loop to the beacon.)
  const pv = checkPageBeacon(cap, baseline);
  if (pv.relevant) {
    if (pv.ok) {
      const details = [];
      if (pv.expectsPzn) details.push(`personalization_details: ${pv.ours.pdCount} record(s)`);
      if (pv.expectsIxp) details.push('experiment_ids ✓');
      lines.push(`${' '.repeat(9)}${G(`page-view pzn/ixp ✓ (${details.join(' · ')})`)}`);
    } else {
      const gaps = [];
      if (!pv.pznOk) {
        let why = 'no page-view beacon captured';
        if (pv.oursPresent) why = pv.ours.hasPdKey ? 'personalization_details present but empty' : 'personalization_details ABSENT from the event';
        const source = pv.prodPdCount
          ? `prod fires ${pv.prodPdCount}`
          : `appVars contains ${pv.appVarsPdCount}`;
        gaps.push(`${source} personalization record(s), our page-view has none (${why})`);
      }
      if (!pv.ixpOk) gaps.push(`experiment_ids ABSENT (appVars contains ${pv.appVarsIxpCount} IXP record(s))`);
      problems.push(`${env.name}: page-view beacon PZN/IXP gap: ${gaps.join('; ')}`);
      lines.push(`${' '.repeat(9)}${R(`page-view pzn/ixp GAP: ${gaps.join(' · ')}`)}`);
    }
  }
  return lines.join('\n');
}

function renderPage(page, scenario, captures, baseline, baselineSource, problems) {
  const lines = [];
  lines.push(`\n${'━'.repeat(78)}`);
  lines.push(`PAGE  ${page.name}   ·   consent=${scenario}   ·   baseline=${baselineSource}`);
  lines.push('━'.repeat(78));
  renderBaseline(baseline).forEach((l) => lines.push(l));
  for (const env of ENVS) {
    const cap = captures[env.name];
    if (!cap) continue;
    if (env.role === 'baseline') continue; // shown above
    const rendered = renderOurs(env, cap, baseline, problems);
    if (rendered) lines.push(rendered);
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    pages: null, envs: null, scenario: 'us-optout', headed: false, settleMs: 9000,
    json: null, baseline: null, refresh: null, cookies: [], oursPath: null, assert: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--page') opts.pages = argv[++i].split(',');
    else if (a === '--env') opts.envs = argv[++i].split(',');
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--headed') opts.headed = true;
    else if (a === '--settle') opts.settleMs = Number(argv[++i]);
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--cookie') { const [n, ...v] = argv[++i].split('='); opts.cookies.push({ name: n, value: v.join('=') }); }
    else if (a === '--ours-path') opts.oursPath = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--refresh') opts.refresh = argv[++i];
    else if (a === '--assert') opts.assert = true;
    else if (a === '--preview-base') ENVS.find((e) => e.name === 'preview').base = argv[++i];
    else if (a === '--local-base') ENVS.find((e) => e.name === 'local').base = argv[++i];
  }
  return opts;
}

function loadGolden(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

async function main() {
  const opts = parseArgs(process.argv);
  const pages = PAGES.filter((p) => !opts.pages || opts.pages.includes(p.name));
  const envs = ENVS.filter((e) => !opts.envs || opts.envs.includes(e.name));
  const scenario = opts.scenario;

  const golden = loadGolden(opts.baseline);
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  const report = { scenario, capturedAt: new Date().toISOString(), pages: {} };
  const goldenOut = { scenario, capturedAt: new Date().toISOString(), pages: {} };
  const problems = [];
  try {
    for (const page of pages) {
      const captures = {};
      for (const env of envs) {
        process.stderr.write(DIM(`  capturing ${page.name} @ ${env.name} …\n`));
        captures[env.name] = await captureEnv({ browser, env, page, scenario, opts });
      }
      report.pages[page.name] = captures;

      let baseline; let baselineSource;
      if (captures.prod && captures.prod.status === 'OK') { baseline = captures.prod; baselineSource = 'prod(live)'; }
      else if (golden && golden.pages && golden.pages[page.name]) { baseline = golden.pages[page.name]; baselineSource = `golden(${opts.baseline})`; }
      else { baseline = captures.prod || null; baselineSource = 'prod(unavailable)'; }

      if (baseline && baseline.status === 'OK') goldenOut.pages[page.name] = baseline;
      process.stdout.write(`${renderPage(page, scenario, captures, baseline, baselineSource, problems)}\n`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (opts.refresh) { writeFileSync(opts.refresh, JSON.stringify(goldenOut, null, 2)); process.stdout.write(`${DIM(`wrote golden baseline → ${opts.refresh}`)}\n`); }
  if (opts.json) { writeFileSync(opts.json, JSON.stringify(report, null, 2)); process.stdout.write(`${DIM(`wrote ${opts.json}`)}\n`); }

  if (opts.assert && problems.length) {
    process.stdout.write(`\n${R(`FAIL — data-layer parity broke on a measured env (appVars contract and/or page-view beacon): ${problems.join('; ')}`)}\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${DIM('report-only (exit 0). Pass --assert to fail CI on a measured contract break.')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`appvars-diff error: ${e.message}\n`); process.exit(1); });
}
