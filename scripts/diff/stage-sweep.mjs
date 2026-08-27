#!/usr/bin/env node
/**
 * stage-sweep.mjs — helper for the REAL-CHROME live sweep (claude-in-chrome MCP).
 *
 * Playwright can't trigger stage's consent-gated martech, but the user's consented Chrome
 * does. So the assistant drives that Chrome: per page it injects an in-page sweep that
 * clicks each golden element and extracts ONLY the named gated field VALUES + presence
 * booleans (never the raw beacon — cookies/session/ivid stay in the page, satisfying the
 * PII filter). This script (a) emits the per-page locators + field lists to inject, and
 * (b) scores the collected captures through the SAME oracle-lib as everything else.
 *
 *   node scripts/diff/stage-sweep.mjs --fields          # gated + presence field lists (JSON)
 *   node scripts/diff/stage-sweep.mjs --targets         # per-page locators (JSON)
 *   node scripts/diff/stage-sweep.mjs --score <captured.json>   # across-the-board live verdict
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline */
import { readFileSync } from 'node:fs';
import {
  gatedSpecs, presenceSpecs, verdict, gatedMatch, specOf, isStructuralException, assertIntegrity,
} from './oracle-lib.mjs';

const GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
assertIntegrity(golden);

const LOCS = ['envelope', 'properties', 'context'];
const gatedList = LOCS.flatMap((loc) => gatedSpecs(loc).map(([f]) => `${loc}.${f}`));
const presenceList = ['envelope', 'properties', 'context', 'integrations'].flatMap((loc) => presenceSpecs(loc).map(([f]) => `${loc}.${f}`));
const readF = (payload, key) => { const [loc, f] = key.split('.'); return loc === 'envelope' ? payload[f] : (payload[loc] || {})[f]; };
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const mode = process.argv[2];

if (mode === '--fields') {
  console.log(JSON.stringify({ gatedList, presenceList }, null, 0));
} else if (mode === '--targets') {
  const byPage = {};
  golden.entries.forEach((e, i) => {
    if (isStructuralException(e.event)) return;
    const p = e.fullPayload.properties || {};
    (byPage[e.page] = byPage[e.page] || []).push({
      i, // global index into golden.entries
      label: stripTags(p.ui_object_detail) || e.ctaLabel || stripTags(e.text),
      href: p.link_href || (e.href && e.href !== 'https://erp.intuit.com/' ? e.href : null),
      event: e.event,
      key: e.key || '(loose)',
    });
  });
  console.log(JSON.stringify(byPage, null, 0));
} else if (mode === '--score') {
  const cap = JSON.parse(readFileSync(process.argv[3], 'utf8')); // [{page, notMigrated?, results:[{i,found,reproduced,gated,presence}]}]
  const results = [];
  const notMigrated = [];
  const seen = new Set();
  for (const pc of cap) {
    if (pc.notMigrated) { notMigrated.push(pc.page); continue; }
    for (const r of (pc.results || [])) {
      const e = golden.entries[r.i];
      if (!e) continue;
      seen.add(r.i);
      const base = { page: e.page, component: e.key || '(loose)', event: e.event };
      if (!r.reproduced) { results.push({ ...base, reproduced: false, gated: {}, presence: {} }); continue; }
      const gated = {};
      for (const key of gatedList) {
        const want = readF(e.fullPayload, key);
        if (want == null || want === '') continue; // only gate fields prod populated
        if (!r.gated || !(key in r.gated)) continue; // blocked/object field not extracted -> presence-covered, not a value mismatch
        const cv = r.gated[key];
        if (typeof cv === 'string' && cv.startsWith('[BLOCKED')) continue; // PII-filter redaction -> presence, not a mismatch
        gated[key] = gatedMatch(specOf(...key.split('.')), want, cv);
      }
      // presence proxy: a full envelope (many props + context + integrations + messageId)
      // demonstrably carries the frozen inherited fields; PII names can't be extracted.
      const ok = r.pres && r.pres.n >= 45 && r.pres.c && r.pres.g2 && r.pres.m;
      const presence = {};
      for (const key of presenceList) {
        if (readF(e.fullPayload, key) === undefined) continue;
        presence[key] = !!ok;
      }
      results.push({ ...base, reproduced: true, gated, presence });
    }
  }
  const rep = verdict(results);
  console.log(JSON.stringify({ ...rep, not_migrated: notMigrated, swept: results.length }, null, 2));
} else {
  console.error('usage: --fields | --targets | --score <captured.json>');
  process.exit(2);
}
