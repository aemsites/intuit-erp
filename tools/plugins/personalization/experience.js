/**
 * Experience-tagging core — pure read/write of a DA source document.
 *
 * No DA SDK, no network, no panel DOM. Every function takes an HTML string
 * (the stored DA source — an EDS body fragment) and returns either parsed data
 * or a new HTML string. This is the risky part (a bad write corrupts page
 * source), so it is isolated here and unit-tested independently of the browser
 * wiring in index.js.
 *
 * Two authoring modes, each an id pulled from a separate source system:
 *   - EXPERIMENTATION (`exp`) — the experiment id
 *   - PERSONALIZATION  (`pzn`) — the placement id
 *
 * Storage — everything lives in metadata blocks so the aem.live PIPELINE emits
 * it as `data-*` attributes on the section, with the VALUE preserved verbatim
 * (camelCase survives). No CSS classes, no `Style` tokens.
 *
 *   SECTION / BLOCK  → rows in the section's Section Metadata block:
 *     `pzn` / `exp`                 = the id            → data-pzn / data-exp
 *     `pzn-block` / `exp-block`     = block name        → data-pzn-block / …
 *                                     (present only when block-scoped)
 *     `pzn-variants` / `exp-variants` = up to 5 fragment paths, comma-joined
 *   PAGE → rows in the page Metadata block:
 *     experimentation: `experiment-id`, `experiment-label` (opt), `experiment-variants`
 *     personalization:  `personalization-id`, `personalization-variants` (opt)
 *
 * A section carries the tag; the optional `*-block` row scopes it to one block
 * (matched by name — first match wins). `pzn` and `exp` are independent and may
 * coexist on one section.
 */

/** Valid modes. */
const MODES = ['exp', 'pzn'];

/** Max variants stored per tag. */
const MAX_VARIANTS = 5;

/** @param {string} html */
function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Serialize back to the stored body-fragment shape. @param {Document} doc */
function serialize(doc) {
  return doc.body.outerHTML;
}

/** Sections are the direct <div> children of <main>. @param {Document} doc */
function sectionEls(doc) {
  const main = doc.querySelector('main');
  if (!main) return [];
  return Array.from(main.children).filter((el) => el.tagName === 'DIV');
}

/**
 * Blocks in a section = its direct child <div>s that carry a class, excluding
 * the section-metadata and page-metadata blocks (metadata, not personalizable).
 * @param {Element} sectionEl
 */
function blockEls(sectionEl) {
  return Array.from(sectionEl.children).filter(
    (el) => el.tagName === 'DIV'
      && el.classList.length > 0
      && !el.classList.contains('section-metadata')
      && !el.classList.contains('metadata'),
  );
}

/** @param {Element} sectionEl */
function sectionMetaEl(sectionEl) {
  return Array.from(sectionEl.children).find(
    (el) => el.tagName === 'DIV' && el.classList.contains('section-metadata'),
  ) || null;
}

/** Whether a section carries the page Metadata block (its own trailing section). */
function hasPageMeta(sectionEl) {
  return Array.from(sectionEl.children).some(
    (el) => el.tagName === 'DIV' && el.classList.contains('metadata'),
  );
}

/** Ensure a section-metadata block exists in the section, creating it if absent. */
function ensureSectionMeta(doc, sectionEl) {
  let meta = sectionMetaEl(sectionEl);
  if (!meta) {
    meta = doc.createElement('div');
    meta.className = 'section-metadata';
    sectionEl.appendChild(meta);
  }
  return meta;
}

/* ---------------------------------------------------- generic key/value rows */

/**
 * A key/value block (`metadata` or `section-metadata`) is a list of rows, each
 * `<div><div>key</div><div>value</div></div>`. These helpers work on either.
 */

/** The row whose key cell matches (case-insensitive), or null. */
function rowFor(blockEl, key) {
  const wanted = key.toLowerCase();
  return Array.from(blockEl.children).find((row) => {
    const k = row.firstElementChild;
    return k && k.textContent.trim().toLowerCase() === wanted;
  }) || null;
}

/** Trimmed value for a key, or '' when the block/row is absent. */
function valueOf(blockEl, key) {
  if (!blockEl) return '';
  const row = rowFor(blockEl, key);
  const cell = row && row.children[1];
  return cell ? cell.textContent.trim() : '';
}

