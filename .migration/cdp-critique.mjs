#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop */
// Full browser critique for EVERY page, driven directly over the Chrome
// DevTools Protocol (no playwright/puppeteer package needed).
//
// For each page: render the SOURCE (erp.intuit.com/<path>, SPA-safe because a
// real browser executes its JS) and the MIGRATED page
// (localhost:3000/content/<path>), run an identical region-fingerprint
// extractor in-page, diff them, and write tools/critique-reports/<path>.json.
//
// This is the same method used manually for the 5-page sample, batched.
// Resumable: skips pages whose report already exists.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const CDP = 'http://localhost:39185';
const SRC = 'https://erp.intuit.com';
const LOCAL = 'http://localhost:3000/content';
const OUT = 'tools/critique-reports';
const ROOT = 'content';
const EXCLUDE = /^\/(drafts|library|fragments|experiments|test|of1|pzn)\b|\/(nav|footer|metadata)$/;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // optional subset
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

// ---------- tiny CDP client over the raw WebSocket ----------
async function httpJson(path) {
  const r = await fetch(`${CDP}${path}`);
  return r.json();
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  function send(method, params = {}, sessionId) {
    id += 1; const mid = id;
    const payload = { id: mid, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve) => { pending.set(mid, resolve); ws.send(JSON.stringify(payload)); });
  }
  return { ws, ready, send };
}

const FP = readFileSync('.migration/fp-batch.js', 'utf8'); // in-page extractor (expression)

async function evalInPage(client, sessionId, expression) {
  const r = await client.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.result && r.result.exceptionDetails) return { error: String(r.result.exceptionDetails) };
  return r.result?.result?.value ?? { error: 'no value' };
}

async function renderAndExtract(client, targetId, url, guardBlock) {
  const { result: att } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = att.sessionId;
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  // For the source (guardBlock), retry until a genuine render (not the Chrome
  // error/429 page). The extractor self-reports `blocked` (error page or
  // near-empty body). Up to 5 attempts with growing backoff.
  const maxAttempts = guardBlock ? 5 : 1;
  let fp = { error: 'not-run' };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await client.send('Page.navigate', { url }, sessionId);
    // the extractor itself scrolls + waits; give the SPA base time first
    await new Promise((res) => setTimeout(res, guardBlock ? 3500 : 3000));
    fp = await evalInPage(client, sessionId, FP);
    const blocked = !fp || fp.error || fp.blocked || (fp.bodyTextLen || 0) < 150;
    if (!guardBlock || !blocked) break;
    await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); // backoff before retry
  }
  await client.send('Target.detachFromTarget', { sessionId });
  return fp;
}

// ---------- page list ----------
const all = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (e.endsWith('.plain.html')) all.push('/' + relative(ROOT, p).replace(/\.plain\.html$/, ''));
  }
}(ROOT));
let pages = all.filter((f) => !EXCLUDE.test(f)).sort();
if (ONLY) pages = pages.filter((p) => ONLY.includes(p));

// ---------- scoring (scoring.md weights) ----------
function scorePage(src, mig) {
  const diffs = [];
  const add = (cat, prop, o, m, sev) => diffs.push({ cat, prop, original: o, migrated: m, severity: sev });
  const rgbEq = (a, b) => a === b;
  // hero bg
  if (src.hero?.bg && mig.hero?.bg && !rgbEq(src.hero.bg, mig.hero.bg)) add('styling', 'hero background-color', src.hero.bg, mig.hero.bg, 'high');
  // h1 color / weight / size
  if (src.h1 && mig.h1) {
    if (src.h1.color !== mig.h1.color) add('styling', 'h1 color', src.h1.color, mig.h1.color, 'high');
    if (src.h1.fontWeight !== mig.h1.fontWeight) add('styling', 'h1 font-weight', src.h1.fontWeight, mig.h1.fontWeight, 'medium');
    if (src.h1.fontSize !== mig.h1.fontSize) add('styling', 'h1 font-size', src.h1.fontSize, mig.h1.fontSize, 'low');
  }
  // font family
  if (src.bodyFont && mig.bodyFont && src.bodyFont.split(' ')[0] !== mig.bodyFont.split(' ')[0]) add('global', 'body font-family', src.bodyFont, mig.bodyFont, 'high');
  // content: source headings missing on migrated (word-overlap match, tolerant
  // of punctuation/casing/truncation differences between SPA and EDS render)
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
  const migNorm = (mig.headings || []).map(norm);
  const migWordSets = (mig.headings || []).map(words);
  function matched(h) {
    const hn = norm(h);
    if (hn.length <= 3) return true; // too short to judge
    if (migNorm.some((m) => m.includes(hn) || hn.includes(m))) return true;
    // word-overlap: >=60% of the source heading's significant words appear in some migrated heading
    const hw = [...words(h)];
    if (!hw.length) return true;
    return migWordSets.some((ms) => {
      const hit = hw.filter((w) => ms.has(w)).length;
      return hit / hw.length >= 0.6;
    });
  }
  const missing = (src.headings || []).filter((h) => !matched(h));
  // content fidelity = fraction of source headings present on migrated
  const srcH = (src.headings || []).length;
  const contentFidelity = srcH ? Math.round(((srcH - missing.length) / srcH) * 1000) / 10 : 100;
  missing.forEach((h) => add('content', 'missing heading/section', h, '(absent)', 'high'));
  // broken form signal
  if (mig.formError && !src.formError) add('content', 'form failed to load', 'working form', mig.formError, 'high');
  // score: content fidelity is the backbone; styling diffs deduct on top
  const W = { high: 3, medium: 2, low: 1 };
  const styleW = diffs.filter((d) => d.cat !== 'content').reduce((a, d) => a + (W[d.severity] || 1), 0);
  const styleProps = 8; // hero bg, h1 color/weight/size, font — the fingerprinted style props
  const stylePenalty = Math.min(styleW / (styleProps * 2), 0.5) * 100; // cap styling at -50pts
  const formPenalty = (mig.formError && !src.formError) ? 15 : 0;
  const sim = Math.max(0, Math.round((contentFidelity - stylePenalty - formPenalty) * 10) / 10);
  return { similarity: sim, contentFidelity, diffs, missingHeadings: missing };
}

