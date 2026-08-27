#!/usr/bin/env node
/**
 * payloads-to-golden.mjs — turn the CUSTOMER's authoritative prod beacons into a
 * second click-tracking golden, in the SAME shape parity-gate.mjs already consumes.
 *
 * Input (local only — campaign codes / session ids, gitignored):
 *   scripts/diff/fixtures/local/customer-payloads/element_payload_mapping.json
 *   scripts/diff/fixtures/local/customer-payloads/payloads/*.json
 * where the mapping ties each payload file to its page_url, event_name, a cta_label,
 * and the real authored DOM data-* attributes; each payload is the full Segment
 * `track` POST body captured at eventbus (envelope + ~60 `properties`).
 *
 * Output (local only, gitignored):
 *   scripts/diff/fixtures/local/clicktrack-golden-customer.json
 * A RICH golden: each entry is a SUPERSET of the normalized entry parity-gate reads
 * ({ page, key, href, text, exp, nonCta }) plus { event, uiAccessPoint, dataAttributes,
 * fullPayload, payloadFile, ctaLabel } for the full-envelope live diff (stage-parity.mjs)
 * and the contract audit. parity-gate ignores the extra fields, so this one file feeds
 * both the synthetic gate and the live runner.
 *
 *   node scripts/diff/payloads-to-golden.mjs            # write the golden + report
 *   node scripts/diff/payloads-to-golden.mjs --json     # machine JSON summary only
 *
 * WHY a second golden: clicktrack-golden.json is what WE reverse-engineered from prod;
 * this one is what the CUSTOMER says prod emits. It cross-checks ours (golden-crosscheck.mjs)
 * and, via its fullPayload, lets stage-parity.mjs validate the whole envelope end-to-end.
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, no-continue, no-console, no-plusplus, max-len, object-curly-newline, object-property-newline, no-nested-ternary */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { goldenHash } from './oracle-lib.mjs';

const DIR = 'scripts/diff/fixtures/local/customer-payloads';
const OUT = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';

// The 11 DOM-derivable per-click fields parity-gate diffs (must match its DIFF_FIELDS).
const DIFF_FIELDS = ['event', 'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point', 'data-wa-link', 'icom_user_action', 'link_name'];

// ui_access_point top-level segment -> our EDS block key (the parity-gate BLOCK map).
// Grounded in recon: the customer's uap prefixes are ~1:1 with trails parity-gate models.
const UAP_TO_KEY = {
  accordion: 'faq',
  rw_cards_container: 'cards',
  rw2_hero: 'hero',
  cta_block: 'cta',
  qrc_article_hero: 'case-study-header',
  qrc_content_card_grid: 'related-blogs',
  talk_to_sales: 'talk-to-sales',
  footer: 'footer',
  video: 'video',
  rw_testimonial: 'testimonial',
  rw_banner: 'product_banner',
  feature: 'feature',
  quick_links: 'quick_links',
  social_media: 'social',
  TableOfContents: 'toc',
  secondary_nav: 'secondary-nav',
  author_bio: 'author_bio',
};

// object_detail prefix -> key, for entries with NO ui_access_point (nav / loose CTAs).
// ONLY reliable prefixes belong here: a prefix that names the tracker's object_detail
// namespace, not a block. `feature|`/`testimonial|` were dropped — a loose wa-link CTA
// like `feature|explore_agents_cta` (no trail) is NOT a feature-grid element, and mapping
// it to a block invents a trail prod never emitted. The ui_access_point trail (UAP_TO_KEY)
// is the authoritative block signal; object_detail is only a last-resort fallback.
const OBJDETAIL_TO_KEY = {
  nav: 'nav',
  hero: 'hero',
  faq: 'faq',
  disclaimer: 'disclaimer',
  talktosales: 'talk-to-sales',
};

const normPath = (u) => {
  const p = String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return p || '/';
};
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();

// Reconstruction hint for parity-gate: it builds an <a> when href is truthy, else a
// <button>. Give link-shaped elements a href so ours derives ui_object=link too; leave
// button/semantic shapes href-less. Real link_href wins when the payload carried one.
function reconstructHref(props) {
  if (props.link_href) return props.link_href;
  const uio = props.ui_object;
  if (uio === 'link' || uio === 'link_icon') return 'https://erp.intuit.com/';
  return '';
}

