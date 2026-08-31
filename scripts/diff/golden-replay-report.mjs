#!/usr/bin/env node
/**
 * Builds the exhaustive customer-golden report from a completed authenticated
 * replay checkpoint. Scenario IDs preserve duplicate/variant identity; the
 * field policy makes every accepted deviation explicit rather than silently
 * normalizing it away.
 */
/* eslint-disable import/extensions, no-console, no-restricted-syntax, no-continue, no-plusplus, prefer-destructuring, newline-per-chained-call, max-len, object-curly-newline, no-nested-ternary */
import {
  chmodSync, readFileSync, writeFileSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  gatedMatch, gatedSpecs, normalizeValue, presenceSpecs, resolveWant, THRESHOLD,
} from './oracle-lib.mjs';
import { validateGoldenReplayManifest } from './golden-replay-manifest.mjs';

const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_MANIFEST = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const DEFAULT_LOCK = '.jig/click-tracking-harness/evidence/customer-golden-identity-lock.json';
const DEFAULT_DEVIATIONS = 'scripts/diff/fixtures/clicktrack-deviation-registry.json';
const DEFAULT_STATE = 'scripts/diff/fixtures/local/clicktrack-golden-replay-run-v23.json';
const DEFAULT_JSON = 'scripts/diff/fixtures/local/clicktrack-golden-replay-report.json';
const DEFAULT_HTML = 'CLICK-TRACKING-GOLDEN-REPLAY-REPORT.html';

const readField = (payload, location, field) => (location === 'envelope' ? payload?.[field] : payload?.[location]?.[field]);
const shown = (value) => {
  if (value === undefined) return '‹absent›';
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const percent = (matched, total) => (total ? +((100 * matched) / total).toFixed(1) : 100);
const ACCEPTED = new Set(['expected-migration', 'production-data-quality', 'approved-golden-correction']);
const FIELD_CATEGORIES = [
  'exact-match', ...ACCEPTED, 'stage-bug', 'open-investigation', 'environment-session-context',
];

function validateDeviationRegistry(registry = { entries: [] }) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.entries)) {
    throw new Error('deviation registry must use schemaVersion 1 and contain entries');
  }
  const ids = new Set();
  registry.entries.forEach((entry) => {
    const required = [entry.id, entry.classification, entry.policy, entry.scope?.location,
      entry.scope?.field, entry.scope?.scenarioId, entry.rationale, entry.evidence,
      entry.owner, entry.reviewDate];
    if (required.some((value) => value == null || value === '')) throw new Error(`incomplete deviation adjudication: ${entry.id || '(missing id)'}`);
    if (!ACCEPTED.has(entry.classification)) throw new Error(`invalid accepted deviation classification: ${entry.classification}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewDate)) throw new Error(`invalid deviation review date: ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`duplicate deviation id: ${entry.id}`);
    ids.add(entry.id);
  });
  return registry;
}

function findAdjudication(registry, scenario, location, field, policy) {
  const matches = registry.entries.filter((entry) => entry.policy === policy
    && entry.scope.location === location && entry.scope.field === field
    && ['*', scenario.scenarioId].includes(entry.scope.scenarioId));
  const exact = matches.filter((entry) => entry.scope.scenarioId === scenario.scenarioId);
  const candidates = exact.length ? exact : matches;
  if (candidates.length > 1) throw new Error(`ambiguous deviation adjudication: ${scenario.scenarioId} ${location}.${field}`);
  return candidates[0] || null;
}

function axisSummary(rows, key, matchField) {
  const aggregate = new Map();
  rows.forEach((row) => {
    const group = key(row);
    const count = aggregate.get(group) || { matched: 0, total: 0 };
    count.total += 1;
    if (row[matchField] === true) count.matched += 1;
    aggregate.set(group, count);
  });
  const groups = Object.fromEntries([...aggregate].map(([group, count]) => [group, {
    ...count,
    percent: percent(count.matched, count.total),
  }]));
  const score = Math.min(100, ...Object.values(groups).map(({ percent: value }) => value));
  return { score, groups };
}