mkdirSync(OUT, { recursive: true });
const version = await httpJson('/json/version');
const client = connect(version.webSocketDebuggerUrl);
await client.ready;
const { result: tgt } = await client.send('Target.createTarget', { url: 'about:blank' });
const targetId = tgt.targetId;

const summary = [];
let done = 0;
for (const path of pages) {
  if (done >= LIMIT) break;
  done += 1;
  const dest = join(OUT, `${path.replace(/^\//, '')}.json`);
  const src = await renderAndExtract(client, targetId, `${SRC}${path}/`, true);
  const mig = await renderAndExtract(client, targetId, `${LOCAL}${path}`, false);
  const srcBlocked = !src || src.error || src.blocked || (src.bodyTextLen || 0) < 150;
  const srcOk = src && !srcBlocked && (src.headings?.length || src.h1);
  let report;
  if (!srcOk) {
    report = { page: path, sourceUrl: `${SRC}${path}/`, migratedUrl: `${LOCAL}${path}`, source: { rendered: false, note: src?.error || 'source empty/blocked' }, migrated: mig, deferred: 'source-unavailable' };
    summary.push({ page: path, similarity: null, source: 'unavailable' });
  } else {
    const sc = scorePage(src, mig);
    report = {
      page: path, mode: 'page', viewport: '1280x900 (headless default)',
      migratedUrl: `${LOCAL}${path}`, sourceUrl: `${SRC}${path}/`,
      method: 'CDP browser render both sides (SPA-safe); region fingerprint; scoring.md weights',
      similarity: sc.similarity,
      contentFidelityPct: sc.contentFidelity,
      global: { sourceFont: src.bodyFont, migratedFont: mig.bodyFont, match: (src.bodyFont || '').split(' ')[0] === (mig.bodyFont || '').split(' ')[0] },
      hero: { sourceBg: src.hero?.bg, migratedBg: mig.hero?.bg, sourceH1: src.h1, migratedH1: mig.h1, bgMatch: src.hero?.bg === mig.hero?.bg },
      content: { sourceHeadings: (src.headings || []).length, migratedHeadings: (mig.headings || []).length, missingOnMigrated: sc.missingHeadings, migratedFormError: mig.formError || null },
      diffs: sc.diffs,
    };
    summary.push({ page: path, similarity: sc.similarity, contentFidelity: sc.contentFidelity, source: 'ok', missing: sc.missingHeadings.length, formError: !!mig.formError });
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[${done}/${Math.min(pages.length, LIMIT)}] ${path} -> sim:${report.similarity ?? 'n/a'}${report.content?.migratedFormError ? ' [FORM-ERR]' : ''}${report.content?.missingOnMigrated?.length ? ` [miss:${report.content.missingOnMigrated.length}]` : ''}`);
}

writeFileSync(join(OUT, '_full-summary.json'), `${JSON.stringify({ method: 'CDP full browser critique', pages: summary }, null, 2)}\n`);
client.ws.close();
console.log('DONE');
