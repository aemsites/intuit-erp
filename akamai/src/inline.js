/*
 * Pure, environment-agnostic logic for inlining the header (nav) and footer
 * fragments into an aem.live HTML page, and for forwarding the Akamai cache tag
 * so push invalidation stays correct.
 *
 * This file has NO Akamai (`http-request`/`create-response`) imports on purpose:
 * it is unit-tested under vitest (see test/akamai-inline.test.js) and consumed by
 * the EdgeWorker entry point (src/main.js), which supplies the runtime I/O.
 *
 * Ported and trimmed from adobe-rnd/helix-mixer `src/inlines.js`
 * (https://github.com/adobe-rnd/helix-mixer/blob/main/src/inlines.js). We keep
 * ONLY the empty-<header>/<footer> inlining path — no #inline / path-prefix
 * fragment inlining — and only the Akamai `edge-cache-tag` cache-key family.
 */

// Default fragment locations, matching the front-end (blocks/header/header.js,
// blocks/footer/footer.js) which default to /nav and /footer when no metadata
// override is authored.
export const DEFAULT_NAV_PATH = '/nav';
export const DEFAULT_FOOTER_PATH = '/footer';

// The front-end (scripts/scripts.js) removes the header/footer entirely when
// these metadata values are set; treat the same values as "hidden" so we don't
// waste a subrequest inlining chrome that will be discarded.
const HIDE_VALUES = new Set(['true', 'yes', 'hide']);

/**
 * Read a `<meta name="..." content="...">` value from raw HTML.
 * @param {string} html
 * @param {string} name
 * @returns {string|undefined}
 */
export function metaContent(html, name) {
  const re = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i');
  return html.match(re)?.[1];
}

/**
 * @param {string} html
 * @param {string} name
 * @returns {boolean}
 */
function metaIsHidden(html, name) {
  const value = metaContent(html, name);
  return !!value && HIDE_VALUES.has(value.trim().toLowerCase());
}

/**
 * Decide which fragments to inline, honoring `nav`/`footer` metadata overrides
 * and defaulting to /nav and /footer. A path is only returned when the matching
 * EMPTY tag exists in the markup (nothing to inline into otherwise) and the
 * corresponding hide-header/hide-footer metadata is absent.
 * @param {string} html
 * @returns {{navPath: string|null, footerPath: string|null}}
 */
export function resolveFragmentPaths(html) {
  const hasHeaderTag = html.includes('<header></header>');
  const hasFooterTag = html.includes('<footer></footer>');
  const navPath = hasHeaderTag && !metaIsHidden(html, 'hide-header')
    ? (metaContent(html, 'nav') || DEFAULT_NAV_PATH)
    : null;
  const footerPath = hasFooterTag && !metaIsHidden(html, 'hide-footer')
    ? (metaContent(html, 'footer') || DEFAULT_FOOTER_PATH)
    : null;
  return { navPath, footerPath };
}

/**
 * Turn a fragment path into its `.plain.html` sibling. Folder-index pages serve
 * content only at `/foo/index.plain.html`, not `/foo/.plain.html` — mirror
 * blocks/fragment/fragment.js.
 * @param {string} path
 * @returns {string}
 */
export function toPlainHtmlPath(path) {
  const base = path.endsWith('/') ? `${path}index` : path;
  return base.endsWith('.plain.html') ? base : `${base}.plain.html`;
}

/**
 * A headers bag whose `get` returns a single string or null (DOM `Headers`, the
 * EdgeWorkers httpResponse header helper wrapped by main.js, or a plain object
 * lookup) — only `.get` is used.
 * @typedef {{ get: (name: string) => string | null | undefined }} HeaderBag
 */

/**
 * Seed the Akamai cache-tag set from a response's `edge-cache-tag` header.
 * @param {HeaderBag} headers
 * @returns {Set<string>}
 */
export function createCacheKeys(headers) {
  return new Set(splitTags(headers.get('edge-cache-tag')));
}

/**
 * Union another response's `edge-cache-tag` values into the running set. This is
 * the whole point: the composed page carries the nav's and footer's tags, so
 * push invalidation of a fragment purges every page that inlined it.
 * @param {Set<string>} keys
 * @param {HeaderBag} headers
 */
export function mergeCacheKeys(keys, headers) {
  splitTags(headers.get('edge-cache-tag')).forEach((tag) => keys.add(tag));
}

/**
 * @param {string|null|undefined} value comma-delimited edge-cache-tag header
 * @returns {string[]}
 */
function splitTags(value) {
  return (value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Serialize the unioned cache tags back to the Akamai header format.
 * @param {Set<string>} keys
 * @returns {string}
 */
export function serializeCacheKeys(keys) {
  return [...keys].join(',');
}

/**
 * Indent every line of `markup` by `count` spaces.
 * @param {string} markup
 * @param {number} count
 * @returns {string}
 */
function indent(markup, count) {
  return markup.replace(/^/gm, ' '.repeat(count));
}

/**
 * Replace an empty `<tag></tag>` with the fetched fragment wrapped in a `<nav>`
 * landmark: `<tag>\n  <nav>\n    {fragmentMarkup}\n  </nav>\n</tag>`. The `<nav>`
 * keeps the initial markup semantic / a11y-friendly and crawlable; the raw EDS
 * `.plain.html` (div soup) is dumped inside it verbatim, and the front-end
 * (header.js/footer.js) consumes it from `${tag} > nav`. Indentation of the
 * original tag is preserved.
 * @param {string} markup full page HTML
 * @param {'header'|'footer'} tag
 * @param {string} fragmentMarkup the fetched `.plain.html` body
 * @returns {string}
 */
export function inlineTag(markup, tag, fragmentMarkup) {
  if (!fragmentMarkup) return markup;
  const indentMatch = markup.match(new RegExp(`([^\\S\\n]*)<${tag}></${tag}>`));
  const pad = indentMatch?.[1] ?? '';
  const inner = indent(fragmentMarkup.trim(), pad.length + 4);
  return markup.replace(
    `<${tag}></${tag}>`,
    `<${tag}>\n${pad}  <nav>\n${inner}\n${pad}  </nav>\n${pad}</${tag}>`,
  );
}