// Map an entry to our block key. chat impressions have no EDS equivalent (passive
// widget-rendered beacon) -> flagged nonCta so the gate counts them as not-yet-reproduced.
function classify(props) {
  const uap = props.ui_access_point;
  const uapHead = uap && uap !== '' ? uap.split('|')[0] : null;
  if (props.object === 'chat') return { key: 'chat', nonCta: true };
  if (uapHead && uapHead !== 'page' && UAP_TO_KEY[uapHead]) return { key: UAP_TO_KEY[uapHead], nonCta: false };
  const od = props.object_detail || '';
  const odHead = od.includes('|') ? od.split('|')[0] : (od.includes(' ') ? '' : od);
  if (OBJDETAIL_TO_KEY[odHead]) return { key: OBJDETAIL_TO_KEY[odHead], nonCta: false };
  // no trail + no recognizable prefix => loose content CTA (parity-gate pure-derive, key '')
  return { key: '', nonCta: false };
}

function main() {
  const mapPath = `${DIR}/element_payload_mapping.json`;
  if (!existsSync(mapPath)) {
    console.error(`Missing ${mapPath}. Vendor the customer drop into ${DIR}/ first (gitignored).`);
    process.exit(2);
  }
  const mapping = JSON.parse(readFileSync(mapPath, 'utf8'));
  const entries = [];
  const pages = new Set();
  const unmapped = [];
  const keyCounts = {};
  const eventCounts = {};
  const fieldUnion = new Set();

  for (const m of mapping) {
    const pf = `${DIR}/${m.payload_file}`;
    if (!existsSync(pf)) { console.warn(`  ! payload file missing: ${m.payload_file}`); continue; }
    const { payload } = JSON.parse(readFileSync(pf, 'utf8'));
    const props = payload.properties || {};
    const page = normPath(m.page_url);
    pages.add(page);
    const { key, nonCta } = classify(props);
    const exp = {};
    for (const f of DIFF_FIELDS) if (props[f] !== undefined && props[f] !== null) exp[f] = props[f];
    const entry = {
      nonCta,
      page,
      key,
      text: stripTags(props.ui_object_detail) || m.cta_label || '',
      href: reconstructHref(props),
      exp,
      // --- rich fields (ignored by parity-gate; used by stage-parity + contract-audit) ---
      event: props.event || m.event_name,
      uiAccessPoint: props.ui_access_point ?? null,
      ctaLabel: m.cta_label ?? null,
      ctaLabelSource: m.cta_label_source ?? null,
      dataAttributes: m.data_attributes ?? null,
      payloadFile: m.payload_file,
      fullPayload: payload,
    };
    entries.push(entry);
    for (const k of Object.keys(props)) fieldUnion.add(`properties.${k}`);
    for (const k of Object.keys(payload)) if (!['properties', 'context', 'integrations'].includes(k)) fieldUnion.add(`envelope.${k}`);
    for (const k of Object.keys(payload.context || {})) fieldUnion.add(`context.${k}`);
    for (const k of Object.keys(payload.integrations || {})) fieldUnion.add(`integrations.${k}`);
    keyCounts[key || '(loose)'] = (keyCounts[key || '(loose)'] || 0) + 1;
    eventCounts[entry.event] = (eventCounts[entry.event] || 0) + 1;
    if (key === '' && !nonCta) unmapped.push({ page, event: entry.event, object_detail: props.object_detail, uap: props.ui_access_point, label: m.cta_label });
  }

  const golden = {
    captured: new Date().toISOString().slice(0, 10),
    source: 'customer-provided prod beacons (erp.intuit.com); element_payload_mapping.json',
    _note: 'Second golden = authoritative customer ground truth. Sibling of the reverse-engineered clicktrack-golden.json. LOCAL ONLY (campaign codes / session ids).',
    // integrity lock: the oracle re-hashes this and refuses to score if it was hand-edited
    // (e.g. props stripped to force matches). Regenerate ONLY by re-running this transform
    // over the immutable source drop.
    integrity: { generatedAt: new Date().toISOString(), payloads: entries.length, fieldUnion: [...fieldUnion].sort(), sha256: goldenHash({ entries }) },
    pages: [...pages].sort(),
    entries,
  };
  writeFileSync(OUT, JSON.stringify(golden, null, 2));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ out: OUT, entries: entries.length, pages: pages.size, byEvent: eventCounts, byKey: keyCounts, unmapped: unmapped.length }, null, 2));
    return;
  }
  console.log(`\nWrote ${OUT}`);
  console.log(`  ${entries.length} entries across ${pages.size} pages`);
  console.log('  by event:', JSON.stringify(eventCounts));
  console.log('  by key:  ', JSON.stringify(keyCounts));
  if (unmapped.length) {
    console.log(`\n  ${unmapped.length} LOOSE (no trail + no recognized prefix — review; will pure-derive as content CTAs):`);
    unmapped.slice(0, 20).forEach((u) => console.log(`    ${u.page}  ${u.event}  od=${JSON.stringify(u.object_detail)}  label=${JSON.stringify(u.label)}`));
    if (unmapped.length > 20) console.log(`    …and ${unmapped.length - 20} more`);
  }
  console.log('');
}

main();
