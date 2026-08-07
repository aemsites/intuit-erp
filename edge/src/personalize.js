/**
 * Server-side personalization transform.
 *
 * Given the origin HTML (buffered), an offer fragment's markup, and a resolved
 * map entry, inject the offer into the DOM before the page is returned to the
 * browser.
 *
 * Why a buffered string transform instead of HTMLRewriter:
 * HTMLRewriter is forward-streaming — by the time it sees the slot element, the
 * enclosing <section> wrapper has already been emitted, so it cannot retarget an
 * ancestor. Two of the required actions ("replace a section", "insert relative to
 * the enclosing section") need exactly that ancestor access. The reference
 * implementation (adobe-rnd/helix-mixer `inlines.js`) is string-based for the same
 * reason. Pages here are ~30KB, so buffering is negligible.
 *
 * Slots are matched generically: a block/section is a slot if its `class` list
 * contains the slot id, OR its `id` equals it, OR its `data-slot` equals it. This
 * lets the demo work whether the author drops an EDS block named "Slot 1"
 * (renders as `<div class="slot-1">`) or points the map at an existing block.
 */

/**
 * @typedef {'replace' | 'above' | 'below'} PznAction
 * @typedef {'block' | 'section' | 'page'} PznFidelity
 */

/**
 * @typedef {Object} PznEntry
 * @property {string} path Page path this offer applies to, e.g. "/" or "/construction".
 * @property {string} fragment Fragment reference, e.g. "/fragments/pzn/automation".
 * @property {string} location Slot id to target in the page markup, e.g. "slot-1".
 * @property {PznAction} action What to do at the slot.
 * @property {PznFidelity} fidelity Granularity of the target element.
 */

/**
 * @typedef {Object} Range
 * @property {number} start Index of the target element's opening `<`.
 * @property {number} end Index just past the target element's closing `>`.
 */

/** Matches an opening or closing <div ...> token (not other elements). */
const DIV_TOKEN_RE = /<div\b[^>]*>|<\/div\s*>/gi;
/** Matches an opening <div ...> and captures its attribute text. */
const OPEN_DIV_RE = /<div\b([^>]*)>/gi;

/**
 * Given the index just after a `<div ...>` opening tag, find its matching
 * `</div>` by counting nesting depth over div tokens only (void/other elements
 * do not affect div depth, so they are safely ignored).
 * @param {string} html
 * @param {number} afterOpenTag
 * @returns {{ closeStart: number, closeEnd: number } | null}
 */
function matchDivClose(html, afterOpenTag) {
  DIV_TOKEN_RE.lastIndex = afterOpenTag;
  let depth = 1;
  let m = DIV_TOKEN_RE.exec(html);
  while (m !== null) {
    const token = m[0];
    if (token[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        return { closeStart: m.index, closeEnd: DIV_TOKEN_RE.lastIndex };
      }
    } else if (!token.endsWith('/>')) {
      depth += 1;
    }
    m = DIV_TOKEN_RE.exec(html);
  }
  return null;
}

/**
 * Extracts a quoted attribute value from an opening tag's attribute text.
 * @param {string} attrs
 * @param {string} name
 * @returns {string | null}
 */
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(re);
  if (!m) return null;
  return (m[2] ?? m[3] ?? '').trim();
}

/**
 * True if the opening tag's attributes mark it as the given slot.
 * @param {string} attrs
 * @param {string} slot
 * @returns {boolean}
 */
function isSlot(attrs, slot) {
  const cls = attrValue(attrs, 'class');
  if (cls && cls.split(/\s+/).includes(slot)) return true;
  if (attrValue(attrs, 'id') === slot) return true;
  if (attrValue(attrs, 'data-slot') === slot) return true;
  return false;
}

/**
 * Finds the first block-level <div> matching the slot id.
 * @param {string} html
 * @param {string} slot
 * @returns {Range | null}
 */