function axesSummary(rows, matchField) {
  const axes = {
    page: axisSummary(rows, (row) => row.page, matchField),
    event: axisSummary(rows, (row) => row.event, matchField),
    component: axisSummary(rows, (row) => row.component, matchField),
    field: axisSummary(rows, (row) => `${row.location}.${row.field}`, matchField),
  };
  const [weakest, axis] = Object.entries(axes).sort((left, right) => left[1].score - right[1].score)[0];
  return {
    score: axis.score,
    weakest: `${weakest}=${axis.score}%`,
    axes,
    matched: rows.filter((row) => row[matchField] === true).length,
    total: rows.length,
  };
}

function matchPolicy(scenario, location, field, spec, goldenValue, expected, got, match, registry) {
  if (!match) {
    const expectedNormalized = normalizeValue(spec, expected);
    const gotNormalized = normalizeValue(spec, got);
    if (field === 'channel_cookie_90day') {
      return { category: 'environment-session-context', policy: 'environment-attribution' };
    }
    const fragmentLimited = ['url', 'link_href'].includes(field)
      && typeof expectedNormalized === 'string' && typeof gotNormalized === 'string'
      && expectedNormalized.split('#', 1)[0] === gotNormalized.split('#', 1)[0];
    const policy = fragmentLimited ? 'url-fragment-evidence-limited' : 'value-mismatch';
    const adjudication = findAdjudication(registry, scenario, location, field, policy);
    if (adjudication?.scope.scenarioId === scenario.scenarioId) {
      return { category: adjudication.classification, policy, adjudication };
    }
    return { category: fragmentLimited ? 'open-investigation' : 'stage-bug', policy };
  }
  if (same(goldenValue, got)) return { category: 'exact-match', policy: 'exact' };
  const goldenNormalized = normalizeValue(spec, goldenValue);
  const expectedNormalized = normalizeValue(spec, expected);
  let policy = 'policy-equivalence';
  if (spec.equalsPathname && !same(goldenNormalized, expectedNormalized)) {
    policy = 'pathname-policy';
  } else if (spec.indexTolerant) policy = 'index-tolerant';
  else if (spec.normalizeHost || spec.normalizeEnv || spec.normalizeTags || spec.stripBracket) policy = 'normalized-equivalence';
  const adjudication = findAdjudication(registry, scenario, location, field, policy);
  return adjudication
    ? { category: adjudication.classification, policy, adjudication }
    : { category: 'open-investigation', policy, adjudication: null };
}

const locationFields = (payload, location) => {
  const object = location === 'envelope' ? payload : payload?.[location];
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
  return Object.entries(object).filter(([field]) => location !== 'envelope'
    || !['properties', 'context', 'integrations'].includes(field));
};

export function fieldRows(entry, scenario, outcome, deviations = { schemaVersion: 1, entries: [] }) {
  if (outcome.status !== 'captured') return [];
  const registry = validateDeviationRegistry(deviations);
  const rows = [];
  const goldenPayload = entry.fullPayload;
  const stagePayload = outcome.payload;
  for (const location of ['envelope', 'properties', 'context', 'integrations']) {
    const gated = new Map(gatedSpecs(location));
    const frozen = new Map(presenceSpecs(location));
    for (const [field, goldenValue] of locationFields(goldenPayload, location)) {
      const spec = gated.get(field);
      const presenceSpec = frozen.get(field);
      const got = readField(stagePayload, location, field);
      const present = got !== undefined;
      if (!spec && presenceSpec) {
        rows.push({
          scenarioId: scenario.scenarioId,
          page: scenario.page,
          event: entry.event,
          component: entry.key || '(loose)',
          field,
          location,
          bucket: 'presence',
          kind: presenceSpec.group || '',
          golden: shown(goldenValue),
          expected: '‹present + shape only›',
          got: shown(got),
          rawMatch: same(goldenValue, got),
          policyMatch: null,
          presence: present,
          match: present,
          category: 'environment-session-context',
          policy: present ? `presence-${presenceSpec.group}` : `presence-missing-${presenceSpec.group}`,
        });
        continue;
      }
      if (!spec) {
        const rawMatch = same(goldenValue, got);
        rows.push({
          scenarioId: scenario.scenarioId,
          page: scenario.page,
          event: entry.event,
          component: entry.key || '(loose)',
          field,
          location,
          bucket: 'gated',
          kind: 'unclassified-policy-field',
          golden: shown(goldenValue),
          expected: shown(goldenValue),
          got: shown(got),
          rawMatch,
          policyMatch: rawMatch ? true : null,
          presence: present,
          match: rawMatch,
          category: rawMatch ? 'exact-match' : 'open-investigation',
          policy: 'unclassified-field-policy',
        });
        continue;
      }
      const expected = resolveWant(spec, entry.page, goldenValue);
      const match = present && gatedMatch(spec, expected, got);
      const classification = matchPolicy(scenario, location, field, spec, goldenValue, expected, got, match, registry);
      const policyMatch = classification.category === 'exact-match' || ACCEPTED.has(classification.category)
        ? true : (classification.category === 'stage-bug' ? false : null);
      rows.push({
        scenarioId: scenario.scenarioId,
        page: scenario.page,
        event: entry.event,
        component: entry.key || '(loose)',
        field,
        location,
        bucket: 'gated',
        kind: spec.kind || '',
        golden: shown(goldenValue),
        expected: shown(normalizeValue(spec, expected)),
        got: shown(got),
        rawMatch: same(goldenValue, got),
        policyMatch,
        presence: present,
        match,
        ...classification,
      });
    }
  }
  return rows;
}

