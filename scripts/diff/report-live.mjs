#!/usr/bin/env node
/**
 * report-live.mjs — customer-facing HTML report driven by the LIVE stage capture.
 *
 * Reads the per-entry/per-field detail artifact `stage-parity.mjs --out` writes
 * (`fixtures/local/live-detail-customer.json`) — REAL beacons captured on
 * stage.erp.intuit.com via the authenticated work Chrome, diffed full-envelope against
 * the customer golden through oracle-lib (host/env-normalized, gated value-match + frozen
 * presence). This is NOT the offline replica: every "got" is a value our deployed EDS
 * build actually POST-ed. Renders a filterable table (page/event/component/field/bucket/
 * category, deviations-only) + summary. Each field row is categorized so "what's left"
 * is actionable: real-gap / faq-block / capture-state / accepted / inherited / not-captured.
 *
 *   (run stage-parity.mjs --captures … --out <DETAIL> first, then:)
 *   node scripts/diff/report-live.mjs   # -> CLICK-TRACKING-LIVE-REPORT.html
 */
/* eslint-disable no-console, no-restricted-syntax, no-continue, no-plusplus, max-len, no-underscore-dangle, object-curly-newline, no-nested-ternary, newline-per-chained-call, no-mixed-operators */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DETAIL = 'scripts/diff/fixtures/local/live-detail-customer.json';
const GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const OUT = 'CLICK-TRACKING-LIVE-REPORT.html';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// classify a single field result into an actionable category + note.
function classify(comp, f) {
  if (f.match) return { cat: f.bucket === 'frozen' ? 'inherited' : 'match', note: f.bucket === 'frozen' ? `present + shape (per-visit/${f.group || 'frozen'}, not value-matched)` : '' };
  if (f.bucket === 'frozen') return { cat: 'presence-gap', note: `prod carried ${f.field} but our beacon did not (${f.group || 'frozen'})` };
  // gated misses
  if (f.field === 'page_cas_id') return { cat: 'real-gap', note: 'Intuit CMS content id — prod emits it on every beacon; our EDS build emits none (we send project_asset_id only). Real gap to escalate.' };
  if (f.field === 'channel_cookie_90day') return { cat: 'investigate', note: `channel cookie differs: prod "${f.expected}" vs ours "${f.got}" — our build sets an ext channel code prod's capture lacked.` };
  if (['object_detail', 'data-wa-link', 'icom_user_action', 'link_name'].includes(f.field) || (f.field === 'ui_object' && /accordion_item/.test(String(f.expected)))) {
    if (/faq|accordion/i.test(comp) || String(f.expected).includes('faq|') || String(f.expected).includes('accordion_item')) return { cat: 'faq-block', note: `blocks/faq/faq.js under-tracks: prod "${f.expected}" vs ours "${f.got}". The faq block stamps only the accordion trail, not the per-item structured fields (needs per-question data-wa-link / accordion_item_N).` };
  }
  if (f.field === 'ui_action') return { cat: 'capture-state', note: `accordion state-dependent: prod "${f.expected}" (their tester's toggle direction) vs ours "${f.got}". displayed on expand / dismissed-or-clicked on collapse — not a tracking gap.` };
  if (['link_href', 'link_href_domain'].includes(f.field)) return { cat: 'differ', note: `navigation-derived: prod "${f.expected}" vs ours "${f.got}" (host-normalized).` };
  return { cat: 'differ', note: `prod "${f.expected}" vs ours "${f.got}"` };
}

