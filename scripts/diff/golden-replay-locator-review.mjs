#!/usr/bin/env node
/**
 * Join an authenticated stage inventory to the live tracking sheet without
 * firing events. The result is a bounded locator proposal set, never an
 * automatic qualification: equal-best candidates remain ambiguous.
 */
/* eslint-disable import/extensions, no-console, no-restricted-syntax, max-len, no-plusplus */
import {
  chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  indexTrackingSheet, matchScenarioToInventory,
} from './golden-replay-stage-inventory.mjs';
import { manifestContentHash } from './golden-replay-manifest.mjs';

const EXACT_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_MANIFEST = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const DEFAULT_INVENTORY = 'scripts/diff/fixtures/local/clicktrack-golden-stage-inventory.json';
const DEFAULT_OUT = 'scripts/diff/fixtures/local/clicktrack-golden-locator-review.json';

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const normalizePath = (value) => {
  const path = String(value || '').trim();
  if (!path || path === '*') return '*';
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
};

function parseTrackingSheet(bytes) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('tracking sheet is not valid JSON'); }
  const rows = parsed.data || parsed.rows;
  if (!Array.isArray(rows)) throw new Error('tracking sheet has no row array');
  const identities = new Set();
  for (const row of rows) {
    const id = String(row.id ?? row.key ?? '').trim();
    if (id) {
      const identity = `${normalizePath(row.path)}|${id}`;
      if (identities.has(identity)) throw new Error(`duplicate tracking sheet identity: ${identity}`);
      identities.add(identity);
    }
  }
  return rows;
}

function candidateEvidence(ranked) {
  return (ranked || []).slice(0, 5).map(({ candidate, score, reasons }) => ({
    score,
    reasons,
    candidateId: candidate.candidateId,
    dataTrackId: candidate.dataTrackId,
    accessibleName: candidate.accessibleName,
    tag: candidate.tag,
    role: candidate.role,
    region: candidate.region,
    href: candidate.href,
    block: candidate.block,
    ariaExpanded: candidate.ariaExpanded,
    sheetResidueColumns: Object.keys(candidate.sheetResidue || {}).sort(),
  }));
}

function locatorFor(candidate) {
  if (candidate.dataTrackId) return { strategy: 'data-track-id', value: candidate.dataTrackId };
  return {
    strategy: 'semantic',
    region: candidate.region,
    role: candidate.role,
    accessibleName: candidate.accessibleName,
    href: candidate.href,
    block: candidate.block,
  };
}

function trackingSheetRefsFor(rows, scenario) {
  const wanted = String(scenario.targetSignature?.waLink || '').trim();
  if (!wanted) return [];
  const page = normalizePath(scenario.page);
  return rows.filter((row) => String(row['wa-link'] || '').trim() === wanted
    && (normalizePath(row.path) === '*' || normalizePath(row.path) === page))
    .map((row) => ({ path: normalizePath(row.path), id: String(row.id ?? row.key ?? '').trim() }))
    .filter(({ id }) => id);
}

function diagnoseUnresolved(match, scenario, rows, candidates) {
  if (match.status !== 'ambiguous' && match.status !== 'missing') return null;
  const refs = trackingSheetRefsFor(rows, scenario);
  if (scenario.targetSignature?.waLink) {
    if (!refs.length) return { cause: 'sheet-residue-missing', trackingSheetRefs: [] };
    const renderedIds = new Set(candidates.map(({ dataTrackId }) => dataTrackId).filter(Boolean));
    if (!refs.some(({ id }) => renderedIds.has(id))) {
      return { cause: 'sheet-target-not-rendered', trackingSheetRefs: refs };
    }
    return {
      cause: match.status === 'ambiguous' ? 'sheet-locator-ambiguous' : 'sheet-target-score-mismatch',
      trackingSheetRefs: refs,
    };
  }
  return {
    cause: match.status === 'ambiguous' ? 'semantic-duplicate' : 'semantic-target-missing',
    trackingSheetRefs: [],
  };
}

