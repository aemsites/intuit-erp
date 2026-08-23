#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * blog-import.mjs — re-import erp.intuit.com blog ARTICLES into canonical DA
 * block HTML under content/blog/**.
 *
 * Usage:
 *   node tools/import/blog-import.mjs <url|path> [more...] [options]
 *   node tools/import/blog-import.mjs --list urls.txt [options]
 *
 * Input forms (per line / arg):
 *   https://erp.intuit.com/blog/erp/erp-system      (full source URL)
 *   /blog/erp/erp-system                            (site path — fetched from erp.intuit.com)
 *
 * Options:
 *   --list <file>   newline-separated inputs (blank lines / # comments ignored)
 *   --dry-run       do not write files
 *   --diff          print a structural diff vs the existing content/blog file
 *   --cache <dir>   read/write fetched SSR at <dir>/<slug>.html (skips network if present)
 *   --out <dir>     output root (default: content)
 *   --verbose       print every warning (default: just the count)
 *
 * Scope: blog ARTICLES only. Case studies (/blog/case-study/*), guides
 * (/blog/guide/*), author pages (/blog/author/*), category landings and the
 * blog root are skipped with a message.
 */
import {
  writeFileSync, mkdirSync, existsSync, readFileSync,
} from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSource } from './fetch.mjs';
import { extractPage } from './extract.mjs';
import { renderPage } from './render-da.mjs';
import { diffStructure } from './diff.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ERP_HOST = 'https://erp.intuit.com';
const OUT_OF_SCOPE = /^\/blog\/(case-study|guide|author)\//;

function parseArgs(argv) {
  const opts = {
    inputs: [], list: null, dryRun: false, diff: false, cache: null, out: 'content', verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') { opts.list = argv[i += 1]; }
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--diff') opts.diff = true;
    else if (a === '--cache') { opts.cache = argv[i += 1]; }
    else if (a === '--out') { opts.out = argv[i += 1]; }
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.inputs.push(a);
  }
  return opts;
}

/** input (url or path) -> { sitePath, sourceUrl, slug, outFile } */
function resolveInput(input, outRoot) {
  const url = new URL(input, ERP_HOST);
  const sitePath = url.pathname.replace(/\/+$/, '');
  const sourceUrl = `${ERP_HOST}${sitePath}/`;
  const slug = sitePath.replace(/^\//, '');
  const base = isAbsolute(outRoot) ? outRoot : join(REPO_ROOT, outRoot);
  const outFile = join(base, `${slug}.html`);
  return { sitePath, sourceUrl, slug, outFile };
}

function readList(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function processOne(input, opts) {
  const {
    sitePath, sourceUrl, slug, outFile,
  } = resolveInput(input, opts.out);

  if (!sitePath.startsWith('/blog/')) {
    console.log(`SKIP  ${sitePath} — not a /blog/ path`);
    return 'skip';
  }
  if (OUT_OF_SCOPE.test(`${sitePath}/`)) {
    console.log(`SKIP  ${sitePath} — out of scope (articles only; not case-study/guide/author)`);
    return 'skip';
  }

  let page;
  try {
    const cacheFile = opts.cache ? join(opts.cache, `${slug.replace(/\//g, '__')}.html`) : undefined;
    const html = fetchSource(sourceUrl, { cacheFile });
    page = extractPage(html, sourceUrl);
  } catch (err) {
    console.log(`SKIP  ${sitePath} — ${err.message}`);
    return 'skip';
  }

  const out = renderPage(page);

  if (opts.diff) {
    console.log(`\n### structural diff for ${sitePath}`);
    if (existsSync(outFile)) {
      const identical = diffStructure(out, readFileSync(outFile, 'utf8'));
      console.log(identical ? '  (structurally identical)' : '');
    } else {
      console.log('  (no existing file to diff against)');
    }
  }

  const warn = page.warnings || [];
  const warnMsg = warn.length ? ` [${warn.length} warning(s)]` : '';
  if (opts.dryRun) {
    console.log(`DRY   ${sitePath} -> ${outFile.replace(`${REPO_ROOT}/`, '')}${warnMsg}`);
  } else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, out);
    console.log(`WROTE ${outFile.replace(`${REPO_ROOT}/`, '')}${warnMsg}`);
  }
  if (opts.verbose) warn.forEach((w) => console.log(`      ! ${w}`));
  return 'ok';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.inputs.length && !opts.list)) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 30).join('\n'));
    process.exit(opts.help ? 0 : 1);
  }
  const inputs = [...opts.inputs, ...(opts.list ? readList(opts.list) : [])];
  const tally = { ok: 0, skip: 0 };
  inputs.forEach((input) => { tally[processOne(input, opts)] += 1; });
  console.log(`\nDone: ${tally.ok} written/checked, ${tally.skip} skipped.`);
}

main();
