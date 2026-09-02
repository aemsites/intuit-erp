#!/usr/bin/env node
/**
 * live-capture-plan.mjs — emit the per-page RICH target list the live work-Chrome capture drives.
 *
 * The Playwright runner can't reach Intuit's VPN-gated OneTrust consent CDN (consent never
 * settles → utag never loads → no beacons), so live capture runs in the authenticated work
 * Chrome via the in-page engine (live-capture-engine.js). This projects the customer golden
 * into a stable, LOCATABLE target per entry: the click LABEL + every signal the engine's
 * location ladder can use — visible-text hints (prod ui_object_detail is often an internal id
 * like nav|accountants / ftr-global-legal-About, so we also derive the humanized/visible form),
 * external destination href, data-testid (arrows), nav/footer scope, arrow direction — plus
 * its contentKey (how the captured beacon is matched back). Passive chat:viewed impressions
 * are dropped (no click reproduces them).
 *
 *   node scripts/diff/live-capture-plan.mjs               # -> fixtures/local/capture-plan.json
 *   node scripts/diff/live-capture-plan.mjs --page /       # print one page's targets
 */
/* eslint-disable import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, no-underscore-dangle, no-nested-ternary */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeValue, isStructuralException } from './oracle-lib.mjs';

const GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const OUT = 'scripts/diff/fixtures/local/capture-plan.json';

const norm = (v) => normalizeValue({ normalizeTags: true }, v);
const stripBc = (v) => (typeof v === 'string' ? v.replace(/ \[[^\]]*\]$/, '') : v);
const contentKey = (p) => [p.object || '?', norm(stripBc(p.ui_object_detail)) || ''].join('¦');

const humanize = (s) => (s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const isInternalId = (s) => /[|]/.test(s || '') || /^(ftr[-|]|nav[|]|logo_nav|arrow_|scroll[_ ]|talktosales|customer_testimonial|qb_|articles[|]|feature[|])/i.test(s || '');

// A few internal-id → visible-text aliases the humanizer alone can't recover.
const ALIASES = {
  'nav|schedule_demo': ['schedule a demo', 'get a demo', 'book a demo', 'schedule demo'],
  'talktosales|open_widget': ['talk to sales', 'contact sales', 'chat', 'contact us'],
  'talktosales|close_widget': ['close', 'dismiss'],
};

function hintsFor(entry) {
  const p = entry.fullPayload.properties || {};
  const label = stripBc(p.ui_object_detail) || '';
  const hints = [];
  // 1. visible text signals (best) when not an internal id
  for (const cand of [entry.ctaLabel, entry.text]) if (cand && !isInternalId(cand)) hints.push(norm(cand));
  // 2. explicit aliases
  if (ALIASES[label]) hints.push(...ALIASES[label]);
  // 3. derived from the label
  if (label) {
    if (label.includes('|')) hints.push(humanize(label.split('|').pop()));
    const dash = label.match(/-([A-Za-z][A-Za-z ]*)$/); if (dash) hints.push(humanize(dash[1]));
    hints.push(humanize(label.replace(/^(ftr[-|]|nav[|]|logo_nav[|]|talktosales[|]|customer_testimonial[|]|qb_[a-z_]*[|]|articles[|]readmore[|]|feature[|])/i, '')));
    if (!isInternalId(label)) hints.push(norm(label));
  }
  return [...new Set(hints.map((h) => (h || '').trim()).filter((h) => h && h.length > 1))];
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--page') ? args[args.indexOf('--page') + 1] : null;
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const byPage = {};
  let dropped = 0;
  for (const e of golden.entries) {
    if (e.nonCta && isStructuralException(e.event)) { dropped++; continue; }
    const p = e.fullPayload.properties || {};
    const label = stripBc(p.ui_object_detail) || e.ctaLabel || e.text || '';
    const uap = p.ui_access_point || '';
    const da = e.dataAttributes || {};
    const lc = String(label).toLowerCase();
    const scope = (/^nav[|]/.test(label) || /(^|\|)(secondary_)?nav/i.test(uap)) ? 'nav'
      : (/^ftr/i.test(label) || /footer/i.test(uap)) ? 'footer' : null;
    const arrow = /arrow_left|scroll left|prev|chevron.?left|left_chevron/i.test(lc) ? 'left'
      : /arrow_right|scroll right|next|chevron.?right|right_chevron/i.test(lc) ? 'right' : null;
    (byPage[e.page] = byPage[e.page] || []).push({
      label,
      href: p.link_href || e.href || '',
      testid: (da['data-testid'] && !/^(button|link|image|icon|svg)$/i.test(da['data-testid'])) ? da['data-testid'] : '',
      scope,
      arrow,
      hints: hintsFor(e),
      key: e.key || '(loose)',
      event: e.event,
      contentKey: contentKey(p),
    });
  }
  if (only) { console.log(JSON.stringify(byPage[only] || [], null, 2)); return; }
  const plan = { golden: GOLDEN, generatedAt: new Date().toISOString(), pages: byPage };
  writeFileSync(OUT, JSON.stringify(plan, null, 2));
  const total = Object.values(byPage).reduce((s, a) => s + a.length, 0);
  console.log(`wrote ${OUT} — ${Object.keys(byPage).length} pages, ${total} targets (${dropped} passive impressions dropped)`);
  for (const [pg, ts] of Object.entries(byPage).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(ts.length).padStart(3)}  ${pg}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