function diagnoseProposedConflict(match, scenario, rows) {
  if (match.status !== 'proposed') return null;
  const ranked = match.candidates.find(({ candidate }) => candidate.candidateId === match.candidate.candidateId);
  const reasons = new Set(ranked?.reasons || []);
  const hasNameIdentity = [...reasons].some((reason) => reason.startsWith('name-'));
  const hasResidueIdentity = reasons.has('wa-link-sheet') || reasons.has('wa-link-dom');
  const refs = trackingSheetRefsFor(rows, scenario);
  if (reasons.has('wa-link-sheet') && !hasNameIdentity && !reasons.has('href')) {
    return { cause: 'sheet-semantic-conflict', trackingSheetRefs: refs };
  }
  if (scenario.targetSignature?.waLink && refs.length && !hasResidueIdentity
    && hasNameIdentity && !reasons.has('href')) {
    return { cause: 'semantic-residue-conflict', trackingSheetRefs: refs };
  }
  return null;
}

export function createLocatorReview({
  manifest, inventory, inventoryBytes, trackingSheetBytes,
}) {
  if (inventory.origin !== EXACT_ORIGIN) throw new Error('inventory exact stage origin is invalid');
  if (inventory.manifest?.schemaVersion !== manifest.schemaVersion
    || inventory.manifest?.contentHash !== manifest.manifestContentHash
    || inventory.manifest?.mappingHash !== manifest.goldenMappingHash) {
    throw new Error('inventory manifest binding does not match');
  }
  const rows = parseTrackingSheet(trackingSheetBytes);
  const trackingSheet = indexTrackingSheet(rows);
  const scenarioById = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const reviewed = [];
  const failingCas = [];
  for (const page of inventory.pages || []) {
    if (!page.pageCasIdPass) failingCas.push({ pathname: page.pathname, pageCasId: page.pageCasId || '' });
    const scenarioIds = page.expectedScenarioIds || [];
    for (const scenarioId of scenarioIds) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario || scenario.page !== page.pathname) throw new Error(`inventory scenario accounting is invalid: ${scenarioId}`);
      if (page.status === 'blocked') {
        reviewed.push({
          scenarioId, page: page.pathname, status: 'blocked', reason: page.reason || 'page blocked',
        });
      } else {
        const match = matchScenarioToInventory(scenario, page.candidates || [], { trackingSheet });
        const result = { scenarioId, page: page.pathname, status: match.status };
        const conflict = diagnoseProposedConflict(match, scenario, rows);
        if (conflict) {
          result.status = 'ambiguous';
          result.candidates = candidateEvidence(match.candidates);
          result.diagnosis = conflict.cause;
          if (conflict.trackingSheetRefs.length) result.trackingSheetRefs = conflict.trackingSheetRefs;
        } else if (match.status === 'proposed') {
          const ranked = match.candidates.find(({ candidate }) => candidate.candidateId === match.candidate.candidateId);
          result.locator = locatorFor(match.candidate);
          result.evidence = {
            score: ranked.score,
            reasons: ranked.reasons,
            candidate: candidateEvidence([ranked])[0],
          };
        } else if (match.status === 'ambiguous' || match.status === 'missing') {
          result.candidates = candidateEvidence(match.candidates);
          const diagnosis = diagnoseUnresolved(match, scenario, rows, page.candidates || []);
          result.diagnosis = diagnosis.cause;
          if (diagnosis.trackingSheetRefs.length) result.trackingSheetRefs = diagnosis.trackingSheetRefs;
        }
        reviewed.push(result);
      }
    }
  }
  if (reviewed.length !== manifest.scenarios.length
    || new Set(reviewed.map(({ scenarioId }) => scenarioId)).size !== manifest.scenarios.length) {
    throw new Error('locator review did not preserve the complete manifest denominator');
  }
  const count = (status) => reviewed.filter((scenario) => scenario.status === status).length;
  const unresolvedCauses = reviewed.filter(({ diagnosis }) => diagnosis)
    .reduce((counts, { diagnosis }) => ({ ...counts, [diagnosis]: (counts[diagnosis] || 0) + 1 }), {});
  const review = {
    schemaVersion: 1,
    source: 'authenticated-stage-locator-review',
    createdAt: new Date().toISOString(),
    exactOrigin: EXACT_ORIGIN,
    inputs: {
      manifestSchemaVersion: manifest.schemaVersion,
      manifestContentHash: manifest.manifestContentHash,
      goldenMappingHash: manifest.goldenMappingHash,
      inventorySha256: sha256(inventoryBytes),
      trackingSheetSha256: sha256(trackingSheetBytes),
      trackingSheetRows: rows.length,
    },
    pageCasId: {
      total: (inventory.pages || []).length,
      passing: (inventory.pages || []).length - failingCas.length,
      failing: failingCas,
    },
    scenarios: reviewed,
    unresolvedCauses,
    summary: {
      total: reviewed.length,
      proposed: count('proposed'),
      ambiguous: count('ambiguous'),
      missing: count('missing'),
      passive: count('passive'),
      blocked: count('blocked'),
    },
  };
  review.reviewContentHash = sha256(JSON.stringify(review));
  return review;
}

