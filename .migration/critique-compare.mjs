#!/usr/bin/env node
/* eslint-disable no-console */
// Extracts content + structure per block from the migrated .plain.html
// (file-read, per the critique skill), for the local-vs-deployed compare.
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const plain = await readFile('content/accounting.plain.html', 'utf8');
const dom = new JSDOM(`<main>${plain}</main>`);
const doc = dom.window.document;
const BLOCKS = ['hero', 'tabs', 'media-text', 'fragment', 'disclosure'];

function extractContent(block) {
  const headings = [...block.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ tag: h.tagName.toLowerCase(), text: h.textContent.trim() }));
  const paragraphs = [...block.querySelectorAll('p')]
    .filter((p) => !(p.children.length === 1 && p.children[0].tagName === 'A'))
    .filter((p) => !(p.querySelector('picture,img') && !p.textContent.trim()))
    .map((p) => p.textContent.trim()).filter(Boolean);
  const links = [...block.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') || '' })).filter((l) => l.text);
  const images = [...block.querySelectorAll('img,picture')].length;
  return { headings: headings.length, paragraphs: paragraphs.length, links: links.length, images, headingTexts: headings.map((h) => h.text) };
}
function extractStructure(block) {
  const rows = [...block.children].filter((c) => c.tagName === 'DIV');
  return { rowCount: rows.length, cellsPerRow: rows.map((r) => [...r.children].filter((c) => c.tagName === 'DIV').length) };
}

const result = {};
BLOCKS.forEach((name) => {
  // In plain.html, blocks may be nested; find first element with the class
  const block = doc.querySelector(`.${name}`);
  if (!block) { result[name] = { found: false }; return; }
  result[name] = { found: true, content: extractContent(block), structure: extractStructure(block) };
});
console.log(JSON.stringify(result, null, 2));
