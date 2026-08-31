#!/usr/bin/env node
/** Builds an offline triage and a non-applying tracking-sheet correction draft. */
/* eslint-disable import/extensions, no-console, no-continue, no-plusplus, no-restricted-syntax, max-len, object-curly-newline */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fieldRows } from './golden-replay-report.mjs';
import { validateGoldenReplayManifest } from './golden-replay-manifest.mjs';

const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_MANIFEST = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const DEFAULT_LOCK = '.jig/click-tracking-harness/evidence/customer-golden-identity-lock.json';
const DEFAULT_DEVIATIONS = 'scripts/diff/fixtures/clicktrack-deviation-registry.json';
const DEFAULT_STATE = 'scripts/diff/fixtures/local/clicktrack-golden-replay-run-v23.json';
const DEFAULT_JSON = 'scripts/diff/fixtures/local/clicktrack-golden-replay-offline-analysis.json';
const DEFAULT_MARKDOWN = '.jig/click-tracking-harness/evidence/v23-offline-triage.md';

const ENVIRONMENT_FIELDS = new Set([
  'auth_id', 'channel_cookie_90day', 'experiment_ids', 'pseudonym_id',
  'session_replay_id', 'session_replay_url',
]);
const SHEET_COLUMNS = {
  object: 'object',
  object_detail: 'object-detail',
  action: 'action',
  ui_object: 'ui-object',
  ui_object_detail: 'ui-object-detail',
  ui_action: 'ui-action',
  'data-wa-link': 'wa-link',
  link_name: 'custom-properties',
};
const statuses = ['captured', 'pending', 'blocked', 'missing', 'unreproducible', 'passive'];
const valueAt = (payload, location, field) => (location === 'envelope' ? payload?.[field] : payload?.[location]?.[field]);
const sheetValue = (field, value) => (field === 'link_name'
  ? `link_name=${String(value).replace(/ \[[^\]]*\]$/, '')}` : value);
const dispositionBucket = (status, reason) => {
  if (status === 'passive') return 'structural-exception';
  if (status === 'blocked') return 'runtime-blocker';
  if (/duplicate|ambiguous/.test(reason)) return 'duplicate-or-ambiguous';
  if (/conflict/.test(reason)) return 'stale-sheet-identity';
  return 'target-absent';
};

function ensureIdentity(golden, manifest, state) {
  if (golden.entries.length !== manifest.scenarios.length || state.outcomes.length !== manifest.scenarios.length) {
    throw new Error('offline analysis denominator does not match the golden manifest');
  }
  const scenarioIds = new Set(manifest.scenarios.map(({ scenarioId }) => scenarioId));
  const outcomeIds = new Set(state.outcomes.map(({ scenarioId }) => scenarioId));
  if (scenarioIds.size !== manifest.scenarios.length || outcomeIds.size !== state.outcomes.length
    || outcomeIds.size !== scenarioIds.size
    || state.outcomes.some(({ scenarioId }) => !scenarioIds.has(scenarioId))) {
    throw new Error('offline analysis scenario identity is invalid');
  }
  if (!state.binding?.manifest || !manifest.manifestContentHash || !manifest.goldenMappingHash) {
    throw new Error('offline analysis binding is required');
  }
  if (state.binding.manifest.contentHash !== manifest.manifestContentHash
    || state.binding.manifest.mappingHash !== manifest.goldenMappingHash) {
    throw new Error('offline analysis state does not match the reviewed manifest');
  }
}

