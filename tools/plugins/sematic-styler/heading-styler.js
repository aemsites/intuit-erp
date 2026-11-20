import {
  headingKey, parseSizeClass, matchHeadings, KEY_RE, SIZE_PATTERN,
} from '../../../scripts/heading-key.js';
import { startOp, endOp, now } from './metrics.js';

/*
 * Reads and writes heading/paragraph sizes in the DA page source.
 *
 * A size is stored either as a class on the element's block (`h2-1-size-xl`, tag-wide
 * `h2-size-xl` / `body-m`) or, for default content, as a token in the section metadata
 * `style` row. Legacy per-heading metadata rows (keyed by `headingKey`) are still read.
 */

const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';
const BODY = 'body-(?:l|m|s|xs|xxs)';
const BODY_CLASS_RE = new RegExp(`^${BODY}$`);
const PARAGRAPH_ALL_KEY = 'paragraph-all';
// What "apply to all paragraphs" writes: a bare body size or a tag-wide `p-size-body-*`.
const PARAGRAPH_ALL_STYLE_RE = new RegExp(`^(?:p-size-)?${BODY}$`);
// Any size class, positional or tag-wide, that the editor may fold onto a live section.
const SIZE_CLASS_RE = new RegExp(`^(?:(?:h[1-6]|p)(?:-[0-9]+)?-size-(?:${SIZE_PATTERN})|${BODY})$`);

const regexCache = new Map();
const regex = (source) => {
  if (!regexCache.has(source)) regexCache.set(source, new RegExp(source));
  return regexCache.get(source);
};

const tagName = (el) => el.tagName.toLowerCase();
const firstOf = (items, fn) => items.map(fn).find(Boolean);
const removeClasses = (el, test) => [...el.classList].filter(test)
  .forEach((name) => el.classList.remove(name));

/** `p` sizes from the body scale are written bare (`body-m`); others as `h2-size-xl`. */
const tagWideClass = (tag, size) => (tag === 'p' && BODY_CLASS_RE.test(size)
  ? size : `${tag}-size-${size}`);
const tagWideSize = (tag, token) => (tag === 'p' && BODY_CLASS_RE.test(token)
  ? token : regex(`^${tag}-size-(${SIZE_PATTERN})$`).exec(token)?.[1]);
const positionSize = (key, token) => regex(`^${key}-size-(${SIZE_PATTERN})$`).exec(token)?.[1];
// Tag-wide and positional styles of a tag, so applying to all replaces any per-element size.
// For `p` that includes any body token, also incomplete (`body`, `body-`) or legacy (`body-2`)
// ones left by hand edits, so an apply never leaves them next to the new size.
const tagStyleRe = (tag) => regex(`^(?:${tag}(?:-[0-9]+)?-(?:size|as)-${tag === 'p' ? '|body(?:-[a-z0-9]*)?$' : ''})`);
const styleFamily = (token) => (token.startsWith('body-') || token.startsWith('p-')
  ? 'p' : token.match(/^h[1-6]/)?.[0]);

/* ---------------------------------------------------------------- memo */

// Per-document memo for read-only lookups. Only documents passed to `cacheDoc` are memoized, so
// the documents `editDoc` parses and mutates always compute fresh.
const docCaches = new WeakMap();

/** Marks a parsed document as read-only so per-node lookups on it are memoized. */
export function cacheDoc(doc) {
  if (!docCaches.has(doc)) docCaches.set(doc, new Map());
  return doc;
}

/** Drops memoized lookups after a cached document is mutated. */
function resetDocCache(doc) {
  if (docCaches.has(doc)) docCaches.set(doc, new Map());
}

/** Memoizes `compute()` per node and name when the node's document is cached. */
export function memo(node, name, compute) {
  const cache = docCaches.get(node.ownerDocument || node);
  if (!cache) return compute();
  if (!cache.has(name)) cache.set(name, new WeakMap());
  const bucket = cache.get(name);
  if (!bucket.has(node)) bucket.set(node, compute());
  return bucket.get(node);
}

