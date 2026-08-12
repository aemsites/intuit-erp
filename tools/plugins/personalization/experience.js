/**
 * Experience-tagging core — pure read/write of a DA source document.
 *
 * No DA SDK, no network, no panel DOM. Every function takes an HTML string
 * (the stored DA source — an EDS body fragment) and returns either parsed data
 * or a new HTML string. This is the risky part (a bad write corrupts page
 * source), so it is isolated here and unit-tested independently of the browser
 * wiring in index.js.
 *
 * Two authoring modes, each an author-entered free-form id:
 *   - EXPERIMENTATION (`exp`)
 *   - PERSONALIZATION  (`pzn`)
 *
 * Placement model:
 *   - PAGE   → experimentation only: `experiment-id` / `experiment-label` rows
 *              in the page Metadata block (values kept verbatim, not slugified).
 *   - SECTION → an `exp-<id>` / `pzn-<id>` token in the section's Section
 *               Metadata `Style` row (EDS renders it as a class on the section).
 *   - BLOCK  → an `exp-<id>` / `pzn-<id>` class on the block <div>.
 *
 * `<id>` for section/block tokens is slugified to a valid class (`[a-z0-9-]+`).
 */

/** Valid modes. */
const MODES = ['exp', 'pzn'];

/** @param {string} html */
function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Serialize back to the stored body-fragment shape. Faithful for a DA source
 * document; prototype-acceptable normalization only.
 * @param {Document} doc
 */
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