export function buildOfflineGoldenReplayAnalysis({ golden, manifest, state, deviations = { schemaVersion: 1, entries: [] } }) {
  ensureIdentity(golden, manifest, state);
  const entries = new Map(golden.entries.map((entry) => [entry.payloadFile, entry]));
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const counts = Object.fromEntries(statuses.map((status) => [status,
    state.outcomes.filter((outcome) => outcome.status === status).length]));
  const correctionRows = new Map();
  const correctionEvidence = new Map();
  const semanticOverrideRows = [];
  const reviewItems = [];
  const environmentGaps = [];
  let pageCasIdExact = 0;

  for (const outcome of state.outcomes) {
    if (outcome.status !== 'captured') continue;
    const scenario = scenarios.get(outcome.scenarioId);
    const entry = entries.get(scenario.goldenRef.payloadFile);
    if (!entry) throw new Error(`golden payload mapping is missing: ${outcome.scenarioId}`);
    if (outcome.payload?.properties?.page_cas_id === scenario.page) pageCasIdExact += 1;
    if (entry.event !== outcome.payload?.event && outcome.locator?.trackId) {
      const goldenProperties = entry.fullPayload?.properties || {};
      const stageProperties = outcome.payload?.properties || {};
      const row = { path: scenario.page, id: outcome.locator.trackId };
      const semanticFields = {
        object: 'object', action: 'action', ui_object: 'ui-object', ui_access_point: 'ui-access-point',
      };
      Object.entries(semanticFields).forEach(([field, column]) => {
        if (goldenProperties[field] != null && goldenProperties[field] !== stageProperties[field]) {
          row[column] = goldenProperties[field];
        }
      });
      semanticOverrideRows.push(row);
    }
    const rows = fieldRows(entry, scenario, outcome, deviations)
      .filter((row) => ['stage-bug', 'open-investigation'].includes(row.category)
        || (row.category === 'environment-session-context' && (row.bucket === 'gated' || !row.presence)));
    for (const row of rows) {
      const item = {
        scenarioId: outcome.scenarioId,
        page: scenario.page,
        event: entry.event,
        component: entry.key || '(loose)',
        field: row.field,
        location: row.location,
        category: row.category,
        policy: row.policy,
        golden: row.golden,
        got: row.got,
        presence: row.presence,
      };
      if (row.category === 'environment-session-context' || ENVIRONMENT_FIELDS.has(row.field)) {
        environmentGaps.push(item);
        continue;
      }
      reviewItems.push(item);
      const column = row.location === 'properties' ? SHEET_COLUMNS[row.field] : null;
      const trackId = outcome.locator?.trackId;
      if (!column || !trackId || row.got !== '‹absent›') continue;
      const goldenValue = valueAt(entry.fullPayload, row.location, row.field);
      if (goldenValue == null || goldenValue === '') continue;
      const key = `${scenario.page}|${trackId}`;
      if (!correctionRows.has(key)) correctionRows.set(key, { path: scenario.page, id: trackId });
      correctionRows.get(key)[column] = sheetValue(row.field, goldenValue);
      if (!correctionEvidence.has(key)) correctionEvidence.set(key, []);
      correctionEvidence.get(key).push({ scenarioId: outcome.scenarioId, field: row.field });
    }
  }

  const dispositions = state.outcomes
    .filter((outcome) => ['blocked', 'missing', 'unreproducible', 'passive'].includes(outcome.status))
    .map((outcome) => {
      const reason = outcome.reason || '';
      return {
        scenarioId: outcome.scenarioId,
        page: outcome.pathname,
        status: outcome.status,
        reason,
        bucket: dispositionBucket(outcome.status, reason),
      };
    });
  const pending = state.outcomes.filter((outcome) => outcome.status === 'pending')
    .map(({ scenarioId, pathname }) => ({ scenarioId, page: pathname }));
  return {
    schemaVersion: 1,
    source: 'customer-golden-v23-offline-analysis',
    generatedAt: new Date().toISOString(),
    binding: state.binding,
    summary: {
      total: manifest.scenarios.length,
      ...counts,
      pageCasIdExact,
      clickMetadataReviewItems: reviewItems.length,
      clickMetadataBugs: reviewItems.filter(({ category }) => category === 'stage-bug').length,
      clickMetadataInvestigations: reviewItems.filter(({ category }) => category === 'open-investigation').length,
      environmentContextRows: environmentGaps.length,
      environmentMissingPresence: environmentGaps.filter(({ presence }) => !presence).length,
      draftSheetRows: correctionRows.size,
      semanticOverrideRows: semanticOverrideRows.length,
    },
    sheetCorrectionDraft: [...correctionRows.values()],
    sheetCorrectionEvidence: Object.fromEntries(correctionEvidence),
    semanticOverrideDraft: semanticOverrideRows,
    reviewItems,
    environmentGaps,
    dispositions,
    pending,
  };
}