function findSlotBlock(html, slot) {
  OPEN_DIV_RE.lastIndex = 0;
  let m = OPEN_DIV_RE.exec(html);
  while (m !== null) {
    if (isSlot(m[1], slot)) {
      const start = m.index;
      const close = matchDivClose(html, OPEN_DIV_RE.lastIndex);
      if (!close) return null;
      return { start, end: close.closeEnd };
    }
    m = OPEN_DIV_RE.exec(html);
  }
  return null;
}

/**
 * Inner content range of the first <main> element.
 * @param {string} html
 * @returns {Range | null}
 */
function findMainInner(html) {
  const open = html.search(/<main\b[^>]*>/i);
  if (open === -1) return null;
  const openEnd = html.indexOf('>', open) + 1;
  const close = html.indexOf('</main>', openEnd);
  if (close === -1) return null;
  return { start: openEnd, end: close };
}

/**
 * Finds the top-level section (a direct `<div>` child of `<main>`) that encloses
 * the slot at `slotStart`. EDS sections are the immediate `<div>` children of
 * `<main>`.
 * @param {string} html
 * @param {number} slotStart
 * @returns {Range | null}
 */
function findEnclosingSection(html, slotStart) {
  const main = findMainInner(html);
  if (!main) return null;
  let cursor = main.start;
  while (cursor < main.end) {
    const nextDiv = html.indexOf('<div', cursor);
    if (nextDiv === -1 || nextDiv >= main.end) break;
    const openEnd = html.indexOf('>', nextDiv) + 1;
    const close = matchDivClose(html, openEnd);
    if (!close) break;
    if (slotStart >= nextDiv && slotStart < close.closeEnd) {
      return { start: nextDiv, end: close.closeEnd };
    }
    cursor = close.closeEnd;
  }
  return null;
}

/**
 * If the markup is a single top-level `<div>...</div>` wrapper (an EDS section),
 * return its inner content; otherwise return it unchanged. Used so that a
 * block-fidelity injection drops the offer's *blocks* in place, rather than
 * nesting a section wrapper inside an existing section.
 * @param {string} markup
 * @returns {string}
 */
function stripOuterSection(markup) {
  const t = markup.trim();
  const open = /^<div\b[^>]*>/i.exec(t);
  if (!open) return t;
  const close = matchDivClose(t, open[0].length);
  if (!close || close.closeEnd !== t.length) return t;
  return t.slice(open[0].length, close.closeStart).trim();
}

/**
 * Resolves the DOM range the action should operate on.
 * @param {string} html
 * @param {PznEntry} entry
 * @returns {Range | null}
 */
function resolveTarget(html, entry) {
  if (entry.fidelity === 'page') return findMainInner(html);

  const slot = findSlotBlock(html, entry.location);
  if (!slot) return null;

  if (entry.fidelity === 'section') {
    return findEnclosingSection(html, slot.start) ?? slot;
  }
  return slot; // block
}

/**
 * @param {string} html
 * @param {number} from
 * @param {number} to
 * @param {string} insert
 * @returns {string}
 */
function splice(html, from, to, insert) {
  return html.slice(0, from) + insert + html.slice(to);
}

/**
 * Inject the offer into the origin HTML per the map entry.
 *
 * Returns the original HTML unchanged if the slot cannot be found — the worker
 * treats "no change" as a passthrough, so a missing slot never breaks the page.
 * @param {string} html
 * @param {string} offerMarkup
 * @param {PznEntry} entry
 * @returns {string}
 */
export function applyPersonalization(html, offerMarkup, entry) {
  const target = resolveTarget(html, entry);
  if (!target) return html;

  // Block fidelity injects the offer's blocks; section/page injects the whole
  // fragment (its outer <div> becomes a section).
  const content = entry.fidelity === 'block'
    ? stripOuterSection(offerMarkup)
    : offerMarkup.trim();
  const inject = `\n${content}\n`;

  switch (entry.action) {
    case 'above':
      return splice(html, target.start, target.start, inject);
    case 'below':
      return splice(html, target.end, target.end, inject);
    case 'replace':
    default:
      return splice(html, target.start, target.end, inject);
  }
}
