/**
 * Template-fill personalization: the origin page itself is the template.
 *
 * Some EDS pages are authored with literal ALL-CAPS placeholder tokens (TITLE,
 * BODY, ...) and a sibling data sheet (a `*.json` spreadsheet). This resolver
 * fetches that sheet's first row and fills each placeholder from it, so the
 * page's own `<title>`, social meta, and headings render live data. Nothing is
 * injected — the page's own markup is the offer, a per-key text substitution.
 *
 * Distinct from the fragment-injection flow (pzn.js / ixp/*): there is no slot
 * and no offer fragment. The mapping is by convention: a data key `title` fills
 * the `TITLE` placeholder (placeholder = key upper-cased).
 *
 * Example — `/drafts/pzn/automation` is authored as:
 *     <title>TITLE</title>                    (also og:title / twitter:title)
 *     <h2 id="title">TITLE</h2>
 *     <p>BODY</p>
 * and `/drafts/pzn/api.json` resolves to:
 *     { "data": [{ "title": "Automate the routine", "body": "Intuit AI ..." }] }
 * so every TITLE becomes "Automate the routine" and BODY the body copy.
 */

import { escapeHtml } from './pzn.js';

/**
 * Path → sibling data sheet (origin-relative). Small and static by design (a
 * POC-scale lookup); a real deployment would source this from config or the pzn
 * service. Mirrors the path-table pattern in ixp/routes.js.
 * @type {Record<string, string>}
 */
export const TEMPLATE_SOURCES = {
  '/drafts/pzn/automation': '/drafts/pzn/api.json',
};

/**
 * Drops a trailing slash except at root, so `/x/` and `/x` match the same key.
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Resolves the fill data for a page, or null if the path has no template sheet.
 *
 * Returns the sheet's first row coerced to string values. Any failure (path not
 * enrolled, fetch/parse error, empty sheet) yields null so the caller passes the
 * page through untouched. Non-enrolled paths short-circuit before any fetch.
 * @param {Env} env
 * @param {string} path
 * @returns {Promise<Record<string, string> | null>}
 */
export async function resolveTemplateData(env, path) {
  const source = TEMPLATE_SOURCES[normalizePath(path)];
  if (!source) return null;

  const sheetUrl = new URL(source, env.ORIGIN_BASE_URL).toString();
  try {
    // Not cached at the edge yet — same open caching question as the pzn map.
    const res = await fetch(sheetUrl, { cf: { cacheTtl: 0 } });
    if (!res.ok) return null;
    const json = await res.json();
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    if (!row) return null;

    const data = {};
    for (const [key, value] of Object.entries(row)) {
      if (value != null) data[key] = String(value);
    }
    return Object.keys(data).length ? data : null;
  } catch {
    return null;
  }
}

/**
 * Escapes regex metacharacters so a token is matched literally.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces each key's upper-cased token in `text` (whole-word, HTML-escaped).
 * @param {string} text
 * @param {Record<string, string>} data
 * @returns {string}
 */
function replaceTokens(text, data) {
  let out = text;
  for (const [key, value] of Object.entries(data)) {
    const token = key.toUpperCase();
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g');
    const replacement = escapeHtml(value);
    // A replacer function so `$` in a value is inserted literally, not treated
    // as a replacement pattern.
    out = out.replace(re, () => replacement);
  }
  return out;
}

/**
 * Fills ALL-CAPS placeholder tokens in the page's visible body from `data`. For
 * each key, every whole-word, case-sensitive occurrence of its upper-cased token
 * (e.g. `TITLE`) inside `<body>` is replaced with the HTML-escaped value.
 *
 * Scope: only the `<body>`. Head metadata (`<title>`, `og:`/`twitter:` meta,
 * JSON-LD) keeps its authored placeholders untouched — the fill personalizes the
 * rendered page, not the document's SEO/social metadata. Falls back to the whole
 * string when there is no `<body>` (e.g. a bare fragment).
 *
 * Case-sensitivity + word boundaries keep the substitution to the authored
 * placeholders only: it never touches the lowercase attribute/tag names that
 * share the word (`id="title"`, `og:title`, `<body>`), nor a token embedded in a
 * larger word.
 * @param {string} html
 * @param {Record<string, string>} data
 * @returns {string}
 */
export function fillPlaceholders(html, data) {
  const open = /<body\b[^>]*>/i.exec(html);
  if (!open) return replaceTokens(html, data);
  const start = open.index + open[0].length;
  const closeIdx = html.toLowerCase().indexOf('</body>', start);
  const end = closeIdx === -1 ? html.length : closeIdx;
  return html.slice(0, start) + replaceTokens(html.slice(start, end), data) + html.slice(end);
}
