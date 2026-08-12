import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const plain = await readFile('content/account-management.plain.html','utf8');
const doc = new JSDOM(`<main>${plain}</main>`).window.document;
const BLOCKS=['hero','icon-columns','fragment'];
function content(b){
  const headings=[...b.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>({tag:h.tagName.toLowerCase(),text:h.textContent.trim()}));
  const paras=[...b.querySelectorAll('p')].filter(p=>!(p.children.length===1&&p.children[0].tagName==='A')).filter(p=>!(p.querySelector('picture,img')&&!p.textContent.trim())).map(p=>p.textContent.trim()).filter(Boolean);
  const links=[...b.querySelectorAll('a')].map(a=>({text:a.textContent.trim(),href:a.getAttribute('href')||''})).filter(l=>l.text);
  const images=[...b.querySelectorAll('img,picture')].length;
  return {headings:headings.length,headingTexts:headings.map(h=>h.text),paragraphs:paras.length,links:links.length,images};
}
function structure(b){const rows=[...b.children].filter(c=>c.tagName==='DIV');return{rowCount:rows.length,cellsPerRow:rows.map(r=>[...r.children].filter(c=>c.tagName==='DIV').length)};}
const out={};
BLOCKS.forEach(n=>{const b=doc.querySelector('.'+n);out[n]=b?{found:true,content:content(b),structure:structure(b)}:{found:false};});
console.log(JSON.stringify(out,null,2));