export function applyLocatorReviewToManifest(manifest, review) {
  if (review.inputs?.manifestSchemaVersion !== manifest.schemaVersion
    || review.inputs?.manifestContentHash !== manifest.manifestContentHash
    || review.inputs?.goldenMappingHash !== manifest.goldenMappingHash) {
    throw new Error('locator review manifest binding does not match');
  }
  const reviewedById = new Map(review.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  if (reviewedById.size !== manifest.scenarios.length) throw new Error('locator review denominator does not match manifest');
  const updated = structuredClone(manifest);
  updated.scenarios = updated.scenarios.map((scenario) => {
    const reviewed = reviewedById.get(scenario.scenarioId);
    if (!reviewed || reviewed.page !== scenario.page) throw new Error(`locator review scenario is invalid: ${scenario.scenarioId}`);
    const evidence = {
      reviewContentHash: review.reviewContentHash,
      inventorySha256: review.inputs.inventorySha256,
      trackingSheetSha256: review.inputs.trackingSheetSha256,
      diagnosis: reviewed.diagnosis || null,
      trackingSheetRefs: reviewed.trackingSheetRefs || [],
      ...(reviewed.evidence || {}),
      candidates: reviewed.candidates || [],
    };
    return {
      ...scenario,
      locator: reviewed.status === 'proposed'
        ? { status: 'proposed', ...reviewed.locator, evidence }
        : { status: reviewed.status, evidence },
    };
  });
  const failingCas = new Set((review.pageCasId?.failing || []).map(({ pathname }) => pathname));
  updated.pages = (updated.pages || []).map((page) => ({
    ...page,
    readiness: {
      status: failingCas.has(page.pathname) ? 'blocked' : 'inventoried',
      pageCasIdPass: !failingCas.has(page.pathname),
      inventorySha256: review.inputs.inventorySha256,
      reviewContentHash: review.reviewContentHash,
    },
  }));
  updated.manifestContentHash = manifestContentHash(updated);
  return updated;
}

function parseArgs(argv) {
  const options = {
    manifest: DEFAULT_MANIFEST,
    inventory: DEFAULT_INVENTORY,
    sheet: `${EXACT_ORIGIN}/tracking.json`,
    out: DEFAULT_OUT,
    applyManifest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') options.manifest = argv[++index];
    else if (argv[index] === '--inventory') options.inventory = argv[++index];
    else if (argv[index] === '--sheet') options.sheet = argv[++index];
    else if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--apply-manifest') options.applyManifest = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

function atomicWrite(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.sheet !== `${EXACT_ORIGIN}/tracking.json`) throw new Error('exact stage tracking sheet URL is required');
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const inventoryBytes = readFileSync(options.inventory);
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  const response = await fetch(options.sheet, { redirect: 'error' });
  if (!response.ok) throw new Error(`tracking sheet returned ${response.status}`);
  const trackingSheetBytes = Buffer.from(await response.arrayBuffer());
  const review = createLocatorReview({
    manifest, inventory, inventoryBytes, trackingSheetBytes,
  });
  atomicWrite(options.out, review);
  if (options.applyManifest) atomicWrite(options.manifest, applyLocatorReviewToManifest(manifest, review));
  console.log(JSON.stringify({ output: options.out, summary: review.summary, pageCasId: review.pageCasId }, null, 2));
  return review;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