const esc = (value) => String(value ?? '').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
export function renderOfflineAnalysisMarkdown(analysis) {
  const s = analysis.summary;
  const dispositionRows = analysis.dispositions.map((row) => `| ${esc(row.bucket)} | ${esc(row.status)} | ${esc(row.reason)} | ${esc(row.page)} | ${esc(row.scenarioId)} |`).join('\n');
  const correctionRows = analysis.sheetCorrectionDraft.map((row) => `| ${esc(row.path)} | ${esc(row.id)} | ${esc(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !['path', 'id'].includes(key)))))} |`).join('\n');
  const semanticRows = analysis.semanticOverrideDraft.map((row) => `| ${esc(row.path)} | ${esc(row.id)} | ${esc(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !['path', 'id'].includes(key)))))} |`).join('\n');
  const reviewRows = analysis.reviewItems.map((row) => `| ${esc(row.category)} | ${esc(row.page)} | ${esc(row.scenarioId)} | ${esc(row.field)} | ${esc(row.golden)} | ${esc(row.got)} |`).join('\n');
  return `# Customer golden v23 offline triage

Generated ${analysis.generatedAt}. This is evidence and a non-applying correction draft.

## Summary

- Denominator: ${s.total}
- Captured: ${s.captured}; pending: ${s.pending}; blocked: ${s.blocked}
- Missing: ${s.missing}; unreproducible: ${s.unreproducible}; passive: ${s.passive}
- Captured page_cas_id exact pathname: ${s.pageCasIdExact}/${s.captured}
- Click-metadata review items: ${s.clickMetadataReviewItems} (${s.clickMetadataBugs} bugs, ${s.clickMetadataInvestigations} investigations)
- Environment/session-context differences: ${s.environmentContextRows}; missing fields: ${s.environmentMissingPresence}
- Draft tracking-sheet rows: ${s.draftSheetRows}
- Semantic override rows requiring approval: ${s.semanticOverrideRows}

## Draft tracking-sheet corrections

| Path | ID | Proposed residue |
|---|---|---|
${correctionRows || '| — | — | None |'}

## Semantic overrides requiring approval

| Path | ID | Proposed residue |
|---|---|---|
${semanticRows || '| — | — | None |'}

## Click-metadata review

| Category | Page | Scenario | Field | Golden | Stage |
|---|---|---|---|---|---|
${reviewRows || '| — | — | — | — | — | None |'}

## Non-captured dispositions

| Bucket | Status | Reason | Page | Scenario |
|---|---|---|---|---|
${dispositionRows || '| — | — | — | — | None |'}
`;
}

function parseArgs(argv) {
  const options = { golden: DEFAULT_GOLDEN, manifest: DEFAULT_MANIFEST, identityLock: DEFAULT_LOCK, deviations: DEFAULT_DEVIATIONS, state: DEFAULT_STATE, json: DEFAULT_JSON, markdown: DEFAULT_MARKDOWN };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--golden') options.golden = argv[++index];
    else if (argv[index] === '--manifest') options.manifest = argv[++index];
    else if (argv[index] === '--identity-lock') options.identityLock = argv[++index];
    else if (argv[index] === '--deviations') options.deviations = argv[++index];
    else if (argv[index] === '--state') options.state = argv[++index];
    else if (argv[index] === '--json-out') options.json = argv[++index];
    else if (argv[index] === '--markdown-out') options.markdown = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const golden = read(options.golden);
  const manifest = read(options.manifest);
  validateGoldenReplayManifest(manifest, golden, read(options.identityLock));
  const analysis = buildOfflineGoldenReplayAnalysis({
    golden, manifest, state: read(options.state), deviations: read(options.deviations),
  });
  writeFileSync(options.json, `${JSON.stringify(analysis, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(options.markdown, renderOfflineAnalysisMarkdown(analysis), { mode: 0o600 });
  chmodSync(options.json, 0o600);
  chmodSync(options.markdown, 0o600);
  console.log(JSON.stringify({ json: options.json, markdown: options.markdown, summary: analysis.summary }, null, 2));
  return analysis;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
