/**
 * text — prose section (heading + paragraphs, no media).
 * With a heading, the cell is split into eyebrow / title / subtitle (`ies` optional);
 * without one the block is left as plain prose.
 * CSS: blocks/text/text.css
 */

const HEADING = /^H[1-6]$/;

/** Tags eyebrow / title / subtitle and wraps them in `.text-header`. */
function decorateHeader(block) {
  const nodes = [...block.querySelectorAll(':scope > div > div > *')]
    .filter((el) => el.textContent.trim());
  const headings = nodes.filter((el) => HEADING.test(el.tagName));
  const title = headings.find((el) => el.tagName !== 'H6') || headings[0];
  if (!title) return;

  const titleIndex = nodes.indexOf(title);
  const header = document.createElement('div');
  header.className = 'text-header';
  nodes.forEach((el, i) => {
    if (i < titleIndex) el.classList.add('text-eyebrow');
    else if (i === titleIndex) el.classList.add('text-title');
    else el.classList.add('text-subtitle');
    header.append(el);
  });
  block.replaceChildren(header);
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  decorateHeader(block);
}
