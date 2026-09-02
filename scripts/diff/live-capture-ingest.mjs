#!/usr/bin/env node
/**
 * live-capture-ingest.mjs — merge one page's sanitized live beacons into the captures file.
 *
 * The work-Chrome capture (see live-capture-plan.mjs / the engine) renders each page's
 * sanitized beacons into the DOM; get_page_text reads them back here. This ingests that
 * JSON array from stdin under the given page path, validating it parses and carries no raw
 * PII (every capture must be sanitized: frozen fields are shape tokens, e.g. "STR:36"). The
 * result feeds `stage-parity.mjs --captures` for the full-envelope oracle diff.
 *
 *   node scripts/diff/live-capture-ingest.mjs / <<'EOF'
 *   [ {...beacon...}, ... ]
 *   EOF
 */
/* eslint-disable no-console, no-restricted-syntax, no-continue, no-plusplus, max-len, no-underscore-dangle, object-curly-newline */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'scripts/diff/fixtures/local/live-capture-customer.json';
const BASE = 'https://stage.erp.intuit.com';
// fields that MUST be shape-tokens, never raw, in an ingested capture (defense against a
// mis-sanitized paste leaking real PII into a local file).
const MUST_TOKEN = ['userId', 'anonymousId', 'ivid', 'fbp', 'auth_id', 'session_replay_id', 'messageId'];
const looksToken = (v) => v === undefined || (typeof v === 'string' && /^(STR:\d+|NUM|BOOL|OBJ|ARR:\d+|NULL)$/.test(v));

function main() {
  const page = process.argv[2];
  if (!page) { console.error('usage: live-capture-ingest.mjs <page-path>  (beacons JSON on stdin)'); process.exit(2); }
  let raw = readFileSync(0, 'utf8');
  // capture is wrapped in CAPSTART..CAPEND markers when rendered; strip anything outside them.
  // Tolerate a missing CAPEND (slice to end) so a paste that drops the trailing marker still parses.
  const ms = raw.indexOf('CAPSTART'); if (ms >= 0) raw = raw.slice(ms + 'CAPSTART'.length);
  const me = raw.indexOf('CAPEND'); if (me >= 0) raw = raw.slice(0, me);
  raw = raw.trim();
  const open = raw[0] === '[' ? '[' : '{'; const close = open === '{' ? '}' : ']';
  const start = raw.indexOf(open); const end = raw.lastIndexOf(close);
  if (start < 0 || end < 0) { console.error('no JSON payload found on stdin'); process.exit(2); }
  let input;
  try { input = JSON.parse(raw.slice(start, end + 1)); } catch (e) { console.error(`parse error: ${e.message}`); process.exit(2); }
  // compact form: { shared:{top,properties,context,integrations,_metadata}, beacons:[…], diag:{…} }
  const diag = (!Array.isArray(input) && input.diag) || null; // per-page cas-id/appVars diagnostic
  const merge = (a, b) => ({ ...(a || {}), ...(b || {}) });
  let beacons = Array.isArray(input) ? input : input.beacons.map((d) => ({
    ...merge(input.shared.top, d.top),
    properties: merge(input.shared.properties, d.properties),
    context: merge(input.shared.context, d.context),
    integrations: merge(input.shared.integrations, d.integrations),
    _metadata: merge(input.shared._metadata, d._metadata),
  }));
  // drop cross-page leaks: utag replays an unsent beacon from the PREVIOUS page on the next
  // page's load, so a capture can carry a stray beacon whose url is a different page. Keep only
  // beacons whose url path matches the page being ingested (beacons with no url — e.g. chat — pass).
  const norm = (p) => (p.replace(/\/$/, '') || '/');
  const want = norm(page);
  const kept = beacons.filter((b) => {
    const u = (b.properties || {}).url; if (!u) return true;
    try { return norm(new URL(u).pathname) === want; } catch { return true; }
  });
  const leaked = beacons.length - kept.length;
  if (leaked) console.log(`  dropped ${leaked} cross-page leak beacon(s) (url != ${page})`);
  // dedup exact-identical beacons (utag sometimes resends the same event on flush).
  const seen = new Set();
  const deduped = kept.filter((b) => { const k = JSON.stringify(b); if (seen.has(k)) return false; seen.add(k); return true; });
  const dupes = kept.length - deduped.length;
  if (dupes) console.log(`  dropped ${dupes} duplicate beacon(s)`);
  beacons = deduped;
  // PII guard
  for (const b of beacons) {
    const p = b.properties || {}; const c = b.context || {};
    for (const f of MUST_TOKEN) {
      for (const [src, o] of [['envelope', b], ['properties', p], ['context', c]]) {
        if (o[f] !== undefined && !looksToken(o[f])) { console.error(`REFUSING: ${src}.${f} is not a shape-token ("${String(o[f]).slice(0, 12)}…") — capture not sanitized`); process.exit(3); }
      }
    }
  }
  const doc = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { base: BASE, generatedAt: new Date().toISOString(), pages: {} };
  doc.pages[page] = beacons;
  if (diag) { doc.diag = doc.diag || {}; doc.diag[page] = diag; }
  doc.updatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(doc, null, 2));
  const events = beacons.reduce((m, b) => { m[b.event] = (m[b.event] || 0) + 1; return m; }, {});
  console.log(`ingested ${beacons.length} beacons for ${page} → ${OUT}`);
  console.log(`  events: ${JSON.stringify(events)}   pages captured: ${Object.keys(doc.pages).length}`);
  if (diag) console.log(`  diag: cas-id meta="${diag.cas_id_meta}" appVars.externalContentIdentifier="${diag.appVars_externalContentIdentifier}" wa-links@rest=${diag.wa_links_at_rest}`);
}

main();
