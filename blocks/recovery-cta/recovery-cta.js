/**
 * recovery-cta — closing call-to-action panel (Mega Firms landing page;
 * Figma "Recovery CTA"): heading, supporting copy and a primary button on a
 * wintermint rounded panel.
 *
 * Content model — one row, one cell, flowing:
 *   a heading (h2 preferred), body paragraph(s), then one or more CTA
 *   paragraphs (<strong><a> → primary). The body is hidden on mobile, matching
 *   the mobile design (title + button only).
 * CSS: blocks/recovery-cta/recovery-cta.css
 */
export default function decorate(block) {
  const content = document.createElement('div');
  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => content.append(n)));
  });

  const copy = document.createElement('div');
  copy.className = 'recovery-cta-copy';
  const actions = document.createElement('div');
  actions.className = 'recovery-cta-actions';

  const heading = content.querySelector('h1, h2, h3');
  if (heading) {
    heading.classList.add('recovery-cta-title');
    copy.append(heading);
  }
  content.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim()) { p.remove(); return; }
    const link = p.querySelector('a');
    if (link && p.textContent.trim() === link.textContent.trim()) {
      actions.append(p);
    } else {
      p.classList.add('recovery-cta-body');
      copy.append(p);
    }
  });

  block.textContent = '';
  block.append(copy);
  if (actions.childElementCount) block.append(actions);
}