/** Set (create-or-update) a row's value. */
function setRow(doc, blockEl, key, value) {
  let row = rowFor(blockEl, key);
  if (!row) {
    row = doc.createElement('div');
    const k = doc.createElement('div');
    k.textContent = key;
    row.appendChild(k);
    row.appendChild(doc.createElement('div'));
    blockEl.appendChild(row);
  }
  row.children[1].textContent = value;
}

/** Remove a row by key if present. */
function removeRow(blockEl, key) {
  const row = rowFor(blockEl, key);
  if (row) row.remove();
}

/* -------------------------------------------------------------------- lists */

/** Reduce a full hlx.page/aem.page URL to a pathname; leave bare paths as-is. */
export function toPath(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).pathname;
    } catch {
      return s;
    }
  }
  return s;
}

/** Parse a metadata cell into a list of variant paths (comma/newline, capped). */
export function splitList(text) {
  return String(text == null ? '' : text)
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
}

/** Normalize a variant array to comma-joined pathnames (deduped-order, capped). */
export function joinList(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(toPath)
    .filter(Boolean)
    .slice(0, MAX_VARIANTS)
    .join(', ');
}

/* ---------------------------------------------------------------- page meta */

/** The page Metadata block (a `div.metadata` inside <main>), or null. */
function metadataEl(doc) {
  const main = doc.querySelector('main');
  return main ? main.querySelector('div.metadata') : null;
}

/** Find-or-create the page Metadata block, appending a trailing section if absent. */
function ensureMetadata(doc) {
  let meta = metadataEl(doc);
  if (!meta) {
    const main = doc.querySelector('main');
    if (!main) return null;
    const section = doc.createElement('div');
    meta = doc.createElement('div');
    meta.className = 'metadata';
    section.appendChild(meta);
    main.appendChild(section);
  }
  return meta;
}

/* -------------------------------------------------------------------- parse */

/**
 * Parse page-level experiment metadata plus an ordered list of sections, each
 * with its exp/pzn ids, optional block scope, and variant lists, and its blocks
 * (for the scope picker). A section carrying the page Metadata block is flagged
 * `hasPageMeta` so the UI can skip it as a tagging target.
 * @param {string} html
 */
export function parseExperience(html) {
  const doc = parseDoc(html);
  const meta = metadataEl(doc);
  const page = {
    experimentId: valueOf(meta, 'experiment-id'),
    experimentLabel: valueOf(meta, 'experiment-label'),
    experimentVariants: splitList(valueOf(meta, 'experiment-variants')),
    personalizationId: valueOf(meta, 'personalization-id'),
    personalizationVariants: splitList(valueOf(meta, 'personalization-variants')),
  };
  const sections = sectionEls(doc).map((sectionEl, index) => {
    const smeta = sectionMetaEl(sectionEl);
    return {
      index,
      hasPageMeta: hasPageMeta(sectionEl),
      blocks: blockEls(sectionEl).map((blockEl, blockIndex) => ({
        index: blockIndex,
        name: blockEl.classList[0],
      })),
      pzn: valueOf(smeta, 'pzn'),
      exp: valueOf(smeta, 'exp'),
      pznBlock: valueOf(smeta, 'pzn-block'),
      expBlock: valueOf(smeta, 'exp-block'),
      pznVariants: splitList(valueOf(smeta, 'pzn-variants')),
      expVariants: splitList(valueOf(smeta, 'exp-variants')),
    };
  });
  return { page, sections };
}

/* ------------------------------------------------------------ section writes */

/**
 * Set/update a section's tag for a mode. Writes the `mode` id row, the
 * `mode-block` row (only when `block` is set — else removes it), and the
 * `mode-variants` row (only when non-empty). Creates the section-metadata block
 * when absent; preserves the other mode's rows. Empty id is a no-op (use
 * clearSectionTag to remove).
 * @param {string} html
 */
