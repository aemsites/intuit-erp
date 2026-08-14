#!/usr/bin/env node
/**
 * scripts/diff/martech-diff.mjs
 *
 * Martech parity gate for the 1:1 rebuild: does our migrated EDS site fire the
 * SAME martech as the live prod erp.intuit.com, page-for-page? Built as a
 * sibling of content-diff / visual-diff — it reuses the SAME hardened live
 * navigation (../diff/live-session.mjs: Akamai/Cloudflare bot-management ladder)
 * so a prod capture is never silently measured as an "Access Denied" page.
 *
 * MODEL — normalized golden-master diff, not exact match. Exact URLs can't match
 * (env path `.../ies-erp/prod/...` vs `.../dev/...`, per-load visitor/trace IDs,
 * cache-busters, timestamps). So each captured page is reduced to three
 * ENV-INDEPENDENT sets and those are diffed:
 *   - vendors : which martech vendors fired a network call (GA4, Google Ads,
 *               Facebook, Bing, LinkedIn, Marketo, Tealium collect, ...)
 *   - tagUids : which Tealium `utag.N.js` tag templates loaded (N is profile-
 *               assigned, identical across prod/dev publishes)
 *   - udoKeys : the KEYS present on `window.utag_data` (data-layer shape, not
 *               values — values legitimately differ per page/visit)
 *
 * ENV LADDER — captured best-effort; the report shows where the parity cliff is:
 *   prod    (baseline, public)            erp.intuit.com
 *   stage   (VPN-gated → auto-SKIP)       stage.erp.intuit.com
 *   preview (dev-env martech)             <branch>--intuit-erp--aemsites.aem.page
 *   local   (dev + local vendor copies)   localhost:3000/...?martech=local
 * An env we cannot measure (stage off-VPN, local server down, hard bot block) is
 * reported as SKIPPED with a reason — NEVER as parity. A GAP means we measured
 * the env and a set differed. So the same command degrades per operator: prod +
 * preview for anyone; stage only on VPN.
 *
 * SCOPE (MVP) — report-only (exit 0). Once real gaps are triaged apart from
 * Tealium profile/env drift, phase 2 adds allowlist assertions (must-fire
 * vendors + must-have UDO keys) and per-vendor param comparison.
 *
 * Usage:
 *   node scripts/diff/martech-diff.mjs                       # all pages, all reachable envs
 *   node scripts/diff/martech-diff.mjs --page homepage       # one page
 *   node scripts/diff/martech-diff.mjs --env prod,preview    # subset of envs
 *   node scripts/diff/martech-diff.mjs --preview-base https://<branch>--intuit-erp--aemsites.aem.page
 *   node scripts/diff/martech-diff.mjs --local-base http://localhost:3001
 *   node scripts/diff/martech-diff.mjs --headed     # stealth real Chrome (past a bot block)
 *   node scripts/diff/martech-diff.mjs --json out.json  # also write the raw capture+diff
 *   node scripts/diff/martech-diff.mjs --refresh scripts/diff/fixtures/martech-homepage.golden.json
 */

/* standalone dev tool (sibling of content-diff): CLI-style loops + argv walking by design */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, object-property-newline, max-len, no-plusplus, newline-per-chained-call, no-continue, no-multi-spaces, prefer-destructuring, no-use-before-define */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  newLiveContext, gotoLive, dismissOverlays, launchStealthHeaded,
} from './live-session.mjs';

// --------------------------------------------------------------------------
// Config — pages and envs are DATA. Adding the 2 customer-chosen pages later is
// one line each; the prod path and our path are kept separate in case they ever
// diverge (they shouldn't, for a 1:1 rebuild).
// --------------------------------------------------------------------------

const PAGES = [
  { name: 'homepage', prod: '/', ours: '/' },
  // { name: '<tbd-1>', prod: '/<path>', ours: '/<path>' },   // customer-chosen
  // { name: '<tbd-2>', prod: '/<path>', ours: '/<path>' },   // customer-chosen
];