/* ------------------------------------------------------------ structure */

const sectionsOf = (doc) => memo(doc, 'sections', () => [...doc.querySelectorAll('main > div')]);

/** The block an element sits in, or null for default content. */
function blockOf(el) {
  const block = el.closest('main > div > div[class]');
  const isWrapper = block && [...block.classList].some((name) => name.endsWith('-wrapper'));
  return isWrapper ? null : block;
}

// A paragraph size token on a block, complete or still being typed (`body`, `body-`, `p-1-…`).
const PARAGRAPH_SIZE_TOKEN_RE = /^(?:body|p)(?:-|$)/;

/**
 * Whether the block carries any paragraph size of its own (its first class is the block name).
 * Such a block was sized by the author, or is being edited, so it is never auto-sized.
 */
export function hasParagraphSize(block) {
  return [...block.classList].slice(1).some((name) => PARAGRAPH_SIZE_TOKEN_RE.test(name));
}

/** Whether the element sits in a block the author has given a paragraph size. */
export const inSizedBlock = (el) => {
  const block = blockOf(el);
  return Boolean(block) && hasParagraphSize(block);
};

const blocksOf = (items) => new Set(items.map(({ el }) => blockOf(el)).filter(Boolean));
const defaultSectionsOf = (items) => new Set(items
  .filter(({ el }) => !blockOf(el)).map(({ section }) => section));

/** `h2-1`: the element's position among same-tag elements in its block. */
const positionKey = (el, block) => `${tagName(el)}-${[...block.querySelectorAll(el.tagName)].indexOf(el) + 1}`;

/** `h2-1`: the element's position among same-tag default-content elements in its section. */
function defaultPositionKey(el, section) {
  const peers = [...section.querySelectorAll(el.tagName)]
    .filter((peer) => !blockOf(peer) && !peer.closest('.section-metadata'));
  return `${tagName(el)}-${peers.indexOf(el) + 1}`;
}

/* ----------------------------------------------------- section metadata */

const rowKey = (row) => row.children[0]?.textContent.trim().toLowerCase();

function metaOf(section, create = false) {
  let meta = section.querySelector(':scope > .section-metadata');
  if (!meta && create) {
    meta = section.ownerDocument.createElement('div');
    meta.className = 'section-metadata';
    section.append(meta);
  }
  return meta;
}

const findRow = (section, key) => [...(metaOf(section)?.children || [])]
  .find((row) => rowKey(row) === key);

function setRow(section, key, value) {
  const existing = findRow(section, key);
  if (existing) {
    existing.children[1].textContent = value;
    return;
  }
  const row = section.ownerDocument.createElement('div');
  [key, value].forEach((text) => {
    const cell = section.ownerDocument.createElement('div');
    cell.textContent = text;
    row.append(cell);
  });
  metaOf(section, true).append(row);
}

function removeEmptyMetadata(section) {
  const meta = metaOf(section);
  if (meta && !meta.children.length) meta.remove();
}

/** Tokens of the section's `style` row. */
const styleTokens = (section) => findRow(section, 'style')?.children[1]?.textContent
  .split(/[\s,]+/).filter(Boolean) || [];

/** Writes the `style` row, removing it (and empty metadata) when there are no tokens left. */
function setStyleTokens(section, tokens) {
  if (tokens.length) {
    setRow(section, 'style', tokens.join(', '));
  } else {
    findRow(section, 'style')?.remove();
    removeEmptyMetadata(section);
  }
}

/** Legacy per-heading rows, keyed by `headingKey`. */
const entriesOf = (section) => [...(metaOf(section)?.children || [])]
  .filter((row) => KEY_RE.test(rowKey(row)))
  .map((row) => ({ key: rowKey(row), value: row.children[1]?.textContent.trim() || '', row }));

