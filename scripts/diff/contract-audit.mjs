#!/usr/bin/env node
/**
 * contract-audit.mjs — offline audit of the customer golden against the FIXED
 * backend contract (scripts/diff/fixtures/backend-contract.json).
 *
 * For all 161 authoritative payloads it:
 *   1. asserts the ENVELOPE   — type === 'track', required top-level keys present;
 *   2. asserts the EVENT NAME — properties.event === `${object}:${action}` and the
 *      top-level `event` agrees (the contract's eventNameRule);
 *   3. BUCKETS every `properties` key against the contract (perClick / sharedContext /
 *      consent) and FAILS on any key the contract does not know about — so a new prod
 *      field can never silently slip past the harness. Update backend-contract.json,
 *      then this passes.
 *
 * Counts + field names only (no campaign values) → safe to commit the OUTPUT.
 *
 *   node scripts/diff/contract-audit.mjs           # human report + verdict
 *   node scripts/diff/contract-audit.mjs --json     # machine JSON
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, no-nested-ternary */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const CONTRACT = 'scripts/diff/fixtures/backend-contract.json';
const DIR = 'scripts/diff/fixtures/local/customer-payloads';

function loadPayloads() {
  const pdir = `${DIR}/payloads`;
  if (!existsSync(pdir)) { console.error(`Missing ${pdir}. Vendor the customer drop first (gitignored).`); process.exit(2); }
  return readdirSync(pdir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(`${pdir}/${f}`, 'utf8')) }));
}

function main() {
  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  const envelopeKeys = new Set(contract.envelope.keys);
  const perClick = new Set([...Object.keys(contract.perClickFields.always), ...Object.keys(contract.perClickFields.conditional).filter((k) => !k.startsWith('<'))]);
  const shared = new Set(contract.sharedContext.keys);
  const consent = new Set(contract.consentFields.keys);

  const items = loadPayloads();
  const bucketCounts = { perClick: {}, shared: {}, consent: {} };
  const unknown = {};
  const envelopeViolations = [];
  const eventNameViolations = [];
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

  for (const it of items) {
    const p = it.payload || {};
    const props = p.properties || {};
    if (p.type !== 'track') envelopeViolations.push(`${it.file}: type=${JSON.stringify(p.type)} (want "track")`);
    for (const k of envelopeKeys) if (!(k in p)) envelopeViolations.push(`${it.file}: missing envelope key "${k}"`);
    // eventNameRule: event === object:action, and top-level event agrees
    const want = `${props.object}:${props.action}`;
    if (props.event !== want) eventNameViolations.push(`${it.file}: properties.event=${JSON.stringify(props.event)} != ${JSON.stringify(want)}`);
    else if (p.event !== want) eventNameViolations.push(`${it.file}: top-level event=${JSON.stringify(p.event)} != ${JSON.stringify(want)}`);
    for (const k of Object.keys(props)) {
      if (perClick.has(k)) inc(bucketCounts.perClick, k);
      else if (shared.has(k)) inc(bucketCounts.shared, k);
      else if (consent.has(k)) inc(bucketCounts.consent, k);
      else if (k !== 'event') inc(unknown, k); // `event` is the echoed envelope key
    }
  }

  const unknownKeys = Object.keys(unknown).sort();
  const verdict = (!envelopeViolations.length && !eventNameViolations.length && !unknownKeys.length) ? 'PASS' : 'FAIL';
  const report = {
    payloads: items.length,
    envelopeViolations: envelopeViolations.length,
    eventNameViolations: eventNameViolations.length,
    unknownFields: unknownKeys.map((k) => ({ field: k, count: unknown[k] })),
    coverage: {
      perClick: Object.fromEntries([...perClick].map((k) => [k, bucketCounts.perClick[k] || 0])),
      shared: Object.fromEntries([...shared].map((k) => [k, bucketCounts.shared[k] || 0])),
      consent: Object.fromEntries([...consent].map((k) => [k, bucketCounts.consent[k] || 0])),
    },
    verdict,
  };

  if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(verdict === 'PASS' ? 0 : 1); }

  console.log(`\nContract audit — ${items.length} customer payloads vs ${CONTRACT}`);
  console.log(`  envelope violations:   ${envelopeViolations.length}`);
  console.log(`  event-name violations: ${eventNameViolations.length}`);
  if (eventNameViolations.length) eventNameViolations.slice(0, 8).forEach((v) => console.log(`      ${v}`));
  if (unknownKeys.length) {
    console.log(`\n  *** ${unknownKeys.length} UNKNOWN field(s) not in the contract — add them, then re-run: ***`);
    unknownKeys.forEach((k) => console.log(`      ${String(unknown[k]).padStart(3)}/${items.length}  ${k}`));
  } else {
    console.log('\n  no unknown fields — every property is accounted for in the contract');
  }
  const seen = (b) => Object.values(report.coverage[b]).filter((n) => n > 0).length;
  console.log(`\n  bucket coverage (fields seen / defined): perClick ${seen('perClick')}/${perClick.size}  shared ${seen('shared')}/${shared.size}  consent ${seen('consent')}/${consent.size}`);
  console.log(`\nverdict: ${verdict}\n`);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main();