const ENVS = [
  { name: 'prod', base: 'https://erp.intuit.com', role: 'baseline' },
  { name: 'stage', base: 'https://stage.erp.intuit.com', vpn: true },
  { name: 'preview', base: 'https://main--intuit-erp--aemsites.aem.page' },
  // Captures the site's NATURAL martech (dev-CDN Tealium, like preview/stage). To instead force
  // the local vendor copies, pass `--ours-path '/?martech=local'`. Auth for a gated homepage lives
  // in `aem up` (server-side proxy), so the harness itself stays cookie-free.
  { name: 'local', base: 'http://localhost:3000' },
];

// Pin geo/consent so tag-gating is deterministic across envs. On a fresh context
// the US opt-out posture auto-grants consent, so tags fire on all four rungs.
const SCENARIOS = {
  'us-optout': { AKES_GEO: 'US~CA' },
  // 'eea-consented': needs a pre-granted CONSENTMGR/OptanonConsent cookie — phase 2.
};

// Martech/tracking vendors, matched against every outgoing request URL. The
// canonical unit of parity is "which of these fired". Extend during triage.
const VENDORS = [
  ['tealium-collect', /collect\.tealiumiq\.com/i],
  ['tealium-lib', /tags\.tiqcdn\.com/i],
  ['ga4', /google-analytics\.com|analytics\.google\.com|\/(g|j|r)\/collect/i],
  ['gtm', /googletagmanager\.com/i],
  ['google-ads', /googleadservices\.com|googlesyndication\.com|adservice\.google\.|google\.[a-z.]+\/pagead|\/pagead\/1p-user-list/i],
  ['doubleclick', /doubleclick\.net|\.g\.doubleclick/i],
  ['facebook', /facebook\.com\/tr|connect\.facebook\.net/i],
  ['bing', /bat\.bing\.com/i],
  ['linkedin', /px\.ads\.linkedin\.com|snap\.licdn\.com|\.linkedin\.com\//i],
  ['twitter-x', /ads-twitter\.com|analytics\.twitter\.com|t\.co\/i\/adsct/i],
  ['reddit', /\.reddit\.com|redditstatic\.com\/ads/i],
  ['marketo', /mktoresp\.com|munchkin\.marketo|marketo\.com/i],
  ['adobe-analytics', /\.sc\.omtrdc\.net|\.2o7\.net/i],
  ['adobe-audience', /demdex\.net/i],
  ['adobe-target', /\.tt\.omtrdc\.net/i],
  ['fullstory', /fullstory\.com|fullstory/i], // prod self-hosts it (lib.intuitcdn.net/…fullstory…)
  ['liveperson', /liveperson\.net|lpsnmedia\.net|\.liveperson\./i],
  ['zoominfo', /zoominfo\.com|ws\.zoominfo|zi-scripts\.com/i],
  ['merkle-rkd', /rkdms\.com/i],
  ['securedvisit', /securedvisit\.com/i],
  ['6sense', /6sc\.co|6sense\.com/i],
  ['qualtrics', /qualtrics\.com|\.siteintercept\./i],
  ['segment', /cdn\.segment\.com|api\.segment\.io|segment\.intuitcdn\.net/i], // prod self-hosts Segment
  ['hotjar', /hotjar\.com/i],
  ['ms-clarity', /clarity\.ms/i],
  // Added after auditing prod's actual third-party set (was badly undercounted):
  ['o11y-rum', /rum\.api\.intuit\.com/i], // Intuit Observability RUM (prod-only in the dev profile)
  ['mpulse', /go-mpulse\.net|akstat\.io/i], // Akamai mPulse RUM
  ['demandbase', /demandbase\.com|company-target\.com/i],
  ['nielsen', /imrworldwide\.com/i],
  ['trustarc', /trustarc\.com/i],
  ['trade-desk', /adsrvr\.org/i],
  ['appnexus-xandr', /adnxs\.com/i],
  ['rubicon-magnite', /rubiconproject\.com/i],
  ['liveramp', /rlcdn\.com/i],
  ['bombora', /ml314\.com/i],
  ['casale-index', /casalemedia\.com/i],
  ['dotomi-conversant', /dotomi\.com/i],
  ['tremor', /tremorhub\.com/i],
  ['openai', /\.openai\.com/i],
];

const UTAG_TAG_RE = /tags\.tiqcdn\.com\/utag\/intuit\/ies-erp\/[a-z0-9]+\/utag\.(\d+)\.js/i;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function classifyVendor(url) {
  for (const [name, re] of VENDORS) if (re.test(url)) return name;
  return null;
}

function hostFromUrl(u) { try { return new URL(u).host; } catch { return ''; } }

// First-party / infra / static-asset hosts — NOT "unclassified third-party martech".
function isInfraHost(h, pageHost) {
  if (h && h === pageHost) return true;
  return /(^|\.)(intuit\.com|intuitcdn\.net|tiqcdn\.com|akamaized\.net|akamaihd\.net)$/i.test(h)
    || /(^|\.)(aem|hlx)\.(live|page)$/i.test(h) || /(^|\.)?localhost$/i.test(h)
    || /(^|\.)(gstatic\.com|googleapis\.com|jsdelivr\.net|unpkg\.com|cloudfront\.net|cloudflareinsights\.com)$/i.test(h);
}

// Authoritative load-mechanism per vendor (from the reverse-engineered martech inventory + probe):
// on erp.intuit.com EVERY martech vendor is injected by the single Tealium tag manager EXCEPT
// Akamai edge (mPulse) and authored page embeds (a TrustArc seal). So a MISSING vendor is an
// "ok gap" — a Tealium tag the dev/e2e profile excludes, or infra we don't run — UNLESS it is
// page-authored. Anything not listed here defaults to 'tealium' (this site's overwhelming case).
const LOAD_CLASS = {
  mpulse: 'edge', // Akamai Boomerang, injected by the edge — appears once behind Akamai
  trustarc: 'authored', // TrustArc privacy-seal badge embedded in the page → LOOK INTO
  'tealium-lib': 'infra', // the utag loader itself — both sides load it
  'tealium-collect': 'infra',
  // Programmatic DSP cookie-syncs — fire downstream of the ad tags, a different subset each load
  // (per the martech inventory: "catalog entries that fire only via downstream DSP cookie-syncing").
  // Nondeterministic, so reported for completeness but NOT treated as parity gaps.
  'casale-index': 'dsp-sync',
  'rubicon-magnite': 'dsp-sync',
  'appnexus-xandr': 'dsp-sync',
  tremor: 'dsp-sync',
  'dotomi-conversant': 'dsp-sync',
};
const classOf = (v) => LOAD_CLASS[v] || 'tealium';

function urlFor(env, path) {
  const u = new URL(path, env.base);
  if (env.query) u.search = env.query;
  return u.toString();
}

// Runs IN the page: pull Tealium's own view of the world after load. The parity
// signal is the runtime `utag.data` (the merged UDO tags actually read), MINUS
// Tealium's own internal/mirror namespaces (dom.* page context, cp.* cookie
// mirrors, ut.* loader internals, qp.* query params, ss.* session-storage
// mirrors) which are volatile and not
// authored data-layer. `window.utag_data` is the sparse author layer, kept for
// reference only.
function extractUtagState() {
  const u = window.utag;
  if (!u) return { utagLoaded: false, cfgSendCount: 0, udoKeys: [], udoAuthorKeys: [], consentState: null };
  const cfg = (u.loader && u.loader.cfg) || {};
  const cfgSendCount = Object.keys(cfg).filter((id) => cfg[id] && cfg[id].send).length;
  const INTERNAL = /^(dom|cp|ut|qp|ss)\./;
  // `meta.hlx:*` is EDS/aem-cli internal (e.g. hlx:proxyUrl injected by a local `aem up`),
  // never authored data-layer — drop it so local captures aren't flagged against prod.
  const ARTIFACT = /hlx:/;
  const runtime = u.data || {};
  const udoKeys = Object.keys(runtime).filter((k) => !INTERNAL.test(k) && !ARTIFACT.test(k)).sort();
  const udoAuthorKeys = window.utag_data ? Object.keys(window.utag_data).sort() : [];
  const consentState = (u.gdpr && typeof u.gdpr.getConsentState === 'function')
    ? u.gdpr.getConsentState() : null;
  return { utagLoaded: true, cfgSendCount, udoKeys, udoAuthorKeys, consentState };
}

// --------------------------------------------------------------------------
// Capture one env × page × scenario. Best-effort: any failure to MEASURE (bot
// block, unreachable host, HTTP error) returns { status: 'SKIPPED', reason }.
// --------------------------------------------------------------------------

async function captureEnv({ browser, env, page, scenario, opts }) {
  const path = env.role === 'baseline' ? page.prod : (opts.oursPath || page.ours);
  const url = urlFor(env, path);
  const cfg = SCENARIOS[scenario];

  const context = await newLiveContext(browser, {});
  const vendors = new Set();
  const tagUids = new Set();
  // Completeness net: any third-party host that matches NO vendor pattern is recorded so nothing is
  // silently dropped from the golden — the operator reviews these and either adds a vendor pattern
  // or confirms it's noise. (Load-mechanism classification is authoritative via LOAD_CLASS, not a
  // per-run initiator heuristic — CDP initiator attribution is unreliable for cookie-sync pixels.)
  const unclassifiedHosts = new Set();
  const pageHost = (() => { try { return new URL(env.base).host; } catch { return ''; } })();
  try {
    if (cfg.AKES_GEO) {
      await context.addCookies([{ name: 'AKES_GEO', value: cfg.AKES_GEO, url: env.base }]);
    }
    if (opts.cookies.length) {
      await context.addCookies(opts.cookies.map((c) => ({ ...c, url: env.base })));
    }
    const pg = await context.newPage();
    pg.on('request', (req) => {
      const ru = req.url();
      const v = classifyVendor(ru);
      if (v) vendors.add(v);
      const m = ru.match(UTAG_TAG_RE);
      if (m) tagUids.add(Number(m[1]));
      if (!v) {
        const h = hostFromUrl(ru);
        if (h && !isInfraHost(h, pageHost)) unclassifiedHosts.add(h);
      }
    });

    let resp;
    try {
      resp = await gotoLive(pg, url, {
        waitUntil: 'domcontentloaded', timeoutMs: 45000, settleMs: 0,
        httpError: 'measure', solveWindow: opts.headed,
      });
    } catch (e) {
      return { status: 'SKIPPED', reason: skipReason(e), url };
    }
    if (resp && resp.status() >= 400) {
      return { status: 'SKIPPED', reason: `HTTP ${resp.status()} (page not deployed?)`, url };
    }

    await dismissOverlays(pg).catch(() => {});
    // Let eager/lazy/delayed + tag pixels fire (delayed phase is ~3s).
    await pg.waitForTimeout(opts.settleMs);
    const state = await pg.evaluate(extractUtagState).catch(() => ({ utagLoaded: false, udoKeys: [], udoAuthorKeys: [], consentState: null }));

    return {
      status: 'OK',
      url,
      utagLoaded: state.utagLoaded,
      consentState: state.consentState,
      cfgSendCount: state.cfgSendCount,
      vendors: [...vendors].sort(),
      tagUids: [...tagUids].sort((a, b) => a - b),
      udoKeys: state.udoKeys,
      udoAuthorKeys: state.udoAuthorKeys,
      unclassifiedHosts: [...unclassifiedHosts].sort(),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function skipReason(e) {
  if (e.name === 'BotChallengeError') return 'bot challenge (retry --headed)';
  if (e.name === 'LiveHTTPError') return `HTTP ${e.status}`;
  if (/timeout/i.test(e.message)) return 'timeout (unreachable — VPN? server down?)';
  if (/ERR_|ECONNREFUSED|ENOTFOUND|net::/i.test(e.message)) return 'unreachable (VPN? server down?)';
  return e.message.split('\n')[0];
}

// --------------------------------------------------------------------------
// Diff an env capture against the prod baseline (same page + scenario).
// missing = in prod, NOT in env  → the regressions that matter.
// extra   = in env, NOT in prod  → test-env noise or newly-added tags.
// --------------------------------------------------------------------------

function setDiff(base, tgt) {
  const b = new Set(base); const t = new Set(tgt);
  return { missing: base.filter((x) => !t.has(x)), extra: tgt.filter((x) => !b.has(x)) };
}

function diffAgainstBaseline(baseline, target) {
  return {
    vendors: setDiff(baseline.vendors, target.vendors),
    tagUids: setDiff(baseline.tagUids, target.tagUids),
    udoKeys: setDiff(baseline.udoKeys, target.udoKeys),
  };
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function fmtDiff(label, d) {
  const parts = [];
  if (d.missing.length) parts.push(R(`missing ${label}: [${d.missing.join(', ')}]`));
  if (d.extra.length) parts.push(Y(`extra ${label}: [${d.extra.join(', ')}]`));
  return parts;
}

// Missing vendors split by authoritative LOAD_CLASS: page-authored → a real gap to LOOK INTO;
// Tealium-injected / Akamai-edge / loader-infra → "ok gaps" per the martech inventory.
function fmtVendorDiff(d) {
  const parts = [];
  const g = { authored: [], tealium: [], edge: [], infra: [], 'dsp-sync': [] };
  d.missing.forEach((v) => { (g[classOf(v)] || g.tealium).push(v); });
  if (g.authored.length) parts.push(R(`missing vendors [page-authored on prod → LOOK INTO]: [${g.authored.join(', ')}]`));
  if (g.tealium.length) parts.push(Y(`missing vendors [Tealium-injected → dev-profile diff, ok gap]: [${g.tealium.join(', ')}]`));
  if (g.edge.length) parts.push(DIM(`missing vendors [Akamai/CDN edge-injected → ok gap]: [${g.edge.join(', ')}]`));
  if (g['dsp-sync'].length) parts.push(DIM(`missing [downstream DSP cookie-sync — nondeterministic, informational]: [${g['dsp-sync'].join(', ')}]`));
  if (g.infra.length) parts.push(DIM(`missing [Tealium loader]: [${g.infra.join(', ')}]`));
  // extras are likewise split so nondeterministic DSP syncs don't read as real additions.
  const ex = { real: [], 'dsp-sync': [] };
  d.extra.forEach((v) => { (classOf(v) === 'dsp-sync' ? ex['dsp-sync'] : ex.real).push(v); });
  if (ex.real.length) parts.push(Y(`extra vendors: [${ex.real.join(', ')}]`));
  if (ex['dsp-sync'].length) parts.push(DIM(`extra [DSP cookie-sync — nondeterministic]: [${ex['dsp-sync'].join(', ')}]`));
  return parts;
}

function renderPage(page, scenario, captures, baseline, baselineSource) {
  const lines = [];
  lines.push(`\n${'━'.repeat(78)}`);
  lines.push(`PAGE  ${page.name}   ·   consent=${scenario}   ·   baseline=${baselineSource}`);
  lines.push('━'.repeat(78));

  // Baseline summary (once), from the resolved baseline — live prod or committed golden.
  if (baseline && baseline.status === 'OK') {
    lines.push(`${'baseline'.padEnd(8)} ${G(baselineSource)}  ${baseline.vendors.length} vendors · ${baseline.tagUids.length} tag-uids · ${baseline.udoKeys.length} udo-keys`);
    lines.push(`${' '.repeat(9)}${DIM(`vendors: ${baseline.vendors.join(', ') || '(none)'}`)}`);
    if (baseline.unclassifiedHosts && baseline.unclassifiedHosts.length) {
      lines.push(`${' '.repeat(9)}${Y(`unclassified 3rd-party (add a vendor pattern or confirm noise): ${baseline.unclassifiedHosts.join(', ')}`)}`);
    }
    if (baseline.udoKeys.length) lines.push(`${' '.repeat(9)}${DIM(`udo-keys: ${baseline.udoKeys.join(', ')}`)}`);
  } else {
    lines.push(`${R('NO BASELINE')} — ${baselineSource} unavailable; envs captured below cannot be diffed`);
  }

  for (const env of ENVS) {
    const cap = captures[env.name];
    if (!cap) continue;
    const tag = `${env.name.padEnd(8)}`;
    if (cap.status === 'SKIPPED') { lines.push(`${tag} ${DIM('SKIPPED')}  ${DIM(cap.reason)}`); continue; }
    // prod (when captured live) IS the baseline shown above — don't re-diff it against itself.
    if (env.role === 'baseline') { lines.push(`${tag} ${DIM('(captured live — shown as baseline above)')}`); continue; }
    if (!baseline || baseline.status !== 'OK') { lines.push(`${tag} captured, but no baseline to diff against`); continue; }
    if (!cap.utagLoaded) { lines.push(`${tag} ${R('GAP')}  utag never loaded (martech not firing here)`); continue; }
    const d = diffAgainstBaseline(baseline, cap);
    const flags = [...fmtVendorDiff(d.vendors), ...fmtDiff('tag-uids', d.tagUids), ...fmtDiff('udo-keys', d.udoKeys)];
    if (!flags.length) {
      lines.push(`${tag} ${G('PARITY')}  matches baseline (${cap.vendors.length} vendors, ${cap.tagUids.length} tag-uids, ${cap.udoKeys.length} udo-keys)`);
    } else {
      lines.push(`${tag} ${R('GAP')}  ${DIM(`(${cap.vendors.length} vendors, ${cap.tagUids.length} tag-uids, ${cap.udoKeys.length} udo-keys)`)}`);
      for (const f of flags) lines.push(`${' '.repeat(9)}${f}`);
    }
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    pages: null, envs: null, scenario: 'us-optout', headed: false, settleMs: 6000,
    json: null, baseline: null, refresh: null, cookies: [], oursPath: null,
  };
  // Default settle spans the EDS delayed phase (~3s) + tag fan-out so delayed-phase, self-hosted
  // vendors (FullStory, LivePerson) are captured; both baseline and compared env use the same value.
  opts.settleMs = 9000;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--page') opts.pages = argv[++i].split(',');
    else if (a === '--env') opts.envs = argv[++i].split(',');
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--headed') opts.headed = true;
    else if (a === '--settle') opts.settleMs = Number(argv[++i]);
    else if (a === '--json') opts.json = argv[++i];
    // --cookie 'name=value' (repeatable): auth cookie for the gated our-build envs
    // (aem.page/aem.live previews are access-controlled), added on that env's origin.
    else if (a === '--cookie') { const [n, ...v] = argv[++i].split('='); opts.cookies.push({ name: n, value: v.join('=') }); }
    // --ours-path <path>: override the our-build path for this run (e.g. point local at a
    // disk-served draft that fires martech, sidestepping the auth-gated homepage proxy).
    else if (a === '--ours-path') opts.oursPath = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i]; // load prod golden from file (skip live prod)
    else if (a === '--refresh') opts.refresh = argv[++i]; // capture prod live and (re)write the golden here
    else if (a === '--preview-base') ENVS.find((e) => e.name === 'preview').base = argv[++i];
    else if (a === '--local-base') ENVS.find((e) => e.name === 'local').base = argv[++i];
  }
  return opts;
}

// A golden file stores the prod baseline capture per page (normalized sets only —
// no IDs, no values — so it is safe to commit and read like a fixture).
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
  try {
    for (const page of pages) {
      const captures = {};
      for (const env of envs) {
        process.stderr.write(DIM(`  capturing ${page.name} @ ${env.name} …\n`));
        // eslint-disable-next-line no-await-in-loop
        captures[env.name] = await captureEnv({ browser, env, page, scenario, opts });
      }
      report.pages[page.name] = captures;

      // Resolve the baseline: live prod capture wins; otherwise the committed golden.
      let baseline; let baselineSource;
      if (captures.prod && captures.prod.status === 'OK') { baseline = captures.prod; baselineSource = 'prod(live)'; }
      else if (golden && golden.pages && golden.pages[page.name]) { baseline = golden.pages[page.name]; baselineSource = `golden(${opts.baseline})`; }
      else { baseline = captures.prod || null; baselineSource = 'prod(unavailable)'; }

      if (baseline && baseline.status === 'OK') goldenOut.pages[page.name] = baseline;
      process.stdout.write(`${renderPage(page, scenario, captures, baseline, baselineSource)}\n`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  process.stdout.write(`\n${DIM('report-only — exit 0. Triage GAPs vs Tealium profile/env drift, then enable phase-2 allowlist assertions.')}\n`);
  if (opts.refresh) { writeFileSync(opts.refresh, JSON.stringify(goldenOut, null, 2)); process.stdout.write(`${DIM(`wrote golden baseline → ${opts.refresh}`)}\n`); }
  if (opts.json) { writeFileSync(opts.json, JSON.stringify(report, null, 2)); process.stdout.write(`${DIM(`wrote ${opts.json}`)}\n`); }
}

main().catch((e) => { process.stderr.write(`martech-diff error: ${e.message}\n`); process.exit(1); });