// Memoized per section on cached documents; `editDoc` documents re-match after every removal.
const matchOf = (section, el) => memo(section, 'match', () => matchHeadings(section, entriesOf(section)))
  .matched.find((m) => m.el === el);

const removeLegacyRows = (found) => found
  .forEach(({ section, el }) => matchOf(section, el)?.entry.row.remove());

/* -------------------------------------------------------------- reading */

/** Size from class tokens: the element's positional size wins over the tag-wide one. */
function sizeFrom(tokens, tag, key) {
  const size = firstOf(tokens, (token) => positionSize(key, token))
    || firstOf(tokens, (token) => tagWideSize(tag, token));
  return size ? parseSizeClass(`${tag}-size-${size}`) : null;
}

/** Section key and block position for a heading or paragraph in the source document. */
export function headingInfo(el) {
  return memo(el, 'info', () => {
    const section = el.closest('main > div');
    const block = blockOf(el);
    return {
      el,
      section,
      sectionIndex: sectionsOf(el.ownerDocument).indexOf(section) + 1,
      key: memo(el, 'key', () => headingKey(el, section)),
      block,
      blockName: (block && [...block.classList].find((name) => name !== 'block')) || '',
      position: block ? positionKey(el, block) : '',
      defaultPosition: block ? '' : defaultPositionKey(el, section),
    };
  });
}

/** Current heading/paragraph style; empty strings when unstyled. */
export function currentStyle(section, el) {
  return memo(el, 'style', () => {
    const block = blockOf(el);
    const tag = tagName(el);
    return (block && sizeFrom([...block.classList], tag, positionKey(el, block)))
      || sizeFrom(styleTokens(section), tag, defaultPositionKey(el, section))
      || parseSizeClass(matchOf(section, el)?.entry.value);
  });
}

/** The section-level "apply to all paragraphs" size: a tag-wide P token in its `style` row. */
export function sectionParagraphSize(section) {
  if (!section) return '';
  return firstOf(styleTokens(section), (token) => tagWideSize('p', token)) || '';
}

/**
 * Whether the section-level "apply to all paragraphs" is on: its `style` row has a tag-wide P
 * size. A legacy `paragraph-all: true` row (no longer written) still counts.
 */
export function paragraphAllEnabled(section) {
  if (!section) return false;
  return Boolean(sectionParagraphSize(section))
    || findRow(section, PARAGRAPH_ALL_KEY)?.children[1]?.textContent.trim().toLowerCase() === 'true';
}

/** Returns the shared tag-wide paragraph size only when it is applied to every paragraph. */
export function paragraphAllSize(paragraphs, pendingSizes) {
  if (!paragraphs.length) return '';
  const pendingReset = ({ sectionIndex, key }) => {
    const id = `${sectionIndex}:${key}`;
    return pendingSizes.has(id) && !pendingSizes.get(id);
  };
  if (pendingSizes && paragraphs.some(pendingReset)) return '';
  const sizes = paragraphs.map(({ section, el }) => {
    const block = blockOf(el);
    const tokens = block ? [...block.classList] : styleTokens(section);
    return firstOf(tokens, (token) => tagWideSize('p', token)) || '';
  });
  return sizes[0] && sizes.every((size) => size === sizes[0]) ? sizes[0] : '';
}

/* -------------------------------------------------------------- writing */

/** Use live section classes when the editor folds section metadata into the section element. */
export function syncLiveSectionStyles(section, liveSection) {
  const liveStyles = [...liveSection.classList].filter((name) => SIZE_CLASS_RE.test(name));
  if (!liveStyles.length) return;
  const liveFamilies = new Set(liveStyles.map(styleFamily));
  const kept = styleTokens(section).filter((token) => !liveFamilies.has(styleFamily(token)));
  setStyleTokens(section, [...new Set([...kept, ...liveStyles])]);
}

const isParagraphAll = (name) => PARAGRAPH_ALL_STYLE_RE.test(name);

