/**
 * section-heading — centered section intro (Mega Firms landing page):
 * optional eyebrow, heading, optional body copy.
 *
 * Content model — one row, one cell, flowing:
 *   an optional eyebrow <p> (any paragraph before the heading), an h2
 *   (h1–h4 accepted), then optional body paragraph(s).
 * Variants:
 *   .compact  40/52 heading (Figma "Heading02") instead of 48/60 ("Display04")
 *   .lead     20/28 body (Figma "Body01") instead of 16/24 ("Body02")
 * CSS: blocks/section-heading/section-heading.css
 */
export default function decorate(block) {
  const content = document.createElement('div');
  content.className = 'section-heading-copy';
  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => content.append(n)));
  });

  const heading = content.querySelector('h1, h2, h3, h4');
  if (heading) heading.classList.add('section-heading-title');

  content.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim()) { p.remove(); return; }
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && (p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      p.classList.add('section-heading-eyebrow');
    } else {
      p.classList.add('section-heading-body');
    }
  });

  block.textContent = '';
  block.append(content);
}
