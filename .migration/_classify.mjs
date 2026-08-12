import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT='content';
const KNOWN=new Set(['hero','tabs','media-text','fragment','disclosure','icon-columns','cards','columns','carousel','accordion','quote','table','embed','video','hero-carousel','logo-wall','stats','form','breadcrumb','article-header','author','related','search','pricing-table','feature-grid','cta','banner','testimonial']);
const files=[];
(function walk(d){ for(const e of readdirSync(d)){ const p=join(d,e); const s=statSync(p); if(s.isDirectory()) walk(p); else if(e.endsWith('.plain.html')) files.push(p); } })(ROOT);

const groups={};
let noBlocks=0;
for(const f of files){
  let blocks=[];
  try{
    const html=readFileSync(f,'utf8');
    const doc=new JSDOM(`<main>${html}</main>`).window.document;
    const set=new Set();
    doc.querySelectorAll('main > div > div[class]').forEach(d=>{const c=d.className.trim().split(/\s+/)[0]; if(KNOWN.has(c)) set.add(c);});
    // also top-level block divs
    doc.querySelectorAll('main > div [class]').forEach(d=>{const c=d.className.trim().split(/\s+/)[0]; if(KNOWN.has(c)) set.add(c);});
    blocks=[...set].sort();
  }catch(e){}
  const sig=blocks.join('+')||'(default-content-only)';
  const path='/'+relative(ROOT,f).replace(/\.plain\.html$/,'');
  (groups[sig]=groups[sig]||[]).push(path);
}
const sorted=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
console.log(`TOTAL pages: ${files.length}`);
console.log(`Distinct block-signatures (templates): ${sorted.length}\n`);
for(const [sig,paths] of sorted){
  console.log(`[${paths.length}]  ${sig}`);
  console.log(`      e.g. ${paths.slice(0,3).join(', ')}`);
}