/** Drops the section-level tag-wide P size from the section's `style` row, if it has one. */
function clearSectionParagraphSize(section) {
  const tokens = styleTokens(section);
  const kept = tokens.filter((token) => !isParagraphAll(token));
  if (kept.length !== tokens.length) setStyleTokens(section, kept);
}

export function clearParagraphAllStyles(paragraphs) {
  const section = paragraphs[0]?.section;
  if (!section) return;
  findRow(section, PARAGRAPH_ALL_KEY)?.remove();
  blocksOf(paragraphs).forEach((block) => removeClasses(block, isParagraphAll));
  clearSectionParagraphSize(section);
  removeEmptyMetadata(section);
  resetDocCache(section.ownerDocument);
}

/** Removes a block-level "apply to all paragraphs" (the paragraphs' blocks only), in place. */
export function clearBlockParagraphAllStyles(paragraphs) {
  blocksOf(paragraphs).forEach((block) => removeClasses(block, isParagraphAll));
  if (paragraphs[0]) resetDocCache(paragraphs[0].el.ownerDocument);
}

/** The targets' elements in `doc`, matched by section index and heading key. */
function resolveTargets(doc, targets) {
  return targets.map(({ sectionIndex, key }) => {
    const section = sectionsOf(doc)[sectionIndex - 1];
    const el = section && [...section.querySelectorAll(HEADINGS)]
      .find((h) => headingKey(h, section) === key);
    return el && { section, el };
  }).filter(Boolean);
}

/** Sets (or clears, with '') each target's own positional size. */
function applySizes(doc, targets, size) {
  const found = resolveTargets(doc, targets);
  found.forEach(({ section, el }) => {
    matchOf(section, el)?.entry.row.remove();
    const block = blockOf(el);
    if (block) {
      const key = positionKey(el, block);
      removeClasses(block, (name) => name.startsWith(`${key}-size-`) || name.startsWith(`${key}-as-`));
      if (size) block.classList.add(`${key}-size-${size}`);
      removeEmptyMetadata(section);
    } else {
      const key = defaultPositionKey(el, section);
      const tokens = styleTokens(section).filter((token) => !token.startsWith(`${key}-size-`));
      setStyleTokens(section, size ? [...tokens, `${key}-size-${size}`] : tokens);
    }
  });
  return found.length;
}

/**
 * Replaces the targets' per-element sizes with one tag-wide size on their blocks and on the
 * sections of their default content. With `section`, every target's section gets the size in
 * its `style` row, which also marks the section-level "apply to all paragraphs" as on.
 */
