#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax */
// Synthesizes a minimal tools/importer/page-templates.json for the critique
// skill (Page mode) by scanning a pulled .plain.html for blocks + sections.
//
// Path-2 comparison: reference = deployed EDS page, migrated = local EDS page.
// Both are EDS-decorated from the SAME content, so a block's source selector
// on the reference is the same `.${blockName}` used locally.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = new URL('..', import.meta.url).pathname;
const pagePath = process.argv[2] || '/accounting'; // web path, no extension
const previewBase = process.argv[3] || 'https://main--intuit-erp--aemsites.aem.page';

// non-block helper divs that EDS/DA emit but are not authored blocks
const NON_BLOCKS = new Set(['metadata', 'section-metadata']);

const plainPath = join(REPO, 'content', `${pagePath.replace(/^\//, '')}.plain.html`);
const html = await readFile(plainPath, 'utf8');
const dom = new JSDOM(`<main>${html}</main>`);
const main = dom.window.document.querySelector('main');

// Each direct child <div> of main is a section
const sectionEls = [...main.children].filter((el) => el.tagName === 'DIV');

const blockOrder = [];
const blockSet = new Map(); // blockName -> Set(variantClass strings)
const sections = [];

sectionEls.forEach((sectionEl, i) => {
  const sectionBlocks = [];
  let styleVariant = null;

  // block divs = direct children divs that carry a class
  [...sectionEl.children].forEach((child) => {
    if (child.tagName !== 'DIV' || !child.className) return;
    const classes = child.className.trim().split(/\s+/);
    const name = classes[0];
    if (NON_BLOCKS.has(name)) {
      if (name === 'section-metadata') styleVariant = 'has-metadata';
      return;
    }
    sectionBlocks.push(name);
    if (!blockSet.has(name)) {
      blockSet.set(name, new Set());
      blockOrder.push(name);
    }
    classes.slice(1).forEach((v) => blockSet.get(name).add(v));
  });

  sections.push({
    id: `section-${i + 1}`,
    name: sectionBlocks[0] || `Section ${i + 1}`,
    selector: `main > div:nth-of-type(${i + 1})`,
    style: styleVariant,
    blocks: sectionBlocks,
    defaultContent: [],
  });
});

const blocks = blockOrder.map((name) => ({
  name,
  // source selector on the deployed EDS page == local EDS selector
  instances: [`.${name}`],
  variants: [...blockSet.get(name)],
  pagesUsing: [{ url: pagePath, path: pagePath }],
}));

const out = {
  templates: [
    {
      name: pagePath.replace(/^\//, '').replace(/\//g, '-') || 'homepage',
      urls: [`${previewBase}${pagePath}`],
      description: `Auto-generated for local-vs-deployed critique of ${pagePath}`,
      blocks,
      sections,
    },
  ],
};

const dest = join(REPO, 'tools', 'importer', 'page-templates.json');
await mkdir(join(REPO, 'tools', 'importer'), { recursive: true });
await writeFile(dest, `${JSON.stringify(out, null, 2)}\n`);

console.log(`Wrote ${dest}`);
console.log(`Blocks (${blocks.length}): ${blockOrder.join(', ')}`);
console.log(`Sections: ${sections.length}`);
