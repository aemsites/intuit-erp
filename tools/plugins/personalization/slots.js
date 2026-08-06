/**
 * Personalization slot core — pure read/write of a DA source document.
 *
 * No DA SDK, no network, no panel DOM. Every function takes an HTML string
 * (the stored DA source — an EDS body fragment) and returns either parsed slot
 * data or a new HTML string. This is the risky part (a bad write corrupts page
 * source), so it is isolated here and unit-tested independently of the browser
 * wiring in index.js.
 *
 * Slot model (matches what edge/src/de reads back at delivery):
 *   - BLOCK slot   → a `slot-x` class on a block <div>.
 *   - SECTION slot → a `slot-x` token in a Section Metadata `Style` row (EDS
 *                    renders it as a class on the section wrapper).
 */

const SLOT_RE = /^slot-[a-z0-9-]+$/;

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
 * the section-metadata block (which is metadata, not a personalizable block).
 * @param {Element} sectionEl
 */
function blockEls(sectionEl) {
  return Array.from(sectionEl.children).filter(
    (el) => el.tagName === 'DIV'
      && el.classList.length > 0
      && !el.classList.contains('section-metadata'),
  );
}

/** First class token matching the slot shape, or null. @param {DOMTokenList} classList */
function slotOf(classList) {
  return Array.from(classList).find((c) => SLOT_RE.test(c)) || null;
}

/** @param {Element} sectionEl */
function sectionMetaEl(sectionEl) {
  return Array.from(sectionEl.children).find(
    (el) => el.tagName === 'DIV' && el.classList.contains('section-metadata'),
  ) || null;
}

/** The `Style` row of a section-metadata block (key match is case-insensitive). */
function styleRow(metaEl) {
  return Array.from(metaEl.children).find((row) => {
    const key = row.firstElementChild;
    return key && key.textContent.trim().toLowerCase() === 'style';
  }) || null;
}

/** Read the section-level slot from its metadata `Style` row, or null. */
function sectionSlotOf(sectionEl) {
  const meta = sectionMetaEl(sectionEl);
  if (!meta) return null;
  const row = styleRow(meta);
  const valueCell = row && row.children[1];
  if (!valueCell) return null;
  return valueCell.textContent.split(',').map((t) => t.trim()).find((t) => SLOT_RE.test(t)) || null;
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

/** Style tokens minus any slot token and empties. @param {Element} valueCell */
function nonSlotStyleTokens(valueCell) {
  const text = valueCell ? valueCell.textContent : '';
  return text.split(',').map((t) => t.trim()).filter(Boolean).filter((t) => !SLOT_RE.test(t));
}

/**
 * Parse the page into an ordered list of sections, each with its section-level
 * slot and its blocks (each with their own slot). `(sectionIndex, blockIndex)`
 * is the stable address the mutators below also use.
 * @param {string} html
 */
export function parseSlots(html) {
  const sections = sectionEls(parseDoc(html)).map((sectionEl, index) => ({
    index,
    sectionSlot: sectionSlotOf(sectionEl),
    blocks: blockEls(sectionEl).map((blockEl, blockIndex) => ({
      index: blockIndex,
      name: blockEl.classList[0],
      slot: slotOf(blockEl.classList),
    })),
  }));
  return { sections };
}

/**
 * Set (or, with a falsy slotId, clear) the slot class on a block. Removes any
 * existing slot class first so a block never carries two.
 * @param {string} html
 */
export function setBlockSlot(html, sectionIndex, blockIndex, slotId) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const block = blockEls(section)[blockIndex];
  if (!block) return html;
  Array.from(block.classList).forEach((c) => {
    if (SLOT_RE.test(c)) block.classList.remove(c);
  });
  if (slotId) block.classList.add(slotId);
  return serialize(doc);
}

/** Clear the slot class on a block. @param {string} html */
export function clearBlockSlot(html, sectionIndex, blockIndex) {
  return setBlockSlot(html, sectionIndex, blockIndex, null);
}

/**
 * Set the section-level slot, preserving any other `Style` tokens. Creates the
 * section-metadata block and `Style` row when absent; replaces an existing slot.
 * @param {string} html
 */
export function setSectionSlot(html, sectionIndex, slotId) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const row = ensureStyleRow(doc, ensureSectionMeta(doc, section));
  const tokens = nonSlotStyleTokens(row.children[1]);
  if (slotId) tokens.push(slotId);
  row.children[1].textContent = tokens.join(', ');
  return serialize(doc);
}

/**
 * Clear the section-level slot. Drops the `Style` row if it becomes empty, and
 * the section-metadata block if it then has no rows left.
 * @param {string} html
 */
export function clearSectionSlot(html, sectionIndex) {
  const doc = parseDoc(html);
  const section = sectionEls(doc)[sectionIndex];
  if (!section) return html;
  const meta = sectionMetaEl(section);
  if (!meta) return html;
  const row = styleRow(meta);
  if (row) {
    const tokens = nonSlotStyleTokens(row.children[1]);
    if (tokens.length === 0) row.remove();
    else row.children[1].textContent = tokens.join(', ');
  }
  if (meta.children.length === 0) meta.remove();
  return serialize(doc);
}

/** Every slot id assigned anywhere on the page (deduped). @param {string} html */
export function collectPageSlots(html) {
  const { sections } = parseSlots(html);
  const slots = [];
  sections.forEach((s) => {
    if (s.sectionSlot) slots.push(s.sectionSlot);
    s.blocks.forEach((b) => { if (b.slot) slots.push(b.slot); });
  });
  return Array.from(new Set(slots));
}

/** Build the multipart body the DA Source API PUT expects. @param {string} html */
export function buildFormData(html) {
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  return body;
}