export function setSectionTag(html, sectionIndex, mode, { id, block, variants } = {}) {
  if (!MODES.includes(mode)) return html;
  const cleanId = (id == null ? '' : String(id)).trim();
  if (!cleanId) return html;
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const meta = ensureSectionMeta(doc, section);

  setRow(doc, meta, mode, cleanId);

  const cleanBlock = (block == null ? '' : String(block)).trim();
  if (cleanBlock) setRow(doc, meta, `${mode}-block`, cleanBlock);
  else removeRow(meta, `${mode}-block`);

  const list = joinList(variants);
  if (list) setRow(doc, meta, `${mode}-variants`, list);
  else removeRow(meta, `${mode}-variants`);

  return serialize(doc);
}

/**
 * Clear a section's tag for a mode (id + block + variants). Drops the
 * section-metadata block when no rows remain.
 * @param {string} html
 */
export function clearSectionTag(html, sectionIndex, mode) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const meta = sectionMetaEl(section);
  if (!meta) return html;
  removeRow(meta, mode);
  removeRow(meta, `${mode}-block`);
  removeRow(meta, `${mode}-variants`);
  if (meta.children.length === 0) meta.remove();
  return serialize(doc);
}

/* --------------------------------------------------------------- page writes */

/**
 * Set the page-level experiment tags in the Metadata block. `id` is required
 * (falsy id is a no-op); `label` and `variants` are optional and removed when
 * blank/empty. Creates the Metadata block in a trailing section if none exists.
 * @param {string} html
 */
export function setPageExperiment(html, { id, label, variants } = {}) {
  const cleanId = (id == null ? '' : String(id)).trim();
  if (!cleanId) return html;
  const doc = parseDoc(html);
  const meta = ensureMetadata(doc);
  if (!meta) return html;

  setRow(doc, meta, 'experiment-id', cleanId);

  const cleanLabel = (label == null ? '' : String(label)).trim();
  if (cleanLabel) setRow(doc, meta, 'experiment-label', cleanLabel);
  else removeRow(meta, 'experiment-label');

  const list = joinList(variants);
  if (list) setRow(doc, meta, 'experiment-variants', list);
  else removeRow(meta, 'experiment-variants');

  return serialize(doc);
}

/**
 * Clear the page-level experiment tags. Removes the Metadata block (and its
 * wrapping section) only when it has no other rows left.
 * @param {string} html
 */
export function clearPageExperiment(html) {
  const doc = parseDoc(html);
  const meta = metadataEl(doc);
  if (!meta) return html;
  removeRow(meta, 'experiment-id');
  removeRow(meta, 'experiment-label');
  removeRow(meta, 'experiment-variants');
  if (meta.children.length === 0) {
    const section = meta.parentElement;
    meta.remove();
    if (section && section.tagName === 'DIV'
      && section.parentElement && section.parentElement.tagName === 'MAIN'
      && section.children.length === 0) {
      section.remove();
    }
  }
  return serialize(doc);
}

/**
 * Set the page-level personalization tags in the Metadata block. `id` is the
 * page-level placement (required — falsy id is a no-op); `variants` are optional
 * and removed when empty. There is no label (unlike experimentation). Creates the
 * Metadata block in a trailing section if none exists; preserves any experiment rows.
 * @param {string} html
 */
export function setPagePersonalization(html, { id, variants } = {}) {
  const cleanId = (id == null ? '' : String(id)).trim();
  if (!cleanId) return html;
  const doc = parseDoc(html);
  const meta = ensureMetadata(doc);
  if (!meta) return html;

  setRow(doc, meta, 'personalization-id', cleanId);

  const list = joinList(variants);
  if (list) setRow(doc, meta, 'personalization-variants', list);
  else removeRow(meta, 'personalization-variants');

  return serialize(doc);
}

/**
 * Clear the page-level personalization tags. Removes the Metadata block (and its
 * wrapping section) only when it has no other rows left (e.g. an experiment tag).
 * @param {string} html
 */
export function clearPagePersonalization(html) {
  const doc = parseDoc(html);
  const meta = metadataEl(doc);
  if (!meta) return html;
  removeRow(meta, 'personalization-id');
  removeRow(meta, 'personalization-variants');
  if (meta.children.length === 0) {
    const section = meta.parentElement;
    meta.remove();
    if (section && section.tagName === 'DIV'
      && section.parentElement && section.parentElement.tagName === 'MAIN'
      && section.children.length === 0) {
      section.remove();
    }
  }
  return serialize(doc);
}

/** Build the multipart body the DA Source API PUT expects. @param {string} html */
export function buildFormData(html) {
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  return body;
}
