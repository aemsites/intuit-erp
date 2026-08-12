#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
// Pulls all documents from the DA source into the local content/ directory.
// DA org/site come from .migration/project.json (contentSource).
//
// Each authored `.html` document from DA is a full page shell
// (<body><header/><main>...</main><footer/></body>). This workspace renders
// `.plain.html` files, which contain ONLY the inner content of <main>.
// So every `.html` doc is transformed to `<path>.plain.html` holding main's
// inner HTML. JSON/markdown are copied verbatim; anything else (media) is
// copied as raw bytes.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = new URL('..', import.meta.url).pathname;
const cfg = JSON.parse(await readFile(join(REPO, '.migration/project.json'), 'utf8'));
const site = cfg.sites[Object.keys(cfg.sites)[0]];
const { daOrg, daSite } = site;
const LIST = `https://admin.da.live/list/${daOrg}/${daSite}`;
const SRC = `https://admin.da.live/source/${daOrg}/${daSite}`;
const OUT = join(REPO, 'content');
const PREFIX = new RegExp(`^/${daOrg}/${daSite}`);

async function list(path = '') {
  const res = await fetch(`${LIST}${path}`);
  if (!res.ok) throw new Error(`list ${path} -> ${res.status}`);
  return res.json();
}

const docs = [];
async function walk(path = '') {
  const items = await list(path);
  for (const item of items) {
    const rel = item.path.replace(PREFIX, ''); // /accounting.html, /blog, ...
    if (item.ext) docs.push({ rel, ext: item.ext });
    else await walk(rel); // folder -> recurse
  }
}

console.log(`Pulling from ${SRC} ...`);
await walk('');
const htmlCount = docs.filter((d) => d.ext === 'html').length;
console.log(`Found ${docs.length} documents (${htmlCount} html).`);

// pretty-print main's inner HTML into a .plain.html body
function toPlain(html) {
  const dom = new JSDOM(html);
  const main = dom.window.document.querySelector('main');
  if (!main) return null;
  return `${main.innerHTML.trim()}\n`;
}

let ok = 0;
let fail = 0;
let skip = 0;
for (const doc of docs) {
  const res = await fetch(`${SRC}${doc.rel}`);
  if (!res.ok) {
    console.warn(`  MISS ${doc.rel} (${res.status})`);
    fail += 1;
    continue;
  }

  let dest;
  let body;
  if (doc.ext === 'html') {
    const plain = toPlain(await res.text());
    if (plain === null) {
      console.warn(`  NO <main> ${doc.rel} -- skipped`);
      skip += 1;
      continue;
    }
    dest = join(OUT, doc.rel.replace(/\.html$/, '.plain.html'));
    body = plain;
  } else if (doc.ext === 'json' || doc.ext === 'md' || doc.ext === 'svg') {
    dest = join(OUT, doc.rel);
    body = await res.text();
  } else {
    dest = join(OUT, doc.rel);
    body = Buffer.from(await res.arrayBuffer());
  }

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body);
  ok += 1;
}
console.log(`Done. Wrote ${ok} files to content/ (${skip} skipped, ${fail} failures).`);