function applyTagSize(doc, targets, size, { section: sectionWide = false } = {}) {
  const found = resolveTargets(doc, targets);
  removeLegacyRows(found);
  const blocks = blocksOf(found);
  const sections = sectionWide
    ? new Set(found.map(({ section }) => section)) : defaultSectionsOf(found);
  // The size in the `style` row replaces the legacy `paragraph-all` marker.
  if (sectionWide) sections.forEach((section) => findRow(section, PARAGRAPH_ALL_KEY)?.remove());
  new Set(found.map(({ el }) => tagName(el))).forEach((tag) => {
    const isTagStyle = (name) => tagStyleRe(tag).test(name);
    const style = tagWideClass(tag, size);
    blocks.forEach((block) => {
      removeClasses(block, isTagStyle);
      block.classList.add(style);
    });
    sections.forEach((section) => {
      setStyleTokens(section, [...styleTokens(section).filter((t) => !isTagStyle(t)), style]);
    });
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

/**
 * Removes every tag-wide and positional size of the targets' tags, and (unless `sectionAll` is
 * false) the section-level apply-all.
 */
function clearSizes(doc, targets, { sectionAll = true } = {}) {
  const found = resolveTargets(doc, targets);
  removeLegacyRows(found);
  if (sectionAll) {
    // Its size lives in the `style` row even when every paragraph is in a block.
    new Set(found.map(({ section }) => section)).forEach((section) => {
      findRow(section, PARAGRAPH_ALL_KEY)?.remove();
      clearSectionParagraphSize(section);
    });
  }
  const patterns = [...new Set(found.map(({ el }) => tagName(el)))].map(tagStyleRe);
  const isTagStyle = (name) => patterns.some((re) => re.test(name));
  blocksOf(found).forEach((block) => removeClasses(block, isTagStyle));
  defaultSectionsOf(found).forEach((section) => {
    setStyleTokens(section, styleTokens(section).filter((token) => !isTagStyle(token)));
  });
  found.forEach(({ section }) => removeEmptyMetadata(section));
  return found.length;
}

/* -------------------------------------------------------------- saving */

export function sourceUrl({ org, repo, path }) {
  const p = (path || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/index';
  return `https://admin.da.live/source/${org}/${repo}${p}.html`;
}

/**
 * Save tuning. `attempts` bounds the read + save cycles per batch, whatever the cause (conflict,
 * overwrite by a collab flush, network failure, timeout, 429/5xx). Retries after a failure wait
 * `backoffMs`, doubling up to `maxBackoffMs` (or the server's Retry-After, within that cap).
 * Exported so tests can shorten the waits.
 */
export const SAVE_SETTINGS = {
  attempts: 4,
  timeoutMs: { GET: 10000, PUT: 20000, HEAD: 5000 },
  backoffMs: 400,
  maxBackoffMs: 3000,
};

const OVERWRITTEN = 'The page changed while saving. Apply the size again.';
const UNREACHABLE = 'Could not reach DA; check your connection and try again.';
const UNCONFIRMED = 'DA did not confirm the save. Check the page and apply the size again if it is missing.';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const etagOf = (resp) => resp.headers.get('etag')?.replace(/^W\//, '') || null;

/**
 * A failed save. `network`: DA was unreachable (offline, CORS, timeout); `uncertain`: a save may
 * have landed even so, since its response never arrived.
 */
export class SaveError extends Error {
  constructor(message, { network = false, uncertain = false, reason = '' } = {}) {
    super(message);
    this.name = 'SaveError';
    this.network = network;
    this.uncertain = uncertain;
    this.reason = reason;
  }
}

/**
 * `daFetch` with a timeout. daFetch turns a failed fetch (offline, CORS, abort) into a synthetic
 * 500 with no URL; that, a timeout, or a throw comes back as `{ failed: true }`.
 */
async function request(actions, url, opts = {}) {
  const method = opts.method || 'GET';
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ failed: true, timedOut: true });
    }, SAVE_SETTINGS.timeoutMs[method]);
  });
  const call = Promise.resolve()
    .then(() => actions.daFetch(url, { ...opts, signal: controller.signal }))
    .then((resp) => {
      if (!resp) return { failed: true };
      const synthetic = resp.status === 500 && !resp.url && Boolean(resp.statusText);
      return synthetic ? { failed: true, timedOut: controller.signal.aborted } : { resp };
    }, () => ({ failed: true }));
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The page source as text, or null when it can't be read (failure or timeout). */
export async function readSource({ actions, context }) {
  const { resp } = await request(actions, sourceUrl(context), { cache: 'no-store' });
  return resp?.ok ? resp.text() : null;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Wait before retry `attempt` + 1: exponential with jitter, or Retry-After, both capped. */
function backoff(attempt, resp) {
  const { backoffMs, maxBackoffMs } = SAVE_SETTINGS;
  const after = Number(resp?.headers.get('retry-after')) * 1000;
  const base = Number.isFinite(after) && after > 0 ? after : backoffMs * 2 ** (attempt - 1);
  return Math.min(maxBackoffMs, base * (0.75 + Math.random() * 0.5));
}

const progressListeners = new Set();
/** Calls `fn({ attempt, attempts, reason })` before each retry of a save. */
export function onSaveProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

const savedListeners = new Set();
/**
 * Calls `fn(html)` after a save confirmed (by ETag) to be the current source, so callers can use
 * the saved markup instead of reading the source again.
 */
export function onSourceSaved(fn) {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

/**
 * One read + edit + save cycle. Returns `{ results, outcome }` when done, or `{ retry }` (with
 * `wait`, `network`, `uncertain`, `resp`) when the cycle should run again; throws when it can't.
 * `uncertain`: an earlier PUT may have landed without its response reaching us.
 */
async function saveOnce(actions, url, edits, op, uncertain) {
  let t = now();
  const read = await request(actions, url, { cache: 'no-store' });
  op.fetchMs += now() - t;
  if (read.failed) {
    return {
      retry: read.timedOut ? 'read-timeout' : 'read-network', wait: true, network: true,
    };
  }
  const { status } = read.resp;
  if (!read.resp.ok) {
    if (RETRYABLE_STATUS.has(status)) return { retry: `read-${status}`, wait: true, resp: read.resp };
    throw new SaveError(`Load failed (${status})`, { reason: `read-${status}` });
  }
  const readEtag = etagOf(read.resp);
  const text = await read.resp.text();

  t = now();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const before = uncertain ? doc.documentElement.outerHTML : null;
  const results = edits.map((fn) => {
    try { return { value: fn(doc) }; } catch (error) { return { error }; }
  });
  if (results.every(({ error, value }) => error || value === false)) {
    op.transformMs += now() - t;
    return { results, outcome: results.some(({ error }) => error) ? 'failed' : 'nothing-to-save' };
  }
  const html = doc.documentElement.outerHTML;
  op.transformMs += now() - t;
  // The PUT whose response was lost did land: the edits change nothing, so saving again would
  // only make the editor reload once more.
  if (before === html) return { results, outcome: 'already-saved' };

  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  t = now();
  const saved = await request(actions, url, {
    method: 'PUT', body, headers: readEtag ? { 'If-Match': readEtag } : {},
  });
  op.saveMs += now() - t;
  if (saved.failed) {
    return {
      retry: saved.timedOut ? 'save-timeout' : 'save-network', wait: true, network: true, uncertain: true,
    };
  }
  if (saved.resp.status === 412) return { retry: 'conflict' };
  if (!saved.resp.ok) {
    const why = `save-${saved.resp.status}`;
    if (RETRYABLE_STATUS.has(saved.resp.status)) {
      return {
        retry: why, wait: true, uncertain: true, resp: saved.resp,
      };
    }
    throw new SaveError(`Save failed (${saved.resp.status})`, { reason: why });
  }

  const savedEtag = etagOf(saved.resp);
  if (!savedEtag) return { results, outcome: 'saved' };
  t = now();
  const head = await request(actions, url, { method: 'HEAD', cache: 'no-store' });
  op.verifyMs += now() - t;
  const currentEtag = head.resp?.ok ? etagOf(head.resp) : null;
  if (currentEtag === savedEtag) savedListeners.forEach((fn) => fn(html));
  // The PUT succeeded; without a readable HEAD there is nothing better to go on.
  if (!currentEtag || currentEtag === savedEtag) return { results, outcome: 'saved' };
  return { retry: 'overwritten-by-flush' };
}

/**
 * Applies `edits` to a fresh read of the source and saves it with `If-Match`, so the save never
 * replaces a version it didn't read. da-admin then has collab flush the editor's unsaved changes
 * before the PUT responds, and that flush can replace this save; a HEAD right after shows it as
 * a different ETag. Either way, and after a network failure, timeout or 429/5xx, the edits
 * (which only set or clear sizes, so they can run again) are re-applied to a fresh read, with
 * backoff, up to `SAVE_SETTINGS.attempts` cycles. Every request has a timeout.
 */
async function saveEdits(actions, url, edits) {
  const op = startOp();
  const { attempts } = SAVE_SETTINGS;
  let uncertain = false;
  let last = null;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      op.attempts = attempt;
      // eslint-disable-next-line no-await-in-loop -- each cycle depends on the one before.
      const step = await saveOnce(actions, url, edits, op, uncertain);
      if (step.results) {
        endOp(op, step.outcome, step.outcome === 'failed' ? 'target-missing' : '');
        return step.results;
      }
      last = step;
      uncertain ||= Boolean(step.uncertain);
      if (attempt < attempts) {
        op.retries.push(step.retry);
        const progress = { attempt: attempt + 1, attempts, reason: step.retry };
        progressListeners.forEach((fn) => fn(progress));
        // eslint-disable-next-line no-await-in-loop
        if (step.wait) await sleep(backoff(attempt, step.resp));
      }
    }
  } catch (e) {
    endOp(op, 'failed', e.reason || e.message);
    throw e;
  }
  endOp(op, 'failed', last.retry);
  // A PUT whose answer never arrived may have landed: say so rather than claim it failed.
  if (uncertain) {
    throw new SaveError(UNCONFIRMED, {
      network: last.network, uncertain: true, reason: last.retry,
    });
  }
  if (last.network) throw new SaveError(UNREACHABLE, { network: true, reason: last.retry });
  if (/^(?:read|save)-\d+$/.test(last.retry)) {
    throw new SaveError(`DA is not responding (${last.retry.split('-')[1]}). Try again shortly.`, { reason: last.retry });
  }
  throw new SaveError(OVERWRITTEN, { reason: last.retry });
}

