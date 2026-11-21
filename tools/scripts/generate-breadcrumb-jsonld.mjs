/* eslint-disable no-console */
/**
 * One-off migration tool for issue #450: append a BreadcrumbList JSON-LD node
 * to each non-homepage page's `json-ld` page-metadata property.
 *
 * Operates on the raw DA HTML source via targeted string surgery (not DOM
 * re-serialization) so untouched parts of each file stay byte-for-byte
 * identical and diffs stay minimal.
 *
 * Usage:
 *   node tools/scripts/generate-breadcrumb-jsonld.mjs --sitemap /tmp/sitemap_fresh.xml [--dry-run]
 *   node tools/scripts/generate-breadcrumb-jsonld.mjs --sitemap /tmp/sitemap_fresh.xml --write
 */
import fs from 'fs';
import path from 'path';

const SITE_ORIGIN = 'https://erp.intuit.com';
const HOME_ITEM = { name: 'Home', item: 'https://www.intuit.com/' };
const IES_ITEM = { name: 'Intuit Enterprise Suite', item: `${SITE_ORIGIN}/` };
const MAX_LABEL_LENGTH = 45;

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const WRITE = args.includes('--write');
const sitemapPath = getArg('--sitemap', '/tmp/sitemap_fresh.xml');
const contentRoot = path.resolve(getArg('--content-root', 'content'));

function readSitemapPaths(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const paths = new Set();
  locs.forEach((loc) => {
    const u = new URL(loc);
    paths.add(u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, ''));
  });
  return [...paths];
}

function classify(p) {
  const segs = p.split('/').filter(Boolean);
  if (segs.length === 0) return { type: 'homepage', segs };
  if (segs[0] === 'nav' || segs[0] === 'footer') return { type: 'skip', segs };
  if (['drafts', 'test', 'experiments', 'fragments', 'library', 'pzn'].includes(segs[0])) {
    return { type: 'skip', segs };
  }
  // of1 has one real page (/of1) plus config-only sub-paths (e.g. /of1/strategy) -
  // only skip the latter.
  if (segs[0] === 'of1' && segs.length > 1) return { type: 'skip', segs };
  if (p === '/homepage') return { type: 'skip', segs };
  if (segs[0] === 'blog') {
    if (segs.length === 1) return { type: 'blog-index', segs };
    if (segs.length === 2) return { type: 'blog-category', segs };
    if (segs.length === 3) return { type: 'blog-article', segs };
    return { type: 'skip', segs };
  }
  return { type: 'top-level', segs };
}

function contentFileFor(p) {
  if (p === '/') return path.join(contentRoot, 'index.html');
  const flat = path.join(contentRoot, `${p}.html`);
  if (fs.existsSync(flat)) return flat;
  const indexed = path.join(contentRoot, p, 'index.html');
  if (fs.existsSync(indexed)) return indexed;
  return flat;
}

// Find the [start, end) byte range of the `<div class="metadata">...</div>` block,
// end being the index right after its own matching closing tag.
function findMetadataBlockRange(html) {
  const openMatch = /<div class="metadata">/.exec(html);
  if (!openMatch) return null;
  let depth = 1;
  const tagRe = /<div\b[^>]*>|<\/div>/g;
  tagRe.lastIndex = openMatch.index + openMatch[0].length;
  let m = tagRe.exec(html);
  while (m) {
    if (m[0] === '</div>') {
      depth -= 1;
      if (depth === 0) {
        return { start: openMatch.index, end: m.index + m[0].length, closeTagStart: m.index };
      }
    } else {
      depth += 1;
    }
    m = tagRe.exec(html);
  }
  return null;
}

function parseRows(blockHtml) {
  // Cell text is usually <p>-wrapped, but some DA exports leave it bare — handle both.
  const rowRe = /<div><div>(?:<p>)?(.*?)(?:<\/p>)?<\/div><div>(?:<p>)?(.*?)(?:<\/p>)?<\/div><\/div>/g;
  const rows = [];
  let m = rowRe.exec(blockHtml);
  while (m) {
    rows.push({
      key: m[1].trim().toLowerCase(),
      rawValue: m[2],
      fullMatch: m[0],
      matchStart: m.index,
      matchEnd: m.index + m[0].length,
    });
    m = rowRe.exec(blockHtml);
  }
  return rows;
}

function unescapeHtmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeHtmlText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugToTitleCase(p) {
  const slug = p.split('/').filter(Boolean).pop() || '';
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const labelCache = new Map();
function labelForPath(p) {
  if (labelCache.has(p)) return labelCache.get(p);
  const file = contentFileFor(p);
  let title = '';
  let noBackingFile = false;
  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const range = findMetadataBlockRange(html);
    const rows = range ? parseRows(html.slice(range.start, range.end)) : [];
    const titleRow = rows.find((r) => r.key === 'title');
    title = titleRow ? unescapeHtmlText(titleRow.rawValue).trim() : '';
  } else {
    noBackingFile = true;
  }
  const firstSegment = title.split('|')[0].trim();
  let result;
  if (firstSegment && firstSegment.length <= MAX_LABEL_LENGTH) {
    result = { label: firstSegment, source: 'title' };
  } else {
    result = {
      label: slugToTitleCase(p),
      source: noBackingFile ? 'slug-fallback-no-file' : 'slug-fallback',
    };
  }
  labelCache.set(p, result);
  return result;
}

function buildCrumbs(p, type, segs) {
  const crumbs = [{ ...HOME_ITEM, source: 'fixed' }, { ...IES_ITEM, source: 'fixed' }];
  const canonical = (segPath) => `${SITE_ORIGIN}/${segPath}/`;
  // Intermediate crumbs must link to a real page - an "Author"/"Videos" folder with no index
  // page would 404 if clicked/crawled, so skip levels that have no backing content file.
  const push = (crumbPath, { requireRealPage = false } = {}) => {
    if (requireRealPage && !fs.existsSync(contentFileFor(crumbPath))) return;
    const { label, source } = labelForPath(crumbPath);
    const segPath = crumbPath.replace(/^\//, '');
    crumbs.push({ name: label, item: canonical(segPath), source });
  };

  if (type === 'top-level' || type === 'blog-index') {
    push(p);
  } else if (type === 'blog-category') {
    push(`/${segs[0]}`);
    push(p);
  } else if (type === 'blog-article') {
    push(`/${segs[0]}`);
    push(`/${segs.slice(0, 2).join('/')}`, { requireRealPage: true });
    push(p);
  }

  return crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: c.item,
    labelSource: c.source,
  }));
}

function buildBreadcrumbNode(p, itemListElement) {
  const pageUrl = p === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p}/`;
  const clean = itemListElement.map(({ labelSource, ...rest }) => rest);
  return { '@type': 'BreadcrumbList', '@id': `${pageUrl}#breadcrumb`, itemListElement: clean };
}

function mergeJsonLd(existingRaw, breadcrumbNode) {
  let existing;
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : null;
  } catch {
    return { error: 'unparseable existing json-ld' };
  }
  if (!existing) {
    return { value: { '@context': 'https://schema.org', '@graph': [breadcrumbNode] } };
  }
  const graph = existing['@graph']
    ? existing['@graph']
    : [(() => {
      const { '@context': dropped, ...rest } = existing;
      return rest;
    })()];
  const filtered = graph.filter((n) => n['@type'] !== 'BreadcrumbList');
  filtered.push(breadcrumbNode);
  return { value: { '@context': 'https://schema.org', '@graph': filtered } };
}

// Surgically replace/insert the json-ld row in the raw HTML, leaving everything else untouched.
function applyJsonLdRow(html, jsonLdValue) {
  const range = findMetadataBlockRange(html);
  if (!range) {
    // No .metadata block at all (e.g. /events): add a new section containing just one,
    // right before </main>, matching the "metadata as its own section" pattern seen elsewhere.
    const mainCloseIdx = html.indexOf('</main>');
    if (mainCloseIdx === -1) {
      return { error: 'no .metadata block and no </main> to anchor a new one' };
    }
    const jsonText = escapeHtmlText(JSON.stringify(jsonLdValue));
    const newSection = '<div><div class="metadata"><div><div><p>json-ld</p></div>'
      + `<div><p>${jsonText}</p></div></div></div></div>`;
    return {
      html: html.slice(0, mainCloseIdx) + newSection + html.slice(mainCloseIdx),
      status: 'created-new-metadata-block',
    };
  }
  const blockHtml = html.slice(range.start, range.end);
  const rows = parseRows(blockHtml);
  const existingRow = rows.find((r) => r.key === 'json-ld');
  const jsonText = escapeHtmlText(JSON.stringify(jsonLdValue));
  const newRowInner = `<div><p>json-ld</p></div><div><p>${jsonText}</p></div>`;

  if (existingRow) {
    const before = blockHtml.slice(0, existingRow.matchStart);
    const after = blockHtml.slice(existingRow.matchEnd);
    const newBlockHtml = `${before}<div>${newRowInner}</div>${after}`;
    return {
      html: html.slice(0, range.start) + newBlockHtml + html.slice(range.end),
      status: 'merged',
    };
  }
  const insertAt = range.closeTagStart - range.start;
  const newBlockHtml = `${blockHtml.slice(0, insertAt)}<div>${newRowInner}</div>${blockHtml.slice(insertAt)}`;
  return {
    html: html.slice(0, range.start) + newBlockHtml + html.slice(range.end),
    status: 'created',
  };
}

