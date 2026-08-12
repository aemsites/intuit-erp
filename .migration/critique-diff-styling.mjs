#!/usr/bin/env node
/* eslint-disable no-console */
// Rigorous property-by-property styling diff between original (deployed) and
// migrated (local) block CSS, with scoring.md tolerance applied.
import { readFile, writeFile } from 'node:fs/promises';

const orig = JSON.parse(await readFile('.migration/_orig-styling.json', 'utf8'));
const migr = JSON.parse(await readFile('.migration/_migr-styling.json', 'utf8'));

// parse "selector { prop: val; }" css into { selector: { prop: val } }
function parseCss(css) {
  const map = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim();
    const body = m[2];
    map[sel] = {};
    body.split(';').forEach((decl) => {
      const i = decl.indexOf(':');
      if (i === -1) return;
      const prop = decl.slice(0, i).trim();
      const val = decl.slice(i + 1).trim();
      if (prop) map[sel][prop] = val;
    });
  }
  return map;
}

function rgb(v) {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function px(v) { const m = v.match(/^(-?[\d.]+)px$/); return m ? +m[1] : null; }
function equal(a, b) {
  if (a === b) return true;
  const ra = rgb(a); const rb = rgb(b);
  if (ra && rb) return ra.every((c, i) => Math.abs(c - rb[i]) <= 2);
  const pa = px(a); const pb = px(b);
  if (pa !== null && pb !== null) return Math.abs(pa - pb) <= 1;
  // font-family: primary token match
  if (a.includes(',') && b.includes(',')) return a.split(',')[0].trim() === b.split(',')[0].trim();
  return false;
}

let totalProps = 0;
const blocks = {};
Object.keys(orig).forEach((name) => {
  const o = parseCss(orig[name]);
  const g = parseCss(migr[name]);
  const diffs = [];
  let props = 0;
  Object.keys(o).forEach((sel) => {
    Object.keys(o[sel]).forEach((prop) => {
      props += 1;
      const ov = o[sel][prop];
      const gv = g[sel] ? g[sel][prop] : undefined;
      if (gv === undefined) { diffs.push({ sel, prop, original: ov, migrated: '(missing)' }); return; }
      if (!equal(ov, gv)) diffs.push({ sel, prop, original: ov, migrated: gv });
    });
  });
  totalProps += props;
  blocks[name] = { propsCompared: props, diffs };
});

const out = { totalProps, blocks };
await writeFile('.migration/_styling-diffs.json', JSON.stringify(out, null, 2));
Object.keys(blocks).forEach((n) => {
  console.log(`${n}: ${blocks[n].propsCompared} props compared, ${blocks[n].diffs.length} diffs`);
  blocks[n].diffs.forEach((d) => console.log(`   - ${d.sel} { ${d.prop}: ${d.original} -> ${d.migrated} }`));
});
console.log(`TOTAL: ${totalProps} properties compared`);