let writes = Promise.resolve();
let batch = null;

/**
 * Applies `edit(doc)` to a fresh read of the page source and saves it. Edits queued while a save
 * is in flight share the next read + save. Resolves with the edit's return value; an edit that
 * returns `false` (and no other edit in its batch) skips the save.
 */
export function editDoc({ actions, context }, edit) {
  if (!batch) {
    const edits = [];
    const run = writes.then(() => {
      // Edits from here on wait for the next batch, since this one has read the source.
      batch = null;
      return saveEdits(actions, sourceUrl(context), edits);
    });
    batch = { edits, run };
    writes = run.catch(() => {});
  }
  const index = batch.edits.push(edit) - 1;
  return batch.run.then((results) => {
    if (results[index].error) throw results[index].error;
    return results[index].value;
  });
}

let nativeEditor = null;
/**
 * Registers `fn(edit)`, which applies `edit` in the editor itself when it can: it resolves with
 * `{ value }` once applied (the edit's return value), with null when the edit has to go through
 * a source save instead (nothing was changed), and rejects when the outcome is unknown.
 */
export function setNativeEditor(fn) {
  nativeEditor = fn;
}

/**
 * Saves `count(doc)`, failing with `message` when it touched nothing. A `native` edit (one that
 * may only change a block's classes) is first offered to the editor, then saved to the source.
 */
