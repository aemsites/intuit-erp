#!/usr/bin/env node
/**
 * Generate residue rows keyed by the Stage runtime `data-track-id`.
 * Input is a beacon-free scan grouped under `{ pages }`.
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, max-len, object-curly-newline, newline-per-chained-call */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isStructural, stripBc, assignIds } from './parity-gate.mjs';

const DIR = 'scripts/diff/fixtures/local';
const T = (value) => (typeof value === 'string' ? value.trim() : value);
const stripTags = (value) => (typeof value === 'string' ? value.replace(/<[^>]*>/g, '') : value);
const idxNorm = (value) => (typeof value === 'string' ? value.replace(/_\d+/g, '_N') : value);
const ne = (left, right) => (T(left) || '') !== (T(right) || '');
const neTagless = (left, right) => (T(stripTags(left)) || '') !== (T(stripTags(right)) || '');
const neIdxTagless = (left, right) => (idxNorm(T(stripTags(left))) || '') !== (idxNorm(T(stripTags(right))) || '');
const normalizeLabel = (value) => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normalizePath = (href) => {
  try { return new URL(href, 'https://erp.intuit.com').pathname.replace(/\/$/, '') || '/'; } catch { return String(href || '').replace(/\/$/, ''); }
};

function matchCta(entry, ctas, used) {
  const expectedLabel = normalizeLabel(entry.exp?.ui_object_detail || entry.text);
  const expectedPath = entry.href ? normalizePath(entry.href) : '';
  const indexed = ctas.map((candidate, index) => ({ ...candidate, index }));
  const tiers = [
    expectedLabel && indexed.filter((candidate) => candidate.p && normalizeLabel(candidate.p.ui_object_detail) === expectedLabel),
    expectedLabel && indexed.filter((candidate) => normalizeLabel(candidate.label) === expectedLabel),
    expectedPath && indexed.filter((candidate) => candidate.href && normalizePath(candidate.href) === expectedPath),
  ].filter(Boolean);
  for (const tier of tiers) {
    const matches = tier.filter((candidate) => !used.has(candidate.index));
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
    if (matches.length === 1) {
      used.add(matches[0].index);
      return { status: 'matched', candidate: matches[0] };
    }
  }
  return { status: 'absent', candidates: [] };
}

function residueFor(expected, actual) {
  const row = {};
  if (T(expected.object) && ne(expected.object, actual.object)) row.object = T(expected.object);
  if (T(expected.object_detail) && neIdxTagless(expected.object_detail, actual.object_detail)) row['object-detail'] = T(expected.object_detail);
  if (T(expected['data-wa-link']) && ne(expected['data-wa-link'], actual['data-wa-link'])) row['wa-link'] = T(expected['data-wa-link']);
  if (T(expected.action) && ne(expected.action, actual.action)) row.action = T(expected.action);
  if (T(expected.ui_object) && neIdxTagless(expected.ui_object, actual.ui_object)) row['ui-object'] = T(expected.ui_object);
  if (T(expected.ui_object_detail) && neTagless(expected.ui_object_detail, actual.ui_object_detail)) row['ui-object-detail'] = T(expected.ui_object_detail);
  if (T(expected.ui_action) && ne(expected.ui_action, actual.ui_action)) row['ui-action'] = T(expected.ui_action);
  const expectedLinkName = T(stripBc(expected.link_name));
  if (expectedLinkName && neIdxTagless(expectedLinkName, stripBc(actual.link_name))) {
    row['custom-properties'] = `link_name=${expectedLinkName}`;
  }
  return row;
}

export function generateSheetFromBuild(goldenInput, oursInput) {
  const golden = structuredClone(goldenInput);
  assignIds(golden.entries);
  const ours = oursInput.pages || {};
  const rows = [];
  const report = {
    emitted: 0,
    absent: [],
    ambiguous: [],
    acceptedUiAccessPointOnly: [],
    idKept: 0,
    idRemapped: 0,
  };
  const usedByPage = {};

  for (const entry of golden.entries) {
    if (isStructural(entry)) continue;
    const page = entry.page === '*' ? '*' : entry.page;
    const ctas = ours[entry.page] || ours[page] || [];
    if (!usedByPage[entry.page]) usedByPage[entry.page] = new Set();
    const match = matchCta(entry, ctas, usedByPage[entry.page]);
    if (match.status === 'ambiguous') {
      report.ambiguous.push({
        page: entry.page,
        goldenTrackId: entry.trackId,
        candidateTrackIds: match.candidates.map(({ tid }) => tid).filter(Boolean),
      });
      continue;
    }
    const cta = match.candidate;
    if (!cta?.tid) {
      report.absent.push(`${entry.page} [${entry.key || 'loose'}] ${(entry.text || '').slice(0, 40)}`);
      continue;
    }
    const expected = entry.exp || {};
    const actual = cta.p || {};
    const row = residueFor(expected, actual);
    if (ne(idxNorm(expected.ui_access_point), idxNorm(actual.ui_access_point)) && !Object.keys(row).length) {
      report.acceptedUiAccessPointOnly.push(`${entry.page} ${cta.tid}  want=${expected.ui_access_point} got=${actual.ui_access_point}`);
      continue;
    }
    if (!Object.keys(row).length) continue;
    if (cta.tid === entry.trackId) report.idKept += 1;
    else report.idRemapped += 1;
    rows.push({ path: page, id: cta.tid, ...row });
    report.emitted += 1;
  }

  return { sheet: { data: rows }, report };
}

function argumentValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

export function main(argv = process.argv.slice(2)) {
  const goldenPath = argumentValue(argv, '--golden') || `${DIR}/clicktrack-golden-customer.json`;
  const oursPath = argumentValue(argv, '--ours');
  const outPath = argumentValue(argv, '--out') || `${DIR}/tracking-sheet-from-build.json`;
  if (!oursPath) throw new Error('need --ours <scan.json> (aggregated beacon-free output under {pages})');
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const ours = JSON.parse(readFileSync(oursPath, 'utf8'));
  const { sheet, report } = generateSheetFromBuild(golden, ours);
  writeFileSync(outPath, `${JSON.stringify(sheet, null, 2)}\n`);
  console.log(`emitted ${report.emitted} residue rows keyed by Stage runtime ids -> ${outPath}`);
  console.log(`  remapped ids: ${report.idRemapped}   kept: ${report.idKept}`);
  console.log(`  ambiguous identity matches (not emitted): ${report.ambiguous.length}`);
  console.log(`  accepted ui_access_point-only differences (not emitted): ${report.acceptedUiAccessPointOnly.length}`);
  console.log(`  golden entries with no matching Stage control: ${report.absent.length}`);
  return { sheet, report };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