/** Turn free-form text into a valid class/id token, or '' when empty. */
export function slugify(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `${mode}-${slug}` for a valid mode + non-empty id, else null. */
function tagToken(mode, id) {
  if (!MODES.includes(mode)) return null;
  const slug = slugify(id);
  return slug ? `${mode}-${slug}` : null;
}

/** Whether a token is an `<mode>-…` tag token. */
function isModeToken(token, mode) {
  return new RegExp(`^${mode}-[a-z0-9-]+$`).test(token);
}

/** First class token for a mode, or null. @param {DOMTokenList} classList */
function blockTagOf(classList, mode) {
  return Array.from(classList).find((c) => isModeToken(c, mode)) || null;
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

/** The `Style` row of a section-metadata block (key match is case-insensitive). */
function styleRow(metaEl) {
  return Array.from(metaEl.children).find((row) => {
    const key = row.firstElementChild;
    return key && key.textContent.trim().toLowerCase() === 'style';
  }) || null;
}

/** Trimmed, non-empty comma tokens of a value cell. @param {Element} valueCell */
function styleTokens(valueCell) {
  const text = valueCell ? valueCell.textContent : '';
  return text.split(',').map((t) => t.trim()).filter(Boolean);
}

/** Read a section-level tag token for a mode from its `Style` row, or null. */
function sectionTagOf(sectionEl, mode) {
  const meta = sectionMetaEl(sectionEl);
  if (!meta) return null;
  const row = styleRow(meta);
  const valueCell = row && row.children[1];
  if (!valueCell) return null;
  return styleTokens(valueCell).find((t) => isModeToken(t, mode)) || null;
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

/** Ensure a `Style` row exists in the section-metadata block, creating it if absent. */
function ensureStyleRow(doc, metaEl) {
  let row = styleRow(metaEl);
  if (!row) {
    row = doc.createElement('div');
    const key = doc.createElement('div');
    key.textContent = 'Style';
    row.appendChild(key);
    row.appendChild(doc.createElement('div'));
    metaEl.appendChild(row);
  }
  return row;
}

/* ------------------------------------------------------------------ page meta */

/** The page Metadata block (a `div.metadata` inside <main>), or null. */
function metadataEl(doc) {
  const main = doc.querySelector('main');
  return main ? main.querySelector('div.metadata') : null;
}

/** A metadata row by key (case-insensitive), or null. */
function metaRow(metaEl, key) {
  const wanted = key.toLowerCase();
  return Array.from(metaEl.children).find((row) => {
    const k = row.firstElementChild;
    return k && k.textContent.trim().toLowerCase() === wanted;
  }) || null;
}

/** Trimmed value of a metadata row, or '' when the block/row is absent. */
function metaValue(metaEl, key) {
  if (!metaEl) return '';
  const row = metaRow(metaEl, key);
  const cell = row && row.children[1];
  return cell ? cell.textContent.trim() : '';
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

/** Set (create-or-update) a metadata row's value. */
function setMetaRow(doc, metaEl, key, value) {
  let row = metaRow(metaEl, key);
  if (!row) {
    row = doc.createElement('div');
    const k = doc.createElement('div');
    k.textContent = key;
    row.appendChild(k);
    row.appendChild(doc.createElement('div'));
    metaEl.appendChild(row);
  }
  row.children[1].textContent = value;
}

/** Remove a metadata row by key if present. */
function removeMetaRow(metaEl, key) {
  const row = metaRow(metaEl, key);
  if (row) row.remove();
}

/* -------------------------------------------------------------------- exports */

/**
 * Parse the page into page-level experiment metadata plus an ordered list of
 * sections, each with its section-level exp/pzn tokens and its blocks (each with
 * their own exp/pzn tokens). `(sectionIndex, blockIndex)` is the stable address
 * the mutators below also use. A section carrying the page Metadata block is
 * flagged `hasPageMeta` so the UI can skip it as a tagging target.
 * @param {string} html
 */
export function parseExperience(html) {
  const doc = parseDoc(html);
  const meta = metadataEl(doc);
  const page = {
    experimentId: metaValue(meta, 'experiment-id'),
    experimentLabel: metaValue(meta, 'experiment-label'),
  };
  const sections = sectionEls(doc).map((sectionEl, index) => ({
    index,
    hasPageMeta: hasPageMeta(sectionEl),
    exp: sectionTagOf(sectionEl, 'exp'),
    pzn: sectionTagOf(sectionEl, 'pzn'),
    blocks: blockEls(sectionEl).map((blockEl, blockIndex) => ({
      index: blockIndex,
      name: blockEl.classList[0],
      exp: blockTagOf(blockEl.classList, 'exp'),
      pzn: blockTagOf(blockEl.classList, 'pzn'),
    })),
  }));
  return { page, sections };
}

/**
 * Set (or, with a falsy id, clear) the `<mode>-<id>` class on a block. Removes
 * any existing token of the same mode first so a block never carries two of one
 * mode; the two modes may coexist.
 * @param {string} html
 */
export function setBlockTag(html, sectionIndex, blockIndex, mode, id) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const block = blockEls(section)[blockIndex];
  if (!block) return html;
  Array.from(block.classList).forEach((c) => {
    if (isModeToken(c, mode)) block.classList.remove(c);
  });
  const token = tagToken(mode, id);
  if (token) block.classList.add(token);
  return serialize(doc);
}

/** Clear a block's tag for a mode. @param {string} html */
export function clearBlockTag(html, sectionIndex, blockIndex, mode) {
  return setBlockTag(html, sectionIndex, blockIndex, mode, null);
}

/**
 * Set the section-level tag for a mode, preserving any other `Style` tokens
 * (including the other mode). Creates the section-metadata block and `Style` row
 * when absent; replaces an existing token of the same mode. A falsy/invalid id
 * is a no-op (use clearSectionTag to remove).
 * @param {string} html
 */
export function setSectionTag(html, sectionIndex, mode, id) {
  const token = tagToken(mode, id);
  if (!token) return html;
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const row = ensureStyleRow(doc, ensureSectionMeta(doc, section));
  const tokens = styleTokens(row.children[1]).filter((t) => !isModeToken(t, mode));
  tokens.push(token);
  row.children[1].textContent = tokens.join(', ');
  return serialize(doc);
}

/**
 * Clear the section-level tag for a mode. Drops the `Style` row if it becomes
 * empty, and the section-metadata block if it then has no rows left.
 * @param {string} html
 */
export function clearSectionTag(html, sectionIndex, mode) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const meta = sectionMetaEl(section);
  if (!meta) return html;
  const row = styleRow(meta);
  if (row) {
    const tokens = styleTokens(row.children[1]).filter((t) => !isModeToken(t, mode));
    if (tokens.length === 0) row.remove();
    else row.children[1].textContent = tokens.join(', ');
  }
  if (meta.children.length === 0) meta.remove();
  return serialize(doc);
}

/**
 * Set the page-level experiment tags in the Metadata block. `id` is required
 * (a falsy id is a no-op); `label` is optional and removed when blank. Values
 * are stored verbatim (metadata, not a class). Creates the Metadata block in a
 * trailing section if none exists.
 * @param {string} html
 */
export function setPageExperiment(html, { id, label } = {}) {
  const cleanId = (id == null ? '' : String(id)).trim();
  if (!cleanId) return html;
  const doc = parseDoc(html);
  const meta = ensureMetadata(doc);
  if (!meta) return html;
  setMetaRow(doc, meta, 'experiment-id', cleanId);
  const cleanLabel = (label == null ? '' : String(label)).trim();
  if (cleanLabel) setMetaRow(doc, meta, 'experiment-label', cleanLabel);
  else removeMetaRow(meta, 'experiment-label');
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
  removeMetaRow(meta, 'experiment-id');
  removeMetaRow(meta, 'experiment-label');
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