async function editCount(sdk, count, message, { native = false } = {}) {
  const counted = (doc) => {
    const n = count(doc);
    if (!n) throw new Error(message);
    return n;
  };
  if (native && nativeEditor) {
    const done = await nativeEditor(counted);
    if (done) return done.value;
  }
  return editDoc(sdk, counted);
}

export function setHeadingSize(sdk, target, size) {
  return editCount(sdk, (doc) => applySizes(doc, [target], size), 'Element moved since selection. Reselect it.', { native: true })
    .then(() => undefined);
}

export function setHeadingSizes(sdk, targets, size) {
  return editCount(sdk, (doc) => applyTagSize(doc, targets, size), 'Elements moved since selection. Reselect them.', { native: true });
}

/**
 * The section-level "apply to all paragraphs" size: tag-wide on the paragraphs' blocks, and in
 * the section's `style` row, which is what marks the section-level apply-all as on.
 */
export function setSectionParagraphSize(sdk, paragraphs, size) {
  return editCount(sdk, (doc) => applyTagSize(doc, paragraphs, size, { section: true }), 'Elements moved since selection. Reselect them.');
}

// Attributes the editor adds to its live document for SDK clients; not part of the content.
const EDITOR_ATTR_RE = /^data-(?:block-index|prose-index|image-index|image-version|cursor-remote(?:-color)?)$/;

