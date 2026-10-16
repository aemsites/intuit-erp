// Stable per-heading key: hash of the structural path inside its section, shared by the DA plugin and the page.
// decorateSections wraps blocks in classless divs; `<block>-wrapper` is only added later by decorateBlocks.
const isWrapper = (n) => n.classList.contains('default-content-wrapper')
  || [...n.classList].some((c) => c.endsWith('-wrapper'))
  || (n.tagName === 'DIV' && !n.className && n.parentElement?.matches('main > div'));

const logicalParent = (n) => {
  let p = n.parentElement;
  while (p && isWrapper(p)) p = p.parentElement;
  return p;
};

const logicalChildren = (p) => [...p.children]
  .filter((c) => !c.classList.contains('section-metadata'))
  .flatMap((c) => (isWrapper(c) ? logicalChildren(c) : [c]));

const sameTagIndex = (el) => {
  const parent = logicalParent(el);
  if (!parent) return 1;
  return logicalChildren(parent).filter((c) => c.tagName === el.tagName).indexOf(el) + 1;
};

/** FNV-1a 32-bit as 6 base36 chars. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

export function structurePath(el, section) {
  const parts = [];
  let node = el;
  while (node && node !== section) {
    parts.unshift(`${node.tagName.toLowerCase()}${sameTagIndex(node)}`);
    node = logicalParent(node);
  }
  return parts.join('/');
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6,p';

export const fingerprint = (el) => hash(el.textContent.trim().toLowerCase().replace(/\s+/g, ' '));

/** `level-structureHash-textHash`; either hash alone still finds an edited or moved heading. */
export const headingKey = (el, section) => `${el.tagName.toLowerCase()}-${hash(structurePath(el, section))}-${fingerprint(el)}`;

export const KEY_RE = /^(h[1-6]|p)-[a-z0-9]{6}-[a-z0-9]{6}$/;

export const SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl'];
// Each target uses its own tag in the applied size class.
export const sizeClass = (el, size) => `${el.tagName.toLowerCase()}-size-${size}`;

// Also accepts the legacy `h2sizexxl` form and normalizes it to `h2-size-xxl`.
const LEGACY_RE = /^(h[1-6])size(xxl|xl|l|m|s|xs)$/;
export const classesOf = (value = '') => value.split(/[\s,]+/).filter(Boolean)
  .map((c) => c.replace(LEGACY_RE, '$1-size-$2'));

/** `h3-size-xl` -> { as: 'h3', size: 'xl' }; empty strings when it doesn't match. */
export function parseSizeClass(cls = '') {
  const m = /^(p|h[1-6])-size-(xxl|xl|l|m|s|xs)$/.exec(classesOf(cls)[0] || '');
  return { as: m?.[1] || '', size: m?.[2] || '' };
}

/**
 * Pairs stored entries ({key, value}) with the section's headings: exact key first,
 * then same text (heading moved), then same structure (text edited).
 */
export function matchHeadings(section, entries) {
  const left = new Map(entries.map((e) => [e.key, e]));
  const matched = [];
  const pending = [];
  [...section.querySelectorAll(HEADINGS)].forEach((el) => {
    const key = headingKey(el, section);
    const entry = left.get(key);
    if (entry) {
      matched.push({ el, key, entry });
      left.delete(key);
    } else {
      pending.push({ el, key });
    }
  });
  // Text first: an unchanged text is stronger evidence than an unchanged position.
  [2, 1].forEach((part) => {
    [...pending].forEach((h) => {
      const [level, ...hashes] = h.key.split('-');
      const entry = [...left.values()].find((e) => {
        const [l, ...hs] = e.key.split('-');
        return l === level && hs[part - 1] === hashes[part - 1];
      });
      if (!entry) return;
      matched.push({ ...h, entry });
      left.delete(entry.key);
      pending.splice(pending.indexOf(h), 1);
    });
  });
  return { matched, orphans: [...left.values()] };
}