function processPath(p, stats, results, samplesByType) {
  const { type, segs } = classify(p);
  stats[type] = (stats[type] || 0) + 1;
  if (type === 'skip' || type === 'homepage') return;

  const file = contentFileFor(p);
  if (!fs.existsSync(file)) {
    stats['missing-file'] += 1;
    results.push({ path: p, type, status: 'missing-file' });
    return;
  }

  const html = fs.readFileSync(file, 'utf8');
  const range = findMetadataBlockRange(html);
  const rows = range ? parseRows(html.slice(range.start, range.end)) : [];
  const existingRow = rows.find((r) => r.key === 'json-ld');
  const existingRaw = existingRow ? unescapeHtmlText(existingRow.rawValue) : null;
  if (!range) stats['new-metadata-block'] = (stats['new-metadata-block'] || 0) + 1;

  const crumbs = buildCrumbs(p, type, segs);
  const node = buildBreadcrumbNode(p, crumbs);
  const merged = mergeJsonLd(existingRaw, node);
  if (merged.error) {
    stats['merge-error'] += 1;
    results.push({
      path: p, type, status: 'merge-error', error: merged.error,
    });
    return;
  }

  const applied = applyJsonLdRow(html, merged.value);
  if (applied.error) {
    stats['apply-error'] = (stats['apply-error'] || 0) + 1;
    results.push({
      path: p, type, status: 'apply-error', error: applied.error,
    });
    return;
  }

  if (WRITE) fs.writeFileSync(file, applied.html);

  const isFallback = (src) => src === 'slug-fallback' || src === 'slug-fallback-no-file';
  const fallbackCrumbs = crumbs.filter((c) => isFallback(c.labelSource));
  const noFileCrumbs = crumbs.filter((c) => c.labelSource === 'slug-fallback-no-file');
  if (fallbackCrumbs.length) {
    stats['slug-fallback-labels'] = (stats['slug-fallback-labels'] || 0) + fallbackCrumbs.length;
  }
  if (noFileCrumbs.length) {
    stats['pseudo-category-labels'] = (stats['pseudo-category-labels'] || 0) + noFileCrumbs.length;
  }
  const entry = {
    path: p,
    type,
    status: applied.status,
    breadcrumb: crumbs.map((c) => {
      const tag = isFallback(c.labelSource) ? ` [${c.labelSource.toUpperCase()}]` : '';
      return `${c.name} -> ${c.item}${tag}`;
    }),
    jsonLdPreview: JSON.stringify(merged.value, null, 2),
  };
  results.push(entry);
  const sampleKey = `${type}:${entry.status}`;
  if (!samplesByType[sampleKey]) samplesByType[sampleKey] = entry;
}

function main() {
  const allPaths = readSitemapPaths(sitemapPath);
  const results = [];
  const stats = {
    'top-level': 0,
    'blog-index': 0,
    'blog-category': 0,
    'blog-article': 0,
    skip: 0,
    homepage: 0,
    'missing-file': 0,
    'merge-error': 0,
  };
  const samplesByType = {};

  allPaths.forEach((p) => processPath(p, stats, results, samplesByType));

  console.log('=== Aggregate stats ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('created:', results.filter((r) => r.status === 'created').length);
  console.log('merged:', results.filter((r) => r.status === 'merged').length);
  console.log('missing-file:', results.filter((r) => r.status === 'missing-file').length);
  console.log('merge-error:', results.filter((r) => r.status === 'merge-error').length);

  console.log('\n=== Sample per page type (and merge vs create) ===');
  Object.entries(samplesByType).forEach(([key, entry]) => {
    console.log(`\n--- ${key}: ${entry.path} ---`);
    console.log(entry.breadcrumb.join('\n'));
  });

  fs.writeFileSync('/tmp/breadcrumb-migration-results.json', JSON.stringify(results, null, 2));
  const mode = WRITE ? 'WRITE mode' : 'DRY RUN';
  console.log(`\nFull results written to /tmp/breadcrumb-migration-results.json (${mode})`);
}

main();