/** A copy of a live-document block's markup without the editor's attributes. */
function editorFreeHtml(block) {
  const clone = block.cloneNode(true);
  [clone, ...clone.querySelectorAll('*')].forEach((el) => [...el.attributes]
    .filter(({ name }) => EDITOR_ATTR_RE.test(name))
    .forEach(({ name }) => el.removeAttribute(name)));
  return clone.outerHTML;
}

/**
 * Runs `edit(doc)` on a throwaway copy of the live document (`doc`) and checks it only changed
 * `block`. Returns `{ value, html }` (html: the block's new markup for an in-editor replace, null
 * when the block already shows the edit), or null when the edit failed or changed anything
 * outside the block (section metadata, other blocks), which only a source save can carry.
 */
export function singleBlockEdit(doc, block, edit) {
  const main = doc.querySelector('main');
  if (!main?.contains(block)) return null;
  const outside = () => {
    const mark = doc.createComment('');
    block.replaceWith(mark);
    const html = main.outerHTML;
    mark.replaceWith(block);
    return html;
  };
  const before = { block: block.outerHTML, outside: outside() };
  let value;
  try {
    value = edit(doc);
  } catch {
    return null;
  }
  if (!value || !main.contains(block) || outside() !== before.outside) return null;
  return { value, html: block.outerHTML === before.block ? null : editorFreeHtml(block) };
}

/**
 * A live-document block with the tag-wide paragraph `size` (replacing any other paragraph size),
 * as markup for the editor's `sendHTML` replace. `null` when the block already has exactly it.
 */
export function blockWithParagraphSize(block, size) {
  const style = tagWideClass('p', size);
  const isTagStyle = (name) => tagStyleRe('p').test(name);
  const classes = [...block.classList];
  if (classes.includes(style) && !classes.some((name) => name !== style && isTagStyle(name))) {
    return null;
  }
  const clone = block.cloneNode(true);
  removeClasses(clone, isTagStyle);
  clone.classList.add(style);
  return editorFreeHtml(clone);
}

/** Removes every applied size from the targets' blocks and default content in a single save. */
export function clearHeadingSizes(sdk, targets) {
  return editCount(sdk, (doc) => clearSizes(doc, targets), 'Elements moved since selection. Reselect them.');
}

/** Removes every applied size from one block's targets, leaving the section's settings alone. */
export function clearBlockSizes(sdk, targets) {
  return editCount(sdk, (doc) => clearSizes(doc, targets, { sectionAll: false }), 'Block moved since selection. Refresh the plugin.', { native: true });
}

/**
 * Turns the section-level "apply to all paragraphs" on (clearing per-paragraph sizes) or off.
 * Turning it on writes no marker: choosing a size (`setSectionParagraphSize`) puts that size in
 * the section's `style` row, and that is what keeps it on.
 */
export function setParagraphAllEnabled(sdk, paragraphs, enabled) {
  return editDoc(sdk, (doc) => {
    const found = resolveTargets(doc, paragraphs);
    if (!found.length) throw new Error('Section moved since selection. Refresh the plugin.');
    if (!enabled) return clearParagraphAllStyles(found);
    return clearSizes(doc, paragraphs);
  });
}

/** Turns a block-level "apply to all paragraphs" off: removes that block's tag-wide P size. */
export function clearBlockParagraphAll(sdk, paragraphs) {
  return editCount(sdk, (doc) => {
    const found = resolveTargets(doc, paragraphs);
    clearBlockParagraphAllStyles(found);
    return found.length;
  }, 'Block moved since selection. Refresh the plugin.', { native: true });
}