function main() {
  if (!existsSync(DETAIL)) { console.error(`Missing ${DETAIL}. Run stage-parity.mjs --captures … --out ${DETAIL} first.`); process.exit(2); }
  const detail = JSON.parse(readFileSync(DETAIL, 'utf8'));
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  const rows = [];
  const capturedPages = new Set();
  for (const e of detail.entries) {
    if (e.reproduced) capturedPages.add(e.page);
    if (!e.reproduced) {
      rows.push({ pg: e.page, ev: e.event, c: e.component, el: (e.text || '').slice(0, 60), f: '(whole beacon)', b: 'coverage', exp: 'fires on prod', got: 'not captured live', match: false, cat: 'not-captured', note: 'element not reproduced in the synthetic capture (lazy-rendered below fold / internal-id label / cross-origin nav / accordion state / icon-only). The page IS migrated; the beacon was not exercised.' });
      continue;
    }
    for (const f of e.fields) {
      const { cat, note } = classify(e.component, f);
      rows.push({ pg: e.page, ev: e.event, c: e.component, el: (e.text || '').slice(0, 60), f: f.field, b: f.bucket, exp: f.expected, got: f.got, match: !!f.match, cat, note });
    }
  }

  // coverage: golden entries (minus structural chat exceptions) reproduced
  const gable = golden.entries.filter((e) => !(e.nonCta && e.event === 'chat:viewed'));
  const reproduced = detail.entries.filter((e) => e.reproduced).length;

  const catCount = (c) => rows.filter((r) => r.cat === c).length;
  const gatedRows = rows.filter((r) => r.b === 'gated');
  const gatedMatch = gatedRows.filter((r) => r.match).length;
  const gatedPct = gatedRows.length ? (100 * gatedMatch / gatedRows.length).toFixed(1) : '0';

  const CAT = {
    match: 'Match (live)', inherited: 'Inherited (present)', 'real-gap': 'Real gap — fix', 'faq-block': 'FAQ block gap', 'capture-state': 'Capture-state artifact', investigate: 'Investigate', 'presence-gap': 'Presence gap', differ: 'Differ', 'not-captured': 'Not captured live',
  };
  const uniq = (k) => [...new Set(rows.map((r) => r[k]))].filter(Boolean).sort();
  const opts = (k) => uniq(k).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

  const DATA = JSON.stringify(rows).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ERP click-tracking — LIVE stage validation</title>
<style>
:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--line:#30363d;--card:#161b22;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--info:#58a6ff;--pur:#bc8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
header{padding:18px 22px;border-bottom:1px solid var(--line)}h1{margin:0 0 4px;font-size:18px}.sub{color:var(--mut);font-size:12px}
.status{margin-top:8px;font-size:12px;color:var(--warn)}
.cards{display:flex;flex-wrap:wrap;gap:10px;padding:14px 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}
.card .n{font-size:20px;font-weight:600}.card .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.card.g .n{color:var(--ok)}.card.b .n{color:var(--bad)}.card.w .n{color:var(--warn)}.card.i .n{color:var(--info)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 22px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
select,input[type=search]{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:12px}
.chk{color:var(--mut);font-size:12px;display:flex;align-items:center;gap:4px}.count{color:var(--mut);font-size:12px;margin-left:auto}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:52px;background:var(--card);cursor:pointer;white-space:nowrap;z-index:4}
td.exp{color:var(--mut)}td.got{color:var(--fg)}td.note{color:var(--mut);max-width:420px}
.src{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:#21262d;color:var(--mut)}
.m-y{color:var(--ok);font-weight:600}.m-n{color:var(--bad);font-weight:600}
.pill{font-size:10px;padding:1px 6px;border-radius:10px;white-space:nowrap}
.c-match{background:rgba(63,185,80,.15);color:var(--ok)}.c-inherited{background:rgba(88,166,255,.12);color:var(--info)}
.c-real-gap{background:rgba(248,81,73,.16);color:var(--bad)}.c-faq-block{background:rgba(188,140,255,.16);color:var(--pur)}
.c-capture-state{background:rgba(210,153,34,.15);color:var(--warn)}.c-investigate{background:rgba(210,153,34,.15);color:var(--warn)}
.c-presence-gap{background:rgba(248,81,73,.12);color:var(--bad)}.c-differ{background:rgba(210,153,34,.12);color:var(--warn)}.c-not-captured{background:#21262d;color:var(--mut)}
</style></head><body>
<header>
  <h1>Intuit ERP — click-tracking <b>LIVE</b> stage validation</h1>
  <div class="sub">Real beacons captured on stage.erp.intuit.com (authenticated work Chrome) · diffed full-envelope vs the customer's 161 prod beacons · host/env-normalized · generated ${new Date().toISOString().slice(0, 10)}</div>
  <div class="status">Live capture — synthetic clicking reproduces a subset of elements (lazy/nav/internal-id/accordion-state limits). Numbers below are over what fired LIVE, not the offline replica.</div>
</header>
<div class="cards">
  <div class="card i"><div class="n">${reproduced}/${gable.length}</div><div class="l">Rows reproduced live</div></div>
  <div class="card g"><div class="n">${gatedPct}%</div><div class="l">Gated fields matched</div></div>
  <div class="card b"><div class="n">${catCount('real-gap')}</div><div class="l">Real gaps (page_cas_id)</div></div>
  <div class="card" style="--x:var(--pur)"><div class="n" style="color:var(--pur)">${catCount('faq-block')}</div><div class="l">FAQ-block gap</div></div>
  <div class="card w"><div class="n">${catCount('capture-state') + catCount('investigate')}</div><div class="l">Capture-state / investigate</div></div>
  <div class="card"><div class="n">${catCount('not-captured')}</div><div class="l">Not captured live</div></div>
  <div class="card g"><div class="n">${catCount('match')}</div><div class="l">Field matches</div></div>
  <div class="card i"><div class="n">${catCount('inherited')}</div><div class="l">Inherited present</div></div>
</div>
<div class="filters">
  <select id="f-page"><option value="">All pages</option>${opts('pg')}</select>
  <select id="f-ev"><option value="">All events</option>${opts('ev')}</select>
  <select id="f-comp"><option value="">All components</option>${opts('c')}</select>
  <select id="f-field"><option value="">All fields</option>${opts('f')}</select>
  <select id="f-cat"><option value="">All categories</option>${Object.keys(CAT).map((c) => `<option value="${c}">${CAT[c]}</option>`).join('')}</select>
  <select id="f-bucket"><option value="">All buckets</option>${opts('b')}</select>
  <input type="search" id="f-q" placeholder="search…">
  <label class="chk"><input type="checkbox" id="f-dev"> deviations only</label>
  <span class="count" id="count"></span>
</div>
<table><thead><tr>
  <th data-k="pg">Page</th><th data-k="ev">Event</th><th data-k="c">Component</th><th data-k="el">Element</th>
  <th data-k="f">Field</th><th data-k="b">Bucket</th><th data-k="exp">Prod (expected)</th><th data-k="got">Ours (live)</th>
  <th data-k="match">Match</th><th data-k="cat">Category</th><th data-k="note">Note</th>
</tr></thead><tbody id="tb"></tbody></table>
<script>
const DATA=${DATA};const CAT=${JSON.stringify(CAT)};
const tb=document.getElementById('tb'),cnt=document.getElementById('count');let sortK=null,sortDir=1;
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function filtered(){
  const v=id=>document.getElementById(id).value;
  const pg=v('f-page'),ev=v('f-ev'),comp=v('f-comp'),fld=v('f-field'),cat=v('f-cat'),bk=v('f-bucket');
  const q=v('f-q').toLowerCase(),dev=document.getElementById('f-dev').checked;
  let r=DATA.filter(d=>(!pg||d.pg===pg)&&(!ev||d.ev===ev)&&(!comp||d.c===comp)&&(!fld||d.f===fld)&&(!cat||d.cat===cat)&&(!bk||d.b===bk)
    &&(!dev||!d.match)
    &&(!q||(d.pg+' '+d.el+' '+d.f+' '+d.exp+' '+d.got+' '+d.note).toLowerCase().includes(q)));
  if(sortK)r=r.slice().sort((a,b)=>String(a[sortK]).localeCompare(String(b[sortK]))*sortDir);
  return r;
}
function render(){
  const r=filtered();const cap=4000;
  tb.innerHTML=r.slice(0,cap).map(d=>'<tr>'+
    '<td>'+esc(d.pg)+'</td><td>'+esc(d.ev)+'</td><td>'+esc(d.c)+'</td><td>'+esc(d.el)+'</td>'+
    '<td>'+esc(d.f)+'</td><td>'+esc(d.b)+'</td>'+
    '<td class="exp">'+esc(d.exp)+'</td><td class="got">'+esc(d.got)+'</td>'+
    '<td class="'+(d.match?'m-y':'m-n')+'">'+(d.match?'\\u2713':'\\u2717')+'</td>'+
    '<td><span class="pill c-'+d.cat+'">'+(CAT[d.cat]||d.cat)+'</span></td>'+
    '<td class="note">'+esc(d.note)+'</td></tr>').join('');
  cnt.textContent=r.length+' rows'+(r.length>cap?(' (showing '+cap+')'):'');
}
['f-page','f-ev','f-comp','f-field','f-cat','f-bucket'].forEach(id=>document.getElementById(id).addEventListener('change',render));
document.getElementById('f-q').addEventListener('input',render);
document.getElementById('f-dev').addEventListener('change',render);
document.querySelectorAll('th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;sortDir=sortK===k?-sortDir:1;sortK=k;render();}));
render();
</script></body></html>`;
  writeFileSync(OUT, html);
  console.log(`wrote ${OUT} — ${rows.length} field rows, ${reproduced}/${gable.length} rows reproduced live, gated ${gatedPct}%`);
  console.log(`  categories: ${Object.keys(CAT).map((c) => `${c}=${catCount(c)}`).join('  ')}`);
}

main();