function eventCategory(outcome) {
  if (outcome.status === 'passive') return 'unreproducible-passive-event';
  return 'capture-state';
}

export function buildGoldenReplayReport({ golden, manifest, state, deviations = { schemaVersion: 1, entries: [] } }) {
  validateDeviationRegistry(deviations);
  if (state.status !== 'complete' || state.resume?.nextScenarioId != null || state.coverage?.pending !== 0) {
    throw new Error('complete replay state is required');
  }
  if (!state.binding?.manifest || !manifest.manifestContentHash || !manifest.goldenMappingHash) {
    throw new Error('complete replay binding is required');
  }
  if (state.binding.manifest.contentHash !== manifest.manifestContentHash
    || state.binding.manifest.mappingHash !== manifest.goldenMappingHash) {
    throw new Error('replay state does not match the reviewed golden manifest');
  }
  const entries = new Map(golden.entries.map((entry) => [entry.payloadFile, entry]));
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const seen = new Set();
  const events = [];
  const fields = [];
  for (const outcome of state.outcomes) {
    const scenario = scenarios.get(outcome.scenarioId);
    if (!scenario || seen.has(outcome.scenarioId)) throw new Error(`invalid replay scenario identity: ${outcome.scenarioId}`);
    seen.add(outcome.scenarioId);
    const entry = entries.get(scenario.goldenRef.payloadFile);
    if (!entry) throw new Error(`golden payload mapping is missing: ${outcome.scenarioId}`);
    const rows = fieldRows(entry, scenario, outcome, deviations);
    fields.push(...rows);
    events.push({
      scenarioId: scenario.scenarioId,
      page: scenario.page,
      event: entry.event,
      component: entry.key || '(loose)',
      label: scenario.targetSignature?.uiObjectDetail || entry.ctaLabel || entry.text || '',
      status: outcome.status,
      category: eventCategory(outcome),
      reason: outcome.reason || '',
      duplicate: Boolean(outcome.classification?.duplicate),
      variant: Boolean(outcome.classification?.variant),
      pageCasId: outcome.payload?.properties?.page_cas_id || '',
      fieldTotal: rows.length,
      fieldBugs: rows.filter((row) => row.category === 'stage-bug').length,
    });
  }
  if (seen.size !== manifest.scenarios.length || events.length !== golden.entries.length) {
    throw new Error('report denominator does not match the immutable golden manifest');
  }
  const capturedEvents = events.filter((event) => event.status === 'captured');
  const exactPathname = capturedEvents.filter((event) => event.pageCasId === event.page).length;
  const pageCasId = {
    captured: capturedEvents.length,
    exactPathname,
    percent: capturedEvents.length ? percent(exactPathname, capturedEvents.length) : 0,
    verdict: exactPathname === capturedEvents.length ? 'PASS' : 'FAIL',
    failures: capturedEvents.filter((event) => event.pageCasId !== event.page).map((event) => event.scenarioId),
  };
  const fieldCounts = Object.fromEntries(FIELD_CATEGORIES
    .map((category) => [category, fields.filter((row) => row.category === category).length]));
  const eventCounts = Object.fromEntries([...new Set(events.map((event) => event.status))]
    .map((status) => [status, events.filter((event) => event.status === status).length]));
  const capturedCoveragePercent = percent(capturedEvents.length, events.length);
  const replayableDenominator = capturedEvents.length + (eventCounts.blocked || 0);
  const coverage = {
    captured: capturedEvents.length,
    total: events.length,
    percent: capturedCoveragePercent,
    replayablePercent: percent(capturedEvents.length, replayableDenominator),
    captureFailures: (eventCounts.blocked || 0) + (eventCounts.missing || 0) + (eventCounts.unreproducible || 0),
    staleCaptures: events.filter((event) => event.status === 'stale' || /stale/i.test(event.reason)).length,
  };
  const gatedRows = fields.filter((row) => row.bucket === 'gated');
  const policyRows = gatedRows.filter((row) => row.category === 'exact-match'
    || ACCEPTED.has(row.category) || row.category === 'stage-bug');
  const rawExact = axesSummary(fields, 'rawMatch');
  const policyAdjusted = {
    ...axesSummary(policyRows, 'policyMatch'),
    threshold: THRESHOLD,
    investigations: fieldCounts['open-investigation'],
  };
  const presenceRows = fields.filter((row) => row.bucket === 'presence');
  const present = presenceRows.filter((row) => row.presence).length;
  const presence = {
    present,
    total: presenceRows.length,
    gaps: presenceRows.length - present,
    percent: percent(present, presenceRows.length),
    verdict: present === presenceRows.length ? 'PASS' : 'FAIL',
  };
  const contextRows = fields.filter((row) => row.category === 'environment-session-context');
  const context = {
    rows: contextRows.length,
    differences: contextRows.filter((row) => !row.rawMatch).length,
    missingPresence: contextRows.filter((row) => !row.presence).length,
  };
  policyAdjusted.verdict = fieldCounts['open-investigation'] ? 'BLOCKED'
    : (policyAdjusted.score < THRESHOLD ? 'FAIL' : 'PASS');
  const closureVerdict = [policyAdjusted.verdict, presence.verdict, pageCasId.verdict].includes('FAIL')
    ? 'FAIL' : (policyAdjusted.verdict === 'BLOCKED' ? 'BLOCKED' : 'PASS');
  return {
    schemaVersion: 1,
    source: 'complete-customer-golden-authenticated-replay',
    generatedAt: new Date().toISOString(),
    binding: state.binding,
    deployment: state.deployment,
    summary: {
      totalEvents: events.length,
      eventCounts,
      capturedCoveragePercent,
      replayableCapturePercent: coverage.replayablePercent,
      coverage,
      fieldCounts,
      acceptedDeviations: fields.filter((row) => ACCEPTED.has(row.category)).length,
      actionableBugs: fieldCounts['stage-bug'],
      openInvestigations: fieldCounts['open-investigation'],
      pageCasId,
      rawExact,
      policyAdjusted,
      parity: policyAdjusted,
      presence,
      context,
      closureVerdict,
    },
    events,
    fields,
  };
}

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderGoldenReplayHtml(report) {
  const data = JSON.stringify(report).replace(/</g, '\\u003c');
  const summary = report.summary;
  const options = (values) => [...new Set(values)].filter(Boolean).sort()
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Intuit ERP customer golden parity</title><style>
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#3fb950;--red:#f85149;--amber:#d29922;--blue:#58a6ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{padding:20px 24px;border-bottom:1px solid var(--line)}h1{margin:0 0 5px;font-size:20px}.sub{color:var(--muted)}.callout{margin-top:10px;padding:9px 12px;border-left:3px solid var(--blue);background:var(--card)}.cards{display:flex;flex-wrap:wrap;gap:10px;padding:14px 24px}.card{min-width:145px;padding:10px 13px;background:var(--card);border:1px solid var(--line);border-radius:8px}.n{font-size:21px;font-weight:650}.l{font-size:10px;text-transform:uppercase;color:var(--muted)}.good{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.filters{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:7px;padding:10px 24px;background:var(--bg);border-block:1px solid var(--line)}select,input{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:5px 7px}.tabs{padding:8px 24px}.tabs button{background:var(--card);color:var(--text);border:1px solid var(--line);padding:6px 10px}.tabs button.active{border-color:var(--blue);color:var(--blue)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px 9px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{position:sticky;top:49px;background:var(--card)}.pill{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px}.captured,.exact-match{color:var(--green);background:#14351f}.stage-bug,.capture-state{color:var(--red);background:#3d1919}.open-investigation{color:var(--blue);background:#172d45}.environment-session-context{color:var(--muted);background:#21262d}.expected-migration,.production-data-quality,.approved-golden-correction,.unreproducible-passive-event{color:var(--amber);background:#352b14}.muted{color:var(--muted)}.hide{display:none}.count{margin-left:auto;color:var(--muted)}</style></head><body>
<header><h1>Customer golden click-tracking parity</h1><div class="sub">Authenticated stage replay · ${escapeHtml(report.generatedAt)} · immutable denominator ${summary.totalEvents} events</div><div class="callout"><b>Dual-score policy:</b> raw exact equality never changes when a migration deviation is accepted. Policy-adjusted parity counts exact and expected deviations, excludes environment/session context, and is the weakest page/event/component/field axis. Open investigations block PASS without entering its denominator.</div><div class="callout"><b>page_cas_id policy:</b> production’s authored CMS code is intentionally replaced by the stage pathname. The independent gate passes only when every captured value exactly equals its event page.</div></header>
<div class="cards"><div class="card"><div class="n ${summary.closureVerdict === 'PASS' ? 'good' : (summary.closureVerdict === 'BLOCKED' ? 'warn' : 'bad')}">${summary.closureVerdict}</div><div class="l">Closure verdict</div></div><div class="card"><div class="n">${summary.rawExact.score}%</div><div class="l">Raw exact score</div></div><div class="card"><div class="n ${summary.policyAdjusted.verdict === 'PASS' ? 'good' : (summary.policyAdjusted.verdict === 'BLOCKED' ? 'warn' : 'bad')}">${summary.policyAdjusted.score}% · ${summary.policyAdjusted.verdict}</div><div class="l">Policy-adjusted score</div></div><div class="card"><div class="n ${summary.actionableBugs ? 'bad' : 'good'}">${summary.actionableBugs}</div><div class="l">Actionable bugs</div></div><div class="card"><div class="n warn">${summary.openInvestigations}</div><div class="l">Open investigations</div></div><div class="card"><div class="n ${summary.presence.verdict === 'PASS' ? 'good' : 'bad'}">${summary.presence.percent}% · ${summary.presence.gaps} gaps</div><div class="l">Context presence</div></div><div class="card"><div class="n">${summary.coverage.percent}%</div><div class="l">Scenario coverage</div></div><div class="card"><div class="n ${summary.pageCasId.verdict === 'PASS' ? 'good' : 'bad'}">${summary.pageCasId.percent}%</div><div class="l">page_cas_id exact pathname</div></div><div class="card"><div class="n warn">${summary.acceptedDeviations}</div><div class="l">Accepted deviations</div></div><div class="card"><div class="n bad">${summary.coverage.captureFailures}</div><div class="l">Capture failures</div></div><div class="card"><div class="n ${summary.coverage.staleCaptures ? 'bad' : 'good'}">${summary.coverage.staleCaptures}</div><div class="l">Stale captures</div></div></div>
<div class="tabs"><button id="events-tab" class="active">Events</button><button id="fields-tab">Fields</button></div>
<div class="filters"><select id="page"><option value="">All pages</option>${options(report.events.map((row) => row.page))}</select><select id="status"><option value="">All statuses</option>${options(report.events.map((row) => row.status))}</select><select id="category"><option value="">All categories</option>${options([...report.events, ...report.fields].map((row) => row.category))}</select><select id="field"><option value="">All fields</option>${options(report.fields.map((row) => row.field))}</select><input id="search" type="search" placeholder="search"><label><input id="deviations" type="checkbox"> deviations only</label><span id="count" class="count"></span></div>
<table id="events"><thead><tr><th>Page</th><th>Scenario</th><th>Event</th><th>Element</th><th>Status</th><th>Category</th><th>Reason</th><th>page_cas_id</th><th>Field bugs</th></tr></thead><tbody></tbody></table>
<table id="fields" class="hide"><thead><tr><th>Page</th><th>Scenario</th><th>Field</th><th>Location</th><th>Golden prod</th><th>Policy expectation</th><th>Stage captured</th><th>Raw equality</th><th>Policy equality</th><th>Presence</th><th>Category</th><th>Policy</th><th>Adjudication</th></tr></thead><tbody></tbody></table>
<script>const R=${data};let mode='events';const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),yn=v=>v==null?'—':v?'✓':'✗';function pill(v){return '<span class="pill '+v+'">'+esc(v)+'</span>'}function audit(a){return a?esc(a.rationale)+'<br><span class="muted">'+esc(a.evidence)+' · '+esc(a.owner)+' · '+esc(a.reviewDate)+'</span>':'—'}function filtered(){const rows=mode==='events'?R.events:R.fields,p=$('page').value,s=$('status').value,c=$('category').value,f=$('field').value,q=$('search').value.toLowerCase(),d=$('deviations').checked;return rows.filter(r=>(!p||r.page===p)&&(mode!=='events'||!s||r.status===s)&&(!c||r.category===c)&&(mode!=='fields'||!f||r.field===f)&&(!d||(mode==='events'?r.status!=='captured':r.category!=='exact-match'))&&(!q||JSON.stringify(r).toLowerCase().includes(q)))}function render(){const rows=filtered();$('count').textContent=rows.length+' rows';if(mode==='events')$('events').querySelector('tbody').innerHTML=rows.map(r=>'<tr><td>'+esc(r.page)+'</td><td>'+esc(r.scenarioId)+'</td><td>'+esc(r.event)+'</td><td>'+esc(r.label)+'</td><td>'+pill(r.status)+'</td><td>'+pill(r.category)+'</td><td class="muted">'+esc(r.reason)+'</td><td>'+esc(r.pageCasId)+'</td><td>'+r.fieldBugs+'</td></tr>').join('');else $('fields').querySelector('tbody').innerHTML=rows.map(r=>'<tr><td>'+esc(r.page)+'</td><td>'+esc(r.scenarioId)+'</td><td>'+esc(r.field)+'</td><td>'+esc(r.location)+'</td><td class="muted">'+esc(r.golden)+'</td><td>'+esc(r.expected)+'</td><td>'+esc(r.got)+'</td><td>'+yn(r.rawMatch)+'</td><td>'+yn(r.policyMatch)+'</td><td>'+yn(r.presence)+'</td><td>'+pill(r.category)+'</td><td>'+esc(r.policy)+'</td><td>'+audit(r.adjudication)+'</td></tr>').join('')}function tab(next){mode=next;$('events').classList.toggle('hide',next!=='events');$('fields').classList.toggle('hide',next!=='fields');$('events-tab').classList.toggle('active',next==='events');$('fields-tab').classList.toggle('active',next==='fields');render()}$('events-tab').onclick=()=>tab('events');$('fields-tab').onclick=()=>tab('fields');['page','status','category','field','deviations'].forEach(id=>$(id).onchange=render);$('search').oninput=render;render();</script></body></html>`;
}

function parseArgs(argv) {
  const options = { golden: DEFAULT_GOLDEN, manifest: DEFAULT_MANIFEST, identityLock: DEFAULT_LOCK, deviations: DEFAULT_DEVIATIONS, state: DEFAULT_STATE, json: DEFAULT_JSON, html: DEFAULT_HTML };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--golden') options.golden = argv[++index];
    else if (argv[index] === '--manifest') options.manifest = argv[++index];
    else if (argv[index] === '--identity-lock') options.identityLock = argv[++index];
    else if (argv[index] === '--deviations') options.deviations = argv[++index];
    else if (argv[index] === '--state') options.state = argv[++index];
    else if (argv[index] === '--json-out') options.json = argv[++index];
    else if (argv[index] === '--html-out') options.html = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const golden = JSON.parse(readFileSync(options.golden, 'utf8'));
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  validateGoldenReplayManifest(manifest, golden, JSON.parse(readFileSync(options.identityLock, 'utf8')));
  const report = buildGoldenReplayReport({
    golden,
    manifest,
    state: JSON.parse(readFileSync(options.state, 'utf8')),
    deviations: JSON.parse(readFileSync(options.deviations, 'utf8')),
  });
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(options.html, renderGoldenReplayHtml(report), { mode: 0o600 });
  chmodSync(options.json, 0o600);
  chmodSync(options.html, 0o600);
  console.log(JSON.stringify({ json: options.json, html: options.html, summary: report.summary }, null, 2));
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
