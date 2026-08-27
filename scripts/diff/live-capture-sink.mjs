#!/usr/bin/env node
/**
 * live-capture-sink.mjs — localhost ingest server for the work-Chrome live capture.
 *
 * stage.erp.intuit.com's CSP sets no connect-src/default-src, and Chrome exempts
 * http://localhost from mixed-content blocking, so the in-page capture engine can POST its
 * SANITIZED beacons straight here — no DOM-render/get_page_text/hand-paste bridge. This
 * server accepts them (CORS-open for localhost use), enforces the same PII guard as
 * live-capture-ingest.mjs (frozen fields must be shape-tokens — nothing raw is ever
 * accepted, let alone written), and merges per page into the captures file that
 * stage-parity.mjs --captures scores. Nothing here ever contacts the network; it only
 * receives localhost POSTs and writes a gitignored local file.
 *
 *   node scripts/diff/live-capture-sink.mjs            # listen on :9911
 *   node scripts/diff/live-capture-sink.mjs --port 9911 --reset
 */
/* eslint-disable no-console, no-restricted-syntax, no-continue, no-plusplus, max-len, no-underscore-dangle, object-curly-newline */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'scripts/diff/fixtures/local/live-capture-customer.json';
const BASE = 'https://stage.erp.intuit.com';
const MUST_TOKEN = ['userId', 'anonymousId', 'ivid', 'fbp', 'auth_id', 'session_replay_id', 'session_replay_url', 'messageId', 'pseudonym_id', 'akes_geo'];
const looksToken = (v) => v === undefined || (typeof v === 'string' && /^(STR:\d+|NUM|BOOL|OBJ|ARR:\d+|NULL)$/.test(v));

const args = process.argv.slice(2);
const port = args.includes('--port') ? +args[args.indexOf('--port') + 1] : 9911;
if (args.includes('--reset') && existsSync(OUT)) writeFileSync(OUT, JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), pages: {} }, null, 2));

function load() { return existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { base: BASE, generatedAt: new Date().toISOString(), pages: {} }; }

// returns the first PII leak found, or null if clean
function piiLeak(beacons) {
  for (const b of beacons) {
    for (const [loc, o] of [['envelope', b], ['properties', b.properties || {}], ['context', b.context || {}]]) {
      for (const f of MUST_TOKEN) if (o[f] !== undefined && !looksToken(o[f])) return `${loc}.${f}="${String(o[f]).slice(0, 10)}…"`;
    }
  }
  return null;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'GET' && url.pathname === '/ping') {
    const doc = load();
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: 1, pages: Object.keys(doc.pages).length, total: Object.values(doc.pages).reduce((s, a) => s + a.length, 0) }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/ingest') {
    const page = url.searchParams.get('page') || '?';
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let beacons;
      try { beacons = JSON.parse(body); } catch (e) { res.writeHead(400, CORS); res.end(`bad json: ${e.message}`); return; }
      if (!Array.isArray(beacons)) { res.writeHead(400, CORS); res.end('expected array'); return; }
      const leak = piiLeak(beacons);
      if (leak) { console.error(`REFUSED ${page}: PII leak ${leak}`); res.writeHead(422, CORS); res.end(`pii: ${leak}`); return; }
      const doc = load();
      doc.pages[page] = beacons;
      doc.updatedAt = new Date().toISOString();
      writeFileSync(OUT, JSON.stringify(doc, null, 2));
      const events = beacons.reduce((m, b) => { m[b.event] = (m[b.event] || 0) + 1; return m; }, {});
      console.log(`+ ${page}: ${beacons.length} beacons ${JSON.stringify(events)}  (pages: ${Object.keys(doc.pages).length})`);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: 1, page, n: beacons.length }));
    });
    return;
  }
  res.writeHead(404, CORS); res.end('not found');
}).listen(port, () => console.log(`live-capture-sink on http://localhost:${port}  → ${OUT}`));
