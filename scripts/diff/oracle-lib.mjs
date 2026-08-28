/**
 * oracle-lib.mjs — the shared, un-gameable brain of the customer-golden oracle.
 *
 * Both the offline synthetic gate (parity-gate.mjs, per-click subset) and the live
 * full-envelope gate (stage-parity.mjs, all 60) import this so the field taxonomy,
 * normalization, golden-integrity lock, and the ACROSS-THE-BOARD verdict are single-
 * sourced and identical. The design goal is that the ONLY way to raise the score is
 * the honest way (wire the block / improve the derive / author the residue) — every
 * shortcut is structurally refused:
 *
 *   - golden immutability .... assertIntegrity() re-hashes the golden's payloads; a
 *     hand-edit (e.g. stripping props to match) changes the hash -> throws.
 *   - full-field accounting .. every field must be GATED or PRESENCE in field-policy.json
 *     (verified by the policy-coverage check); an unclassified field is a FAIL, not a
 *     silent drop.
 *   - frozen presence list ... the ~29 non-matchable fields are present+shape only, each
 *     with a reason; the loop reads it read-only.
 *   - frozen exceptions ...... genuinely-unreproducible elements (chat impressions) are
 *     enumerated with a reason; the loop CANNOT add — a new wall triggers the stuck path.
 *   - MIN across axes ........ verdict is the WEAKEST of {overall, per-event, per-component,
 *     per-field, coverage}; you cannot average a weak component/field away.
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-plusplus, max-len, object-curly-newline, no-nested-ternary, no-param-reassign */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FIX = 'scripts/diff/fixtures';
export const POLICY = JSON.parse(readFileSync(`${FIX}/field-policy.json`, 'utf8'));
export const THRESHOLD = POLICY.threshold;

// ---- field taxonomy accessors (object-valued entries are specs; string notes skipped) --
const specEntries = (section, loc) => Object.entries((POLICY[section] && POLICY[section][loc]) || {}).filter(([, v]) => v && typeof v === 'object');
export const gatedSpecs = (loc) => specEntries('gated', loc);
export const presenceSpecs = (loc) => specEntries('presenceFrozen', loc);
// the per-click subset the OFFLINE synthetic gate can compute (derive-driven fields)
export const PER_CLICK = gatedSpecs('properties').filter(([, s]) => s.kind === 'per-click').map(([k]) => k);
// every gated properties field the LIVE gate value-matches
export const GATED_PROPS = gatedSpecs('properties').map(([k]) => k);
// what the OFFLINE synthetic gate scores: event + per-click fields minus liveOnly
// (navigation-derived fields the replica can't observe; those are gated LIVE only).
export const OFFLINE_GATED = ['event', ...gatedSpecs('properties').filter(([, s]) => s.kind === 'per-click' && !s.liveOnly).map(([k]) => k)];
// fetch a field's gated spec (for normalization in gatedMatch); '' when not gated.
const GATED_INDEX = Object.fromEntries(['envelope', 'properties', 'context'].flatMap((loc) => gatedSpecs(loc).map(([k, s]) => [`${loc}.${k}`, s])));
export const specOf = (loc, field) => GATED_INDEX[`${loc}.${field}`] || {};

