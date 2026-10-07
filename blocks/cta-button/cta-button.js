/**
 * cta-button — a single centered primary button between sections (Mega Firms
 * landing page; Figma "CTA" rows: 260px persimmon button).
 *
 * Content model — one row, one cell containing one link paragraph; author the
 * link bold (<strong><a>) so the global button decoration applies. Any extra
 * paragraphs are dropped.
 * CSS: blocks/cta-button/cta-button.css
 */
export default function decorate(block) {
  const link = block.querySelector('a[href]');
  block.textContent = '';
  if (!link) return;
  const p = document.createElement('p');
  p.className = 'button-wrapper';
  link.classList.add('button');
  if (!link.classList.contains('secondary')) link.classList.add('primary');
  p.append(link);
  block.append(p);
}
