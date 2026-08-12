#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop */
// Batch critique of all "real" migrated pages against same-path source on
// erp.intuit.com. Follows the skill's Phase-2 deterministic categories that
// are network-safe:
//   - CONTENT   (headings/paragraphs/links/images present on both sides)
//   - STRUCTURAL (block signature / section count)
//   - SOURCE availability (200 / 404 / unreachable)
// STYLING + INTERACTIONS require a live browser per page and are NOT run here
// (would be throttled/blocked against the rate-limiting source); each report
// marks them "deferred: needs-browser-pass".
//
// Writes one report per page under tools/critique-reports/<path>.json plus a
// summary index.

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = 'content';
const OUT = 'tools/critique-reports';
const SRC = 'https://erp.intuit.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const EXCLUDE = /^\/(drafts|library|fragments|experiments|test|of1|pzn)\b|\/(nav|footer|metadata)$/;

// ---- enumerate real pages ----
const all = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (e.endsWith('.plain.html')) all.push('/' + relative(ROOT, p).replace(/\.plain\.html$/, ''));
  }
}(ROOT));
const pages = all.filter((f) => !EXCLUDE.test(f)).sort();
console.log(`Real pages to critique: ${pages.length}`);

// ---- extractors ----
function extract(docMain) {
  const headings = [...docMain.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .map((h) => h.textContent.trim()).filter(Boolean);
  const paragraphs = [...docMain.querySelectorAll('p')]
    .map((p) => p.textContent.trim()).filter((t) => t.length > 2);
  const links = [...docMain.querySelectorAll('a')].map((a) => a.textContent.trim()).filter(Boolean);
  const images = docMain.querySelectorAll('img,picture').length;
  return { headings, paragraphs, links, images };
}
const KNOWN = new Set(['hero', 'tabs', 'media-text', 'fragment', 'disclosure', 'icon-columns', 'cards', 'columns', 'carousel', 'accordion', 'testimonial', 'feature-grid', 'form', 'table', 'banner', 'cta', 'stats']);
function blockSig(docMain) {
  const set = new Set();
  docMain.querySelectorAll('div[class]').forEach((d) => { const c = d.className.trim().split(/\s+/)[0]; if (KNOWN.has(c)) set.add(c); });
  return [...set].sort();
}
function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

async function fetchSrc(path) {
  const url = `${SRC}${path}/`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
      if (r.status === 200) return { status: 200, html: await r.text() };
      if (r.status === 404) return { status: 404 };
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1) ** 2)); continue; }
      return { status: r.status };
    } catch (e) { await new Promise((res) => setTimeout(res, 1200 * (attempt + 1))); }
  }
  return { status: 'unreachable' };
}

const summary = [];
let i = 0;
for (const path of pages) {
  i += 1;
  const destEarly = join(OUT, `${path.replace(/^\//, '')}.json`);
  if (existsSync(destEarly)) { // resume: skip completed reports (but still index them)
    try { const prev = JSON.parse(readFileSync(destEarly, 'utf8')); summary.push({ page: path, source: prev.source.status, headingFidelityPct: prev.content?.headingFidelityPct ?? null, blocks: (prev.blockSignature || []).join('+') || '(default)' }); } catch (e) { /* re-run below */ }
    if (summary.length && summary[summary.length - 1].page === path) { if (i % 40 === 0) console.log(`[${i}/${pages.length}] ${path} (cached)`); continue; }
  }
  const localHtml = readFileSync(join(ROOT, `${path.replace(/^\//, '')}.plain.html`), 'utf8');
  const lm = new JSDOM(`<main>${localHtml}</main>`).window.document.querySelector('main');
  const local = extract(lm);
  const sig = blockSig(lm);

  const src = await fetchSrc(path);
  const report = {
    page: path,
    migratedFile: `content${path}.plain.html`,
    sourceUrl: `${SRC}${path}/`,
    viewport: 'n/a (content/structural pass)',
    blockSignature: sig,
    migrated: { headings: local.headings.length, paragraphs: local.paragraphs.length, links: local.links.length, images: local.images },
  };

  if (src.status === 200) {
    const sm = new JSDOM(src.html).window.document.querySelector('main') || new JSDOM(src.html).window.document.body;
    const source = extract(sm);
    // content fidelity: how many local headings appear in source
    const srcHeadNorm = source.headings.map(norm);
    const matched = local.headings.filter((h) => srcHeadNorm.some((s) => s.includes(norm(h)) || norm(h).includes(s)));
    const missing = local.headings.filter((h) => !srcHeadNorm.some((s) => s.includes(norm(h)) || norm(h).includes(s)));
    const headingFidelity = local.headings.length ? Math.round((matched.length / local.headings.length) * 1000) / 10 : 100;
    report.source = { status: 200, headings: source.headings.length, paragraphs: source.paragraphs.length, images: source.images };
    report.content = {
      headingFidelityPct: headingFidelity,
      headingsMatched: matched.length,
      headingsTotal: local.headings.length,
      missingHeadings: missing.slice(0, 15),
    };
    report.structural = {
      migratedHeadings: local.headings.length,
      sourceHeadings: source.headings.length,
      migratedImages: local.images,
      sourceImages: source.images,
    };
  } else {
    report.source = { status: src.status };
    report.content = { note: src.status === 404 ? 'no source counterpart at same path' : `source ${src.status}` };
  }
  report.styling = { deferred: 'needs-browser-pass', reason: 'computed-style extraction requires live browser; source rate-limits' };
  report.interactions = { deferred: 'needs-browser-pass' };

  const dest = join(OUT, `${path.replace(/^\//, '')}.json`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
  summary.push({ page: path, source: report.source.status, headingFidelityPct: report.content.headingFidelityPct ?? null, blocks: sig.join('+') || '(default)' });

  if (i % 20 === 0 || i === pages.length) console.log(`[${i}/${pages.length}] ${path} -> src:${report.source.status}`);
  // polite spacing to reduce 429s
  await new Promise((res) => setTimeout(res, 400));
}

writeFileSync(join(OUT, '_summary.json'), `${JSON.stringify({
  generated: 'content/structural pass',
  totalPages: pages.length,
  sourceOK: summary.filter((s) => s.source === 200).length,
  source404: summary.filter((s) => s.source === 404).length,
  sourceUnreachable: summary.filter((s) => s.source === 'unreachable' || (typeof s.source === 'number' && s.source >= 400 && s.source !== 404)).length,
  pages: summary,
}, null, 2)}\n`);
console.log('DONE. Reports in tools/critique-reports/');