// ---- normalization (documented, reviewed — never silent stripping) --------------------
const N = POLICY.normalize || {};
export function normalizeValue(spec, v) {
  if (typeof v !== 'string') return v;
  let s = v;
  if (spec.normalizeHost && N.host) {
    for (const from of N.host.from) s = s.split(from).join(N.host.to);
    // page-URL trailing-slash convention differs (prod emits ".../construction/", our EDS
    // ".../construction"); the destination is identical, so strip a single trailing slash
    // on host-bearing fields before compare. Documented, symmetric (applied to both sides).
    s = s.replace(/\/(?=$|[?#])/, '');
  }
  if (spec.normalizeEnv && N.env && N.env.map[s] != null) s = N.env.map[s];
  if (spec.normalizeTags || (N.stripTags || []).length) s = s.replace(/<[^>]*>/g, '');
  if (spec.stripBracket) s = s.replace(/ \[[^\]]*\]$/, '');
  if (N.trim !== false) s = s.trim().replace(/\s+/g, ' ');
  return s;
}
const canon = (spec, v) => { const s = normalizeValue(spec, v); return s === '' || s == null ? null : s; };
// index-tolerant compare: any positional index token (…_<digits>) -> …_N, so rw_card_1 and
// rw_card_2 (trail), or accordion_item_1 vs _2 (embedded in link_name), match on STRUCTURE not
// exact index. Global (not just segment-end) so it also catches mid-string ids in link_name.
const idxNorm = (v) => (typeof v === 'string' ? v.replace(/_\d+/g, '_N') : v);

/**
 * The value `got` is compared against for a gated field. Normally the golden's `want`, but for
 * pathname-derived fields (page_cas_id — the content id is now window.location.pathname, see
 * OVERRIDES.md) the frozen golden holds the OLD prod CMS id, so the expectation is the entry's own
 * pathname instead. Keeps the golden immutable while validating the new (present + equals-pathname)
 * behavior. Callers pass the entry's pathname.
 */
export const resolveWant = (spec, pathname, want) => (spec && spec.equalsPathname ? (pathname || '/') : want);

/** value-match one gated field. `want`=prod, `got`=ours. */
export function gatedMatch(spec, want, got) {
  if (spec.expectEmpty) return Array.isArray(got) ? got.length === 0 : (got == null);
  let a = canon(spec, want); let b = canon(spec, got);
  if (spec.indexTolerant) { a = idxNorm(a); b = idxNorm(b); }
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- golden integrity lock ------------------------------------------------------------
export function goldenHash(golden) {
  const payloads = (golden.entries || []).map((e) => JSON.stringify(e.fullPayload)).sort();
  return createHash('sha256').update(payloads.join('\n')).digest('hex');
}
/** throws if the golden was hand-edited since transform (hash/count mismatch). */
export function assertIntegrity(golden) {
  const m = golden.integrity;
  if (!m) throw new Error('golden has no integrity manifest — regenerate with payloads-to-golden.mjs');
  const n = (golden.entries || []).length;
  if (n !== m.payloads) throw new Error(`golden integrity: entry count ${n} != manifest ${m.payloads} — golden was edited; regenerate from source, do not hand-edit`);
  const h = goldenHash(golden);
  if (h !== m.sha256) throw new Error('golden integrity: payload hash mismatch — a fullPayload was edited (e.g. props stripped). Regenerate from the immutable source drop.');
  return true;
}

// ---- structural exceptions (frozen) ---------------------------------------------------
const EXC = (POLICY.structuralExceptions && POLICY.structuralExceptions.byEvent) || {};
export const isStructuralException = (event) => Object.prototype.hasOwnProperty.call(EXC, event);
export const exceptionReason = (event) => EXC[event];

// ---- across-the-board verdict ---------------------------------------------------------
const pct = (a, n) => (n ? +((100 * a) / n).toFixed(1) : 100);
const prefix = (tag, obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${tag}:${k}`, v]));

/**
 * results: [{ page, component, event, reproduced:bool, gated:{field:bool}, presence:{field:bool} }]
 * Reproduced items count toward the gated axes; structural-exception events are pulled
 * out and reported separately (never gated, but enumerated). Returns the full report +
 * a `verdict`/`score`/`weakest` and a `stuck` payload (what a human must resolve).
 */
export function verdict(results, { threshold = THRESHOLD } = {}) {
  const exceptions = results.filter((r) => isStructuralException(r.event));
  const gable = results.filter((r) => !isStructuralException(r.event));
  const reproduced = gable.filter((r) => r.reproduced);

  const axisAgg = (keyFn) => {
    const m = {};
    for (const r of reproduced) {
      const k = keyFn(r); (m[k] = m[k] || { a: 0, n: 0 });
      for (const ok of Object.values(r.gated)) { m[k].n++; if (ok) m[k].a++; }
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pct(v.a, v.n)]));
  };
  const byEvent = axisAgg((r) => r.event);
  const byComponent = axisAgg((r) => r.component || '(loose)');
  // per-field across all reproduced
  const fieldAgg = {};
  for (const r of reproduced) for (const [f, ok] of Object.entries(r.gated)) { (fieldAgg[f] = fieldAgg[f] || { a: 0, n: 0 }); fieldAgg[f].n++; if (ok) fieldAgg[f].a++; }
  const byField = Object.fromEntries(Object.entries(fieldAgg).map(([f, v]) => [f, pct(v.a, v.n)]));

  let gA = 0; let gN = 0; for (const r of reproduced) for (const ok of Object.values(r.gated)) { gN++; if (ok) gA++; }
  const overall = pct(gA, gN);
  const denom = gable.length; // structural exceptions excluded from the denominator (frozen/enumerated)
  const coverage = pct(reproduced.length, denom);

  // presence must be 100 across everything captured (gable + exceptions still carry context)
  let pA = 0; let pN = 0;
  for (const r of results) for (const ok of Object.values(r.presence || {})) { pN++; if (ok) pA++; }
  const presence = pct(pA, pN);

  const axes = { overall, coverage, ...prefix('event', byEvent), ...prefix('component', byComponent), ...prefix('field', byField) };
  const weakest = Object.entries(axes).sort((a, b) => a[1] - b[1])[0] || ['overall', 100];
  const score = weakest[1];
  const pass = score >= threshold && presence >= 100;

  // stuck report: every axis below threshold + the offending elements, so a human knows
  // exactly what to resolve (or whether a frozen-exception is warranted).
  const belowByComponent = Object.entries(byComponent).filter(([, p]) => p < threshold).map(([k]) => k);
  const stuck = {
    weakest_axis: `${weakest[0]}=${weakest[1]}`,
    presence_ok: presence >= 100,
    failing_components: Object.fromEntries(Object.entries(byComponent).filter(([, p]) => p < threshold)),
    failing_fields: Object.fromEntries(Object.entries(byField).filter(([, p]) => p < threshold)),
    failing_events: Object.fromEntries(Object.entries(byEvent).filter(([, p]) => p < threshold)),
    unreproduced: gable.filter((r) => !r.reproduced).map((r) => ({ page: r.page, component: r.component, event: r.event })),
    example_field_misses: reproduced.filter((r) => belowByComponent.includes(r.component || '(loose)'))
      .flatMap((r) => Object.entries(r.gated).filter(([, ok]) => !ok).map(([f]) => ({ page: r.page, component: r.component, field: f })))
      .slice(0, 40),
  };

  return {
    threshold,
    score,
    verdict: pass ? 'PASS' : 'FAIL',
    weakest: `${weakest[0]}=${weakest[1]}%`,
    presence_pct: presence,
    axes: { overall, coverage, byEvent, byComponent, byField },
    reproduced: reproduced.length,
    gable: gable.length,
    structural_exceptions: exceptions.map((r) => ({ page: r.page, event: r.event, reason: exceptionReason(r.event) })),
    stuck: pass ? null : stuck,
  };
}
