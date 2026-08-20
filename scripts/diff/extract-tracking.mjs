#!/usr/bin/env node
/**
 * scripts/diff/extract-tracking.mjs
 *
 * Migration aid: extract the AUTHORED click-tracking from a prod erp.intuit.com
 * page into candidate tracking-sheet rows. For each trackable CTA it reads the
 * authored data-*, computes what our code would DERIVE for the equivalent CTA
 * (tag + label), and emits only the RESIDUE (authored - derived). Identical
 * residues are deduped to one shared key, so the sheet is O(distinct configs),
 * not O(CTAs) — that is what makes a sitemap-wide port tractable.
 *
 * Output is a human-reviewed starting point, never the final truth: it prints a
 * report and writes a candidate JSON (--out). Pair with clicktrack-diff.mjs to
 * verify the rows actually reproduce prod's payloads.
 *
 * Usage:
 *   node scripts/diff/extract-tracking.mjs --path /            # homepage
 *   node scripts/diff/extract-tracking.mjs --path /pricing --out fixtures/tracking-pricing.json
 *   node scripts/diff/extract-tracking.mjs --path / --headed   # escalate past the bot ladder
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, no-continue, no-plusplus, max-len, object-curly-newline, no-console */

import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launchStealthHeaded } from './live-session.mjs';
import { captureHtml } from './capture-html.mjs';
import { deriveForCta, slug } from '../tracking.js';
import { computeTrackingPayload, parseCustomProperties } from './tracker-replica.mjs';

const PROD = 'https://erp.intuit.com';

function parseArgs(argv) {
  const opts = { path: '/', out: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') opts.path = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--headed') opts.headed = true;
  }
  return opts;
}

// Authored data-* on the CTA, minus what deriveBaseline() reproduces from tag +
// label. Only the difference needs to be authored in the sheet.
function residueOf(el) {
  const ds = el.dataset;
  // Derive exactly as the runtime does (incl. video-link detection), so only the
  // authored residue that code cannot reproduce is written to the sheet.
  const derived = deriveForCta(el, '');
  const kind = derived['ui-object'];
  const r = {};
  const keep = (col, authored, derivedVal) => {
    if (authored != null && authored !== '' && authored !== derivedVal) r[col] = authored;
  };

  // wa-link path CTAs: preserve faithfully (wa-link, no injected object).
  if (ds.waLink && !ds.object) {
    r['wa-link'] = ds.waLink;
  } else {
    keep('object', ds.object, derived.object); // 'content' default drops out
    keep('action', ds.action, derived.action);
    keep('ui-object', ds.uiObject, kind);
    keep('ui-object-detail', ds.uiObjectDetail, derived['ui-object-detail']);
    keep('ui-action', ds.uiAction, derived['ui-action']);
    if (ds.objectDetail) r['object-detail'] = ds.objectDetail;
    if (ds.waLink) r['wa-link'] = ds.waLink;
  }
  // explicit per-CTA access-point override (empty = just the opt-in switch)
  if (ds.uiAccessPoint) r['ui-access-point'] = ds.uiAccessPoint;

  // custom-properties minus the derived link_name
  const authoredCp = parseCustomProperties(ds.customProperties);
  const derivedLink = derived['custom-properties'].link_name;
  const cp = {};
  for (const [k, v] of Object.entries(authoredCp)) {
    if (k === 'link_name' && v === derivedLink) continue;
    cp[k] = v;
  }
  if (Object.keys(cp).length) r['custom-properties'] = cp;

  // survey-* (authored-only, opt-in)
  const survey = {};
  for (const k of Object.keys(ds)) {
    if (/^survey[A-Z]/.test(k)) survey[k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = ds[k];
  }
  if (Object.keys(survey).length) r.survey = survey;

  return r;
}

function extract(html) {
  const { document } = new JSDOM(html).window;
  const seen = new Map(); // residue JSON -> { key, count, examples: [] }
  const ctas = [];
  let idx = 0;

  for (const el of document.querySelectorAll('a[href], button')) {
    const payload = computeTrackingPayload(el);
    if (!payload) continue; // fails the gate — not tracked
    const label = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const residue = residueOf(el);
    const json = JSON.stringify(residue);
    if (!seen.has(json)) {
      const base = slug(label) || `cta-${idx++}`;
      let key = base;
      let n = 2;
      const used = new Set([...seen.values()].map((v) => v.key));
      while (used.has(key)) key = `${base}-${n++}`;
      seen.set(json, { key, residue, count: 0, examples: [] });
    }
    const entry = seen.get(json);
    entry.count++;
    if (entry.examples.length < 3) entry.examples.push({ tag: el.tagName, label, accessPoint: payload.ui_access_point });
    ctas.push({ label, tag: el.tagName, key: entry.key, accessPoint: payload.ui_access_point });
  }

  const configs = [...seen.values()];
  return { ctas, configs };
}

function report({ ctas, configs }, opts) {
  const G = (s) => `\x1b[32m${s}\x1b[0m`;
  const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
  console.log(`\nExtracted click tracking from ${PROD}${opts.path}`);
  console.log(`  ${G(ctas.length)} trackable CTAs -> ${G(configs.length)} distinct configs (deduped)\n`);
  configs
    .sort((a, b) => b.count - a.count)
    .forEach((c) => {
      const residueKeys = Object.keys(c.residue);
      const summary = residueKeys.length ? residueKeys.join(', ') : DIM('(fully derived — no sheet row needed)');
      console.log(`  ${c.key.padEnd(28)} x${String(c.count).padEnd(3)} residue: ${summary}`);
      console.log(`  ${' '.repeat(28)}    e.g. "${c.examples[0]?.label}" -> ${c.examples[0]?.accessPoint || '(no trail)'}`);
    });
  const needRows = configs.filter((c) => Object.keys(c.residue).length);
  console.log(`\n  ${needRows.length} configs need a sheet row; ${configs.length - needRows.length} are fully auto-derived.\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let html;
  try {
    html = await captureHtml(browser, `${PROD}${opts.path}`, { headed: opts.headed });
  } catch (e) {
    console.error(`\n✖ Could not capture ${PROD}${opts.path}: ${e.name || 'Error'} — ${e.message.split('\n')[0]}`);
    console.error('  (Akamai bot ladder — retry with --headed in an environment with a display.)\n');
    await browser.close().catch(() => {});
    process.exit(2);
  }
  await browser.close().catch(() => {});

  const result = extract(html);
  report(result, opts);

  if (opts.out) {
    const rows = result.configs
      .filter((c) => Object.keys(c.residue).length)
      .map((c) => ({ key: c.key, ...c.residue }));
    const outPath = resolve(process.cwd(), opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ page: opts.path, extractedAt: new Date().toISOString(), rows }, null, 2));
    console.log(`  wrote ${rows.length} candidate rows -> ${opts.out}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
